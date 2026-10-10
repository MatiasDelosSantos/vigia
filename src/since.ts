import { pool } from './db.js';
import { DATA_LICENSE } from './service.js';
import { compareVersions, majorOf } from './versions.js';
import { availableGuides } from './intel.js';
import type { EolCycle } from './connectors/eol.js';
import type { Ecosystem } from './util.js';

/**
 * "Qué cambió desde la fecha de corte de tu entrenamiento": un parche de conocimiento para agentes.
 * Se calcula con datos que ya tenemos (historial de versiones con fecha, ciclos de vida, catálogo de modelos), así que
 * funciona para cualquier fecha pasada, no sólo desde que Vigía empezó a observar.
 */

export interface VersionPoint {
  version: string;
  published_at: Date | string | null;
}

export interface NewMajor {
  /** Última versión estable publicada hasta la fecha de corte (lo que el modelo "conoce"). */
  version_at_cutoff: string;
  major_at_cutoff: number;
  /** Versiones mayores que aparecieron después de la fecha de corte (la primera versión de cada una). */
  new_majors: Array<{ major: number; first_version: string; first_published: string }>;
  latest: string;
  majors_since: number;
}

const isoDay = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

/** Función pura (testeable): ¿qué versiones mayores nacieron después del corte? null si ninguna. */
export function computeNewMajors(eco: Ecosystem, versions: VersionPoint[], cutoff: Date): NewMajor | null {
  const stable = versions
    .filter((v) => v.published_at)
    .map((v) => ({ version: v.version, at: new Date(v.published_at as string | Date), major: majorOf(eco, v.version) }))
    .filter((v): v is { version: string; at: Date; major: number } => v.major !== null && !Number.isNaN(v.at.getTime()))
    // Versiones por fecha (2024, 2025...) no son versiones mayores en el sentido de compatibilidad.
    .filter((v) => v.major < 1000);
  const before = stable.filter((v) => v.at <= cutoff);
  const after = stable.filter((v) => v.at > cutoff);
  if (before.length === 0 || after.length === 0) return null;
  const maxMajorBefore = Math.max(...before.map((v) => v.major));
  const atCutoff = before.reduce((best, v) => ((compareVersions(eco, v.version, best.version) ?? 0) > 0 ? v : best));
  const latest = stable.reduce((best, v) => ((compareVersions(eco, v.version, best.version) ?? 0) > 0 ? v : best));
  const byMajor = new Map<number, { version: string; at: Date }>();
  for (const v of after) {
    if (v.major <= maxMajorBefore) continue;
    const cur = byMajor.get(v.major);
    if (!cur || v.at < cur.at) byMajor.set(v.major, { version: v.version, at: v.at });
  }
  if (byMajor.size === 0) return null;
  const new_majors = [...byMajor.entries()].sort((a, b) => a[0] - b[0]).map(([major, x]) => ({ major, first_version: x.version, first_published: isoDay(x.at) }));
  return { version_at_cutoff: atCutoff.version, major_at_cutoff: maxMajorBefore, new_majors, latest: latest.version, majors_since: latest.major - maxMajorBefore };
}

// ------------------------------------------------------------------------------------------ paquetes

const TOP_PER_ECOSYSTEM: Record<string, number> = { npm: 500, pypi: 400, crates: 200, packagist: 200 };

interface CacheEntry<T> {
  at: number;
  value: T;
}
const cache = new Map<string, CacheEntry<unknown>>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  if (cache.size > 300) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), value });
  return value;
}

export interface NewMajorRow extends NewMajor {
  ecosystem: string;
  name: string;
  rank: number;
  upgrade_guide: string | null;
}

async function newMajorsFor(eco: Ecosystem, cutoff: Date): Promise<Array<Omit<NewMajorRow, 'upgrade_guide'>>> {
  return cached(`majors|${eco}|${isoDay(cutoff)}`, 3600_000, async () => {
    const r = await pool.query<{ name: string; rank: number; version: string; published_at: Date }>(
      `SELECT e.name, e.popularity_rank AS rank, v.version, v.published_at
       FROM entity e JOIN package_version v ON v.entity_id = e.id
       WHERE e.type = 'package' AND e.ecosystem = $1 AND e.tracked AND e.popularity_rank <= $2
         AND NOT v.prerelease AND NOT v.withdrawn AND v.published_at IS NOT NULL`,
      [eco, TOP_PER_ECOSYSTEM[eco] ?? 200],
    );
    const byName = new Map<string, { rank: number; versions: VersionPoint[] }>();
    for (const row of r.rows) {
      const e = byName.get(row.name) ?? { rank: row.rank, versions: [] };
      e.versions.push({ version: row.version, published_at: row.published_at });
      byName.set(row.name, e);
    }
    const out: Array<Omit<NewMajorRow, 'upgrade_guide'>> = [];
    for (const [name, e] of byName) {
      const m = computeNewMajors(eco, e.versions, cutoff);
      if (m) out.push({ ecosystem: eco, name, rank: e.rank, ...m });
    }
    return out.sort((a, b) => a.rank - b.rank);
  });
}

