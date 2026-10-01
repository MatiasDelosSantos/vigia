import semver from 'semver';
import * as pep440 from '@renovatebot/pep440';
import { pool } from './db.js';
import { config } from './config.js';
import { factsOf, type EntityRow } from './facts.js';
import { enqueueSnapshot, getSnapshot, jobState, queuePosition } from './analysis.js';
import { changelogBetween, checkVersion, diffSurfaces, sortDesc, type Constraint } from './upgrade.js';
import { DATA_LICENSE } from './service.js';
import type { Ecosystem } from './util.js';

interface VRow {
  version: string;
  published_at: Date | null;
  prerelease: boolean;
  withdrawn: boolean;
  engines: Record<string, string> | null;
  peer: Record<string, string> | null;
  requires_python: string | null;
  deprecated_msg: string | null;
}

async function versionRows(entityId: number): Promise<VRow[]> {
  const r = await pool.query<VRow>(
    `SELECT version, published_at, prerelease, withdrawn, engines, peer, requires_python, deprecated_msg FROM package_version WHERE entity_id = $1`,
    [entityId],
  );
  return r.rows;
}

const majorOf = (eco: Ecosystem, v: string) => (eco === 'npm' ? (semver.valid(v) ? semver.major(v) : null) : pep440.valid(v) ? pep440.major(v) : null);

/** "15" → última estable de la 15.x; "latest"/vacío → última estable; versión exacta → tal cual. */
export async function resolveVersionSpec(entity: EntityRow, spec: string | undefined): Promise<string | null> {
  const eco = entity.ecosystem as Ecosystem;
  if (!spec || spec === 'latest') return (await factsOf(pool, entity.id)).get('latest_version')?.value?.version ?? null;
  if (/^\d+$/.test(spec)) {
    const rows = (await versionRows(entity.id)).filter((r) => !r.prerelease && !r.withdrawn && majorOf(eco, r.version) === Number(spec));
    return sortDesc(eco, rows.map((r) => r.version))[0] ?? null;
  }
  return spec;
}

// ------------------------------------------------------------------------------------ compatibilidad

export async function compatibleVersion(entity: EntityRow, constraints: Constraint[]) {
  const eco = entity.ecosystem as Ecosystem;
  const rows = (await versionRows(entity.id)).filter((r) => !r.prerelease && !r.withdrawn);
  const byVersion = new Map(rows.map((r) => [r.version, r]));
  const ordered = sortDesc(eco, rows.map((r) => r.version));
  const hasRequirementData = rows.some((r) => r.engines || r.peer || r.requires_python);
  let best: { version: string; checks: ReturnType<typeof checkVersion> } | null = null;
  let newestIncompatible: { version: string; failed: ReturnType<typeof checkVersion> } | null = null;
  for (const v of ordered) {
    const row = byVersion.get(v)!;
    const checks = checkVersion(eco, row, constraints);
    if (checks.every((c) => c.ok !== false)) {
      best = { version: v, checks };
      break;
    }
    if (!newestIncompatible) newestIncompatible = { version: v, failed: checks.filter((c) => c.ok === false) };
  }
  const latest = ordered[0] ?? null;
  return {
    data: {
      entity: entity.key,
      constraints: constraints.map((c) => `${c.name}@${c.version}`),
      compatible_version: best?.version ?? null,
      published_at: best ? byVersion.get(best.version)?.published_at?.toISOString() ?? null : null,
      is_latest: best?.version === latest,
      latest_stable: latest,
      checks: best?.checks ?? [],
      first_incompatible_newer: newestIncompatible && best && newestIncompatible.version !== best.version ? newestIncompatible : null,
      unverified: (best?.checks ?? []).filter((c) => c.ok === null).map((c) => c.constraint),
    },
    meta: {
      as_of: new Date().toISOString(),
      requirement_data: hasRequirementData ? 'available' : 'not_synced_yet',
      method:
        eco === 'npm'
          ? 'Highest stable, non-deprecated version whose engines.node / peerDependencies ranges admit every constraint. A version that does not declare a requirement counts as compatible but is listed in "unverified".'
          : 'Highest stable, non-yanked version whose Requires-Python admits the constraint. Versions without Requires-Python are listed in "unverified".',
      sources: eco === 'npm' ? ['https://registry.npmjs.org', 'https://deps.dev'] : [`https://pypi.org/pypi/${entity.name}/json`],
      license: DATA_LICENSE,
    },
  };
}

/** Tabla para la página del paquete: versión más nueva compatible con cada Node/Python. */
export async function compatibilityTable(entity: EntityRow): Promise<Array<{ target: string; version: string | null }>> {
  const eco = entity.ecosystem as Ecosystem;
  const targets = eco === 'npm' ? ['node@16', 'node@18', 'node@20', 'node@22', 'node@24'] : ['python@3.8', 'python@3.9', 'python@3.10', 'python@3.11', 'python@3.12', 'python@3.13'];
  const rows = (await versionRows(entity.id)).filter((r) => !r.prerelease && !r.withdrawn);
  if (!rows.some((r) => r.engines || r.requires_python)) return [];
  const ordered = sortDesc(eco, rows.map((r) => r.version));
  const byVersion = new Map(rows.map((r) => [r.version, r]));
  return targets.map((t) => {
    const [name, version] = t.split('@') as [string, string];
    const v = ordered.find((x) => checkVersion(eco, byVersion.get(x)!, [{ name, version }])[0]!.ok !== false) ?? null;
    return { target: t, version: v };
  });
}

// ------------------------------------------------------------------------------------ impacto de actualizar

type Pending = { status: 'pending'; data: Record<string, unknown>; retry_after_s: number };

async function ensureSnapshot(entity: EntityRow, version: string, priority: number) {
  const snap = await getSnapshot(entity.id, version);
  if (snap) return snap;
  await enqueueSnapshot(entity, version, priority);
  return null;
}