// ------------------------------------------------------------------------------------------ ciclos de vida

/** Productos que más importan al elegir una base de ejecución (identificadores de endoflife.date). */
const KEY_PRODUCTS = [
  'python', 'nodejs', 'php', 'ruby', 'go', 'java', 'dotnet', 'rust', 'kotlin', 'typescript', 'django', 'laravel', 'rails', 'symfony', 'spring-boot', 'react', 'angular', 'vue', 'nextjs', 'nuxt',
  'postgresql', 'mysql', 'mariadb', 'mongodb', 'redis', 'nginx', 'ubuntu', 'debian', 'alpine', 'kubernetes', 'docker-engine', 'terraform', 'android', 'ios', 'macos', 'windows',
];

export interface LifecycleSince {
  new_cycles: Array<{ product: string; label: string; cycle: string; released: string; latest: string | null; lts: boolean }>;
  reached_end_of_life: Array<{ product: string; label: string; cycle: string; eol: string }>;
  ending_within_180_days: Array<{ product: string; label: string; cycle: string; eol: string }>;
}

export async function lifecycleSince(cutoff: Date): Promise<LifecycleSince> {
  return cached(`life|${isoDay(cutoff)}`, 3600_000, async () => {
    const r = await pool.query<{ name: string; attrs: any; cycles: EolCycle[] }>(
      `SELECT e.name, e.attrs, f.value AS cycles FROM entity e
       JOIN fact f ON f.entity_id = e.id AND f.predicate = 'eol_cycles' AND f.recorded_to IS NULL
       WHERE e.ecosystem = 'eol' AND e.name = ANY($1)`,
      [KEY_PRODUCTS],
    );
    const from = isoDay(cutoff);
    const today = isoDay(new Date());
    const soon = isoDay(new Date(Date.now() + 180 * 86_400_000));
    const out: LifecycleSince = { new_cycles: [], reached_end_of_life: [], ending_within_180_days: [] };
    for (const row of r.rows) {
      const label = row.attrs?.display_name ?? row.name;
      for (const c of row.cycles ?? []) {
        if (c.release_date && c.release_date > from && c.release_date <= today) out.new_cycles.push({ product: row.name, label, cycle: c.cycle, released: c.release_date, latest: c.latest, lts: c.lts });
        if (c.eol_from && c.eol_from > from && c.eol_from <= today && (!c.release_date || c.release_date <= from)) out.reached_end_of_life.push({ product: row.name, label, cycle: c.cycle, eol: c.eol_from });
        if (c.eol_from && c.eol_from > today && c.eol_from <= soon) out.ending_within_180_days.push({ product: row.name, label, cycle: c.cycle, eol: c.eol_from });
      }
    }
    out.new_cycles.sort((a, b) => a.released.localeCompare(b.released));
    out.reached_end_of_life.sort((a, b) => a.eol.localeCompare(b.eol));
    out.ending_within_180_days.sort((a, b) => a.eol.localeCompare(b.eol));
    return out;
  });
}

// ------------------------------------------------------------------------------------------ modelos de IA

const MAJOR_PROVIDERS = ['anthropic', 'openai', 'google', 'meta-llama', 'mistralai', 'x-ai', 'deepseek', 'qwen', 'cohere', 'amazon', 'microsoft', 'nvidia', 'moonshotai', 'z-ai'];

export interface ModelSince {
  id: string;
  name: string;
  provider: string;
  released: string;
  input_per_million_usd: number | null;
  output_per_million_usd: number | null;
  context_length: number | null;
}