export async function upgradeReport(entity: EntityRow, fromSpec: string | undefined, toSpec: string | undefined) {
  if (entity.ecosystem !== 'npm') return { status: 'unsupported' as const, message: 'API surface analysis is available for npm packages (TypeScript types). PyPI support is planned.' };
  const from = await resolveVersionSpec(entity, fromSpec);
  const to = await resolveVersionSpec(entity, toSpec ?? 'latest');
  if (!from || !to || !semver.valid(from) || !semver.valid(to)) return { status: 'invalid' as const, message: `Could not resolve versions (from=${fromSpec}, to=${toSpec ?? 'latest'}).` };
  if (!semver.gt(to, from)) return { status: 'invalid' as const, message: `"to" (${to}) must be newer than "from" (${from}).` };

  const [a, b] = [await ensureSnapshot(entity, from, 10), await ensureSnapshot(entity, to, 10)];
  if (!a || !b) {
    const pos = await queuePosition(entity, !a ? from : to);
    return {
      status: 'pending' as const,
      data: { entity: entity.key, from, to, queue_position: pos },
      retry_after_s: Math.min(15 + (pos ?? 0) * 10, 300),
    } satisfies Pending;
  }
  const rows = await versionRows(entity.id);
  const ra = rows.find((r) => r.version === from);
  const rb = rows.find((r) => r.version === to);
  const reqChanges: Array<{ field: string; before: string | null; after: string | null }> = [];
  const cmp = (field: string, x: Record<string, string> | null | undefined, y: Record<string, string> | null | undefined) => {
    for (const k of new Set([...Object.keys(x ?? {}), ...Object.keys(y ?? {})])) {
      const bx = x?.[k] ?? null;
      const by = y?.[k] ?? null;
      if (bx !== by) reqChanges.push({ field: `${field}.${k}`, before: bx, after: by });
    }
  };
  cmp('engines', ra?.engines, rb?.engines);
  cmp('peerDependencies', ra?.peer, rb?.peer);

  const types = a.status === 'ok' && b.status === 'ok' ? diffSurfaces(entity.name, a.surface!, b.surface!) : null;
  const changelog = b.changelog ? changelogBetween(b.changelog, from, to) : [];
  const c = types?.counts;
  return {
    status: 'ok' as const,
    data: {
      entity: entity.key,
      from,
      to,
      majors_crossed: semver.major(to) - semver.major(from),
      summary: types
        ? {
            removed_exports: c!.removed,
            changed_signatures: c!.changed,
            removed_members: c!.members_removed,
            changed_members: c!.members_changed,
            removed_modules: c!.modules_removed,
            newly_deprecated: c!.deprecated,
            added_exports: c!.added,
            requirement_changes: reqChanges.length,
            likely_breaking: c!.removed + c!.changed + c!.members_removed + c!.members_changed + c!.modules_removed + reqChanges.length > 0,
          }
        : null,
      types_analysis: types ? null : { from: a.status, to: b.status, note: 'Types could not be analyzed for one of the versions (no types, too large or error).' },
      requirement_changes: reqChanges,
      breaking_candidates: types
        ? {
            removed_modules: types.modules_removed,
            removed_exports: types.removed,
            changed_signatures: types.changed,
            removed_members: types.members_removed,
            changed_members: types.members_changed,
          }
        : null,
      newly_deprecated: types?.deprecated ?? [],
      added_modules: types?.modules_added ?? [],
      added_exports: types?.added ?? [],
      changelog,
      types_source: { from: a.source, to: b.source },
    },
    meta: {
      as_of: new Date().toISOString(),
      analyzed_at: { from: a.computed_at, to: b.computed_at },
      truncated: types?.truncated ?? false,
      method:
        'Exported declarations of both versions are read from their TypeScript types (package types or @types) without executing code and compared by name, kind and printed signature. A changed signature is a breaking-change candidate, not a certainty. Changelog sections come from the CHANGELOG shipped in the package.',
      untrusted_text_fields: ['changelog[].text', 'newly_deprecated[].message'],
      page: `${config.publicUrl}/upgrade/npm/${entity.name}/${semver.major(from)}-to-${semver.major(to)}`,
      license: DATA_LICENSE,
    },
  };
}

// ------------------------------------------------------------------------------------ estado de un símbolo

export async function symbolStatus(entity: EntityRow, symbol: string, versionSpec: string | undefined, moduleHint: string | undefined) {
  if (entity.ecosystem !== 'npm') return { status: 'unsupported' as const, message: 'Symbol lookup is available for npm packages (TypeScript types).' };
  const version = await resolveVersionSpec(entity, versionSpec);
  if (!version) return { status: 'invalid' as const, message: 'Unknown version.' };
  const snap = await ensureSnapshot(entity, version, 10);
  if (!snap) {
    const pos = await queuePosition(entity, version);
    return { status: 'pending' as const, data: { entity: entity.key, version, queue_position: pos }, retry_after_s: Math.min(15 + (pos ?? 0) * 10, 300) };
  }
  if (snap.status !== 'ok' || !snap.surface) return { status: 'no_types' as const, data: { entity: entity.key, version, analysis: snap.status } };

  const [owner, member] = symbol.includes('.') ? (symbol.split('.', 2) as [string, string]) : [symbol, null];
  const wantedMod = moduleHint ? (moduleHint === entity.name ? '.' : `./${moduleHint.replace(`${entity.name}/`, '').replace(/^\.\//, '')}`) : null;
  const matches: Array<Record<string, unknown>> = [];
  for (const [mod, exps] of Object.entries(snap.surface.modules)) {
    if (wantedMod && mod !== wantedMod) continue;
    const e = exps[owner];
    if (!e) continue;
    const importFrom = mod === '.' ? entity.name : `${entity.name}/${mod.replace(/^\.\//, '')}`;
    if (member) {
      const m = e.members?.[member];
      matches.push({ import_from: importFrom, export: owner, member, exists: Boolean(m), signature: m?.t ?? null, deprecated: m?.dep !== undefined, deprecation_message: m?.dep ?? null });
    } else {
      matches.push({ import_from: importFrom, export: owner, kind: e.kind, signature: e.sig, deprecated: e.dep !== undefined, deprecation_message: e.dep ?? null, members: e.members ? Object.keys(e.members).slice(0, 60) : undefined });
    }
  }
  // Sugerencias si no existe: nombres parecidos (mismo prefijo o distancia corta).
  let suggestions: string[] = [];
  if (matches.length === 0) {
    const all = new Set<string>();
    for (const exps of Object.values(snap.surface.modules)) for (const n of Object.keys(exps)) all.add(n);
    const lower = owner.toLowerCase();
    // Coincidencias parciales primero; después nombres a distancia de edición ≤ 2 (errores de tipeo).
    const partial = [...all].filter((n) => n.toLowerCase().includes(lower) || lower.includes(n.toLowerCase()));
    const close = [...all].filter((n) => !partial.includes(n) && Math.abs(n.length - owner.length) <= 2 && editDistance(n.toLowerCase(), lower) <= 2);
    suggestions = [...partial, ...close].slice(0, 10);
  }
  return {
    status: 'ok' as const,
    data: { entity: entity.key, version, symbol, found: matches.length > 0, matches, suggestions },
    meta: {
      as_of: new Date().toISOString(),
      analyzed_at: snap.computed_at,
      types_source: snap.source,
      method: 'Looked up in the exported TypeScript declarations of that exact version (no code executed).',
      untrusted_text_fields: ['matches[].deprecation_message'],
      license: DATA_LICENSE,
    },
  };
}