export async function modelsSince(cutoff: Date, limit = 40): Promise<ModelSince[]> {
  return cached(`models|${isoDay(cutoff)}|${limit}`, 1800_000, async () => {
    const r = await pool.query<{ name: string; attrs: any; pricing: any; ctx: number | null }>(
      `SELECT e.name, e.attrs,
              (SELECT value FROM fact WHERE entity_id = e.id AND predicate = 'pricing' AND recorded_to IS NULL) AS pricing,
              (SELECT value FROM fact WHERE entity_id = e.id AND predicate = 'context_length' AND recorded_to IS NULL) AS ctx
       FROM entity e
       JOIN fact x ON x.entity_id = e.id AND x.predicate = 'exists' AND x.recorded_to IS NULL AND x.value = 'true'::jsonb
       WHERE e.ecosystem = 'ai' AND e.attrs->>'provider' = ANY($1) AND (e.attrs->>'created')::timestamptz > $2
       ORDER BY (e.attrs->>'created')::timestamptz DESC LIMIT $3`,
      [MAJOR_PROVIDERS, cutoff, limit],
    );
    return r.rows.map((x) => ({
      id: x.name,
      name: x.attrs?.display_name ?? x.name,
      provider: x.attrs?.provider ?? '',
      released: isoDay(x.attrs.created),
      input_per_million_usd: x.pricing?.variable ? null : x.pricing?.input ?? null,
      output_per_million_usd: x.pricing?.variable ? null : x.pricing?.output ?? null,
      context_length: x.ctx ?? null,
    }));
  });
}

// ------------------------------------------------------------------------------------------ resultado completo

/** Acepta "2025-06" (se toma el último día del mes) o "2025-06-15". null si no es una fecha razonable. */
export function parseCutoff(raw: string | undefined | null): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  let d: Date;
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [y, m] = s.split('-').map(Number) as [number, number];
    d = new Date(Date.UTC(y, m, 0, 23, 59, 59)); // día 0 del mes siguiente = último día de este mes
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    d = new Date(`${s}T23:59:59Z`);
  } else return null;
  if (Number.isNaN(d.getTime())) return null;
  if (d < new Date('2015-01-01T00:00:00Z') || d > new Date()) return null;
  return d;
}

export async function changesSince(opts: { cutoff: Date; ecosystems?: string[]; limit: number }) {
  const ecosystems = (opts.ecosystems?.length ? opts.ecosystems : ['npm', 'pypi', 'crates', 'packagist']).filter((e): e is Ecosystem => e in TOP_PER_ECOSYSTEM);
  const lists = await Promise.all(ecosystems.map((e) => newMajorsFor(e, opts.cutoff)));
  const guides = ecosystems.includes('npm') ? await cached('guides', 600_000, () => availableGuides(5000)) : [];
  const guideSet = new Set(guides.map((g) => `${g.name}@${g.from}-${g.to}`));
  const rows: NewMajorRow[] = lists
    .flat()
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
    .map((m) => {
      const last = m.new_majors.at(-1)!.major;
      const hop = `${m.name}@${last - 1}-${last}`;
      return { ...m, upgrade_guide: m.ecosystem === 'npm' && guideSet.has(hop) ? `https://vigia.coredls.cloud/upgrade/npm/${m.name}/${last - 1}-to-${last}` : null };
    });
  const [lifecycle, models] = await Promise.all([lifecycleSince(opts.cutoff), modelsSince(opts.cutoff)]);
  return {
    data: {
      cutoff: isoDay(opts.cutoff),
      as_of: isoDay(new Date()),
      summary: {
        packages_with_new_major_versions: rows.length,
        runtime_versions_released: lifecycle.new_cycles.length,
        runtime_versions_reached_end_of_life: lifecycle.reached_end_of_life.length,
        ai_models_released: models.length,
      },
      new_major_versions: rows.slice(0, opts.limit),
      runtimes_and_platforms: lifecycle,
      ai_models_released: models,
    },
    meta: {
      as_of: new Date().toISOString(),
      coverage: `The ${Object.entries(TOP_PER_ECOSYSTEM).filter(([e]) => ecosystems.includes(e as Ecosystem)).map(([e, n]) => `${n} most popular ${e}`).join(', ')} packages; about 35 key runtimes, frameworks and platforms; AI models from the main providers (first 40 shown).`,
      method:
        'new_major_versions: stable releases dated after the cutoff whose major number is higher than any stable release published before it; version_at_cutoff is what a model trained up to the cutoff would know. Sorted by popularity. Calendar-versioned packages and 0.x → 0.y changes are not reported as major versions.',
      limits: ['Deprecations after the cutoff are only detected from the date Vigia began tracking, so they are not listed here.', 'Dates are publication dates from the registries, in UTC.'],
      next: 'For one package use upgrade_impact (npm) or package_status; for a runtime use eol_status.',
      license: DATA_LICENSE,
    },
  };
}