/** Guías de actualización ya disponibles (pares de versiones mayores con ambas fotos analizadas). */
export async function availableGuides(limit = 500) {
  const r = await pool.query<{ name: string; rank: number | null; versions: string[] }>(
    `SELECT e.name, e.popularity_rank AS rank, array_agg(s.version) AS versions
     FROM api_snapshot s JOIN entity e ON e.id = s.entity_id
     WHERE s.status = 'ok' AND e.ecosystem = 'npm'
     GROUP BY e.name, e.popularity_rank ORDER BY e.popularity_rank NULLS LAST LIMIT $1`,
    [limit],
  );
  const out: Array<{ name: string; from: number; to: number; fromVersion: string; toVersion: string }> = [];
  for (const row of r.rows) {
    const byMajor = new Map<number, string>();
    for (const v of row.versions.filter((x) => semver.valid(x)).sort(semver.compare)) byMajor.set(semver.major(v), v);
    const majors = [...byMajor.keys()].sort((x, y) => x - y);
    for (let i = 1; i < majors.length; i++) {
      out.push({ name: row.name, from: majors[i - 1]!, to: majors[i]!, fromVersion: byMajor.get(majors[i - 1]!)!, toVersion: byMajor.get(majors[i]!)! });
    }
  }
  return out;
}

export { jobState };

/** Guías disponibles para un paquete: pares de versiones mayores consecutivas con ambas fotos analizadas. */
export async function guidesFor(entityId: number): Promise<Array<{ from: number; to: number; fromVersion: string; toVersion: string }>> {
  const r = await pool.query<{ version: string }>(`SELECT version FROM api_snapshot WHERE entity_id = $1 AND status = 'ok'`, [entityId]);
  const byMajor = new Map<number, string>();
  for (const v of r.rows.map((x) => x.version).filter((x) => semver.valid(x) && !semver.prerelease(x)).sort(semver.compare)) byMajor.set(semver.major(v), v);
  const majors = [...byMajor.keys()].sort((x, y) => x - y);
  const out: Array<{ from: number; to: number; fromVersion: string; toVersion: string }> = [];
  for (let i = 1; i < majors.length; i++) out.push({ from: majors[i - 1]!, to: majors[i]!, fromVersion: byMajor.get(majors[i - 1]!)!, toVersion: byMajor.get(majors[i]!)! });
  return out;
}

/** Distancia de Levenshtein (nombres cortos: costo despreciable). */
export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}
