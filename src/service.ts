import { pool } from './db.js';
import { config } from './config.js';
import { refreshEntity, intervalFor } from './connectors/index.js';
import { factsOf, getEntity, recordDemand, upsertEntity, type EntityRow, type FactRow } from './facts.js';
import { canonicalName, entityKey, type Ecosystem } from './util.js';
import { compareVersions, maintenanceOf, majorOf, recentVersions } from './versions.js';
import { vulnsForVersion } from './osv.js';

export const DATA_LICENSE = "CC-BY-4.0 (Vigia); upstream data remains under each source's terms";

const inflight = new Map<string, Promise<EntityRow | null>>();

/**
 * Devuelve la entidad del paquete con hechos cargados. Si no la seguimos todavía y live=true, la resuelve
 * en vivo contra el registry y la agrega al seguimiento: la cobertura crece donde los agentes preguntan.
 */
export async function resolvePackage(eco: Ecosystem, name: string, live = true): Promise<EntityRow | null> {
  const key = entityKey(eco, name);
  const existing = await getEntity(pool, key);
  if (existing?.last_checked_at || existing?.last_changed_at) {
    void recordDemand(pool, key, true).catch(() => {});
    return existing;
  }
  if (existing) {
    const f = await factsOf(pool, existing.id);
    if (f.size > 0) return existing;
  }
  if (!live) return null;
  // Deduplicamos resoluciones concurrentes del mismo paquete.
  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      const entity =
        existing ??
        (await upsertEntity(pool, { type: 'package', ecosystem: eco, name, key, origin: 'demand', intervalS: intervalFor(eco, null, 'demand') }));
      const r = await refreshEntity(pool, entity);
      await pool.query(
        `UPDATE entity SET last_checked_at = now(), next_check_at = now() + make_interval(secs => check_interval_s), tracked = $2 WHERE id = $1`,
        [entity.id, r.found],
      );
      await recordDemand(pool, key, r.found);
      return (await getEntity(pool, key))!;
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

function evidence(f: FactRow | undefined) {
  return f ? { fact: f.hash, source: f.source_url, method: f.method, confidence: f.confidence, verified_at: iso(f.last_verified_at) } : null;
}

const REGISTRY_URL: Record<string, (name: string) => string> = {
  npm: (n) => `https://www.npmjs.com/package/${n}`,
  pypi: (n) => `https://pypi.org/project/${n}/`,
  crates: (n) => `https://crates.io/crates/${n}`,
  packagist: (n) => `https://packagist.org/packages/${n}`,
};
/** Fuente de datos de versiones de cada ecosistema. */
const VERSIONS_SOURCE = (eco: string, name: string) =>
  eco === 'npm' ? 'https://deps.dev' : eco === 'crates' ? `https://crates.io/api/v1/crates/${name}` : eco === 'packagist' ? `https://repo.packagist.org/p2/${name}.json` : `https://pypi.org/pypi/${name}/json`;

export interface PackageView {
  data: Record<string, unknown>;
  meta: Record<string, unknown>;
}

export async function packageView(entity: EntityRow, asOf?: Date): Promise<PackageView> {
  const f = await factsOf(pool, entity.id, asOf);
  const v = (p: string) => f.get(p)?.value ?? null;
  const exists = v('exists') !== false;
  const deprecated = v('deprecated');
  const yanked = v('yanked');
  const status = !exists ? 'not_found_in_registry' : yanked?.yanked ? 'yanked' : deprecated?.deprecated ? 'deprecated' : 'active';
  const verified = [...f.values()].map((x) => x.last_verified_at.getTime());
  const sources = [...new Set([...f.values()].map((x) => x.source_url))];
  const registryUrl = REGISTRY_URL[entity.ecosystem]?.(entity.name) ?? '';

  return {
    data: {
      entity: entity.key,
      ecosystem: entity.ecosystem,
      name: entity.attrs?.display_name ?? entity.name,
      status,
      latest: v('latest_version'),
      ...(entity.ecosystem === 'npm'
        ? { dist_tags: v('dist_tags'), requires: { engines: v('engines'), peer_dependencies: v('peer_dependencies') } }
        : entity.ecosystem === 'crates'
          ? { requires: { rust_version: v('rust_version') }, yanked: yanked }
          : entity.ecosystem === 'packagist'
            ? { requires: { php: v('php_requirement') }, yanked: yanked }
            : { requires: { python: v('requires_python') }, yanked: yanked }),
      deprecation: deprecated?.deprecated ? { message: deprecated.message } : null,
      license: v('license'),
      advisories_on_latest: v('advisories'),
      maintenance: await maintenanceOf(pool, entity.id),
      description: entity.attrs?.description ?? null,
      repository: entity.attrs?.repository ?? null,
      links: { registry: registryUrl, page: `${config.publicUrl}/${entity.ecosystem}/${entity.name}`, history: `${config.publicUrl}/v1/packages/${entity.ecosystem}/${entity.name}/history`, versions: `${config.publicUrl}/v1/packages/${entity.ecosystem}/${entity.name}/versions` },
    },
    meta: {
      as_of: (asOf ?? new Date()).toISOString(),
      last_verified_at: verified.length ? new Date(Math.min(...verified)).toISOString() : null,
      last_changed_at: iso(entity.last_changed_at),
      coverage: entity.origin === 'demand' ? 'on_demand' : 'tracked',
      check_interval_s: entity.check_interval_s,
      evidence: {
        latest: evidence(f.get('latest_version')),
        deprecation: evidence(f.get('deprecated')),
        advisories: evidence(f.get('advisories')),
      },
      sources,
      untrusted_text_fields: ['description', 'deprecation.message', 'yanked.reason'],
      license: DATA_LICENSE,
      docs: `${config.publicUrl}/docs`,
    },
  };
}

export async function packageHistory(entity: EntityRow, limit = 50) {
  const r = await pool.query(
    `SELECT seq, predicate, kind, old_value, new_value, detected_at, source_published_at FROM change_event WHERE entity_id = $1 ORDER BY seq DESC LIMIT $2`,
    [entity.id, limit],
  );
  const firstSeen = await pool.query(`SELECT min(recorded_from) AS t FROM fact WHERE entity_id = $1`, [entity.id]);
  return {
    data: { entity: entity.key, changes: r.rows },
    meta: { observed_since: iso(firstSeen.rows[0]?.t), note: 'History as observed by Vigia since it started tracking this entity.', license: DATA_LICENSE },
  };
}

export async function modelView(entity: EntityRow, asOf?: Date) {
  const f = await factsOf(pool, entity.id, asOf);
  const v = (p: string) => f.get(p)?.value ?? null;
  const exp = v('expiration_date');
  return {
    data: {
      entity: entity.key,
      id: entity.name,
      name: entity.attrs?.display_name ?? entity.name,
      provider: entity.attrs?.provider ?? null,
      status: v('exists') === false ? 'removed_from_catalog' : exp ? 'retiring' : 'available',
      pricing: v('pricing'),
      context_length: v('context_length'),
      max_output_tokens: v('max_output_tokens'),
      expiration_date: exp,
      knowledge_cutoff: v('knowledge_cutoff'),
      input_modalities: entity.attrs?.input_modalities ?? null,
      output_modalities: entity.attrs?.output_modalities ?? null,
      created: entity.attrs?.created ?? null,
    },
    meta: {
      as_of: (asOf ?? new Date()).toISOString(),
      last_verified_at: iso(f.get('pricing')?.last_verified_at),
      source: 'https://openrouter.ai/api/v1/models',
      note: "Reference prices from OpenRouter (aggregator); they may differ from the provider's direct pricing.",
      untrusted_text_fields: ['name'],
      license: DATA_LICENSE,
    },
  };
}

export async function listModels(opts: { provider?: string; q?: string; includeRemoved?: boolean; limit: number }) {
  const r = await pool.query<EntityRow>(
    `SELECT e.* FROM entity e
     JOIN fact f ON f.entity_id = e.id AND f.predicate = 'exists' AND f.recorded_to IS NULL
     WHERE e.ecosystem = 'ai' AND ($1::text IS NULL OR e.name LIKE $1 || '/%')
       AND ($2::text IS NULL OR e.name ILIKE '%' || $2 || '%' OR e.attrs->>'display_name' ILIKE '%' || $2 || '%')
       AND ($3 OR f.value = 'true'::jsonb)
     ORDER BY e.name LIMIT $4`,
    [opts.provider ?? null, opts.q ?? null, opts.includeRemoved ?? false, opts.limit],
  );
  return Promise.all(r.rows.map(async (e) => (await modelView(e)).data));
}

export async function search(q: string, eco: string | undefined, limit: number) {
  const r = await pool.query(
    `SELECT key, ecosystem, name, popularity_rank FROM entity
     WHERE (type = 'model' OR (type = 'package' AND tracked)) AND ($2::text IS NULL OR ecosystem = $2) AND lower(name) LIKE $1 || '%'
     ORDER BY popularity_rank NULLS LAST, length(name) LIMIT $3`,
    [q.toLowerCase().replace(/[%_\\]/g, ''), eco ?? null, limit],
  );
  return r.rows;
}

export async function changes(opts: { since: number; ecosystem?: string; kind?: string; limit: number }) {
  const r = await pool.query(
    `SELECT c.seq, e.key AS entity, c.predicate, c.kind, c.old_value, c.new_value, c.detected_at, c.source_published_at
     FROM change_event c JOIN entity e ON e.id = c.entity_id
     WHERE c.seq > $1 AND ($2::text IS NULL OR e.ecosystem = $2) AND ($3::text IS NULL OR c.kind = $3)
     ORDER BY c.seq LIMIT $4`,
    [opts.since, opts.ecosystem ?? null, opts.kind ?? null, opts.limit],
  );
  const last = r.rows.at(-1)?.seq ?? opts.since;
  return { data: r.rows, meta: { next_since: last, has_more: r.rows.length === opts.limit, license: DATA_LICENSE } };
}

export async function recentChanges(limit: number, kinds: string[]) {
  const r = await pool.query(
    `SELECT c.seq, e.key AS entity, e.ecosystem, e.name, c.kind, c.old_value, c.new_value, c.detected_at
     FROM change_event c JOIN entity e ON e.id = c.entity_id WHERE c.kind = ANY($2) ORDER BY c.seq DESC LIMIT $1`,
    [limit, kinds],
  );
  return r.rows;
}

export async function factByHash(hash: string) {
  const r = await pool.query(
    `SELECT f.hash, e.key AS entity, f.predicate, f.value, f.valid_from, f.recorded_from, f.recorded_to, f.method, f.confidence,
            f.source_url, f.source_sha256, f.last_verified_at
     FROM fact f JOIN entity e ON e.id = f.entity_id WHERE f.hash = $1`,
    [hash],
  );
  return r.rows[0] ?? null;
}

export async function stats() {
  const r = await pool.query(`
    SELECT
      (SELECT count(*) FROM entity WHERE type = 'package' AND ecosystem = 'npm' AND tracked) AS npm_tracked,
      (SELECT count(*) FROM entity WHERE type = 'package' AND ecosystem = 'pypi' AND tracked) AS pypi_tracked,
      (SELECT count(*) FROM entity WHERE type = 'package' AND ecosystem = 'crates' AND tracked) AS crates_tracked,
      (SELECT count(*) FROM entity WHERE type = 'package' AND ecosystem = 'packagist' AND tracked) AS packagist_tracked,
      (SELECT count(*) FROM entity WHERE type = 'product' AND ecosystem = 'eol' AND tracked) AS eol_products,
      (SELECT count(*) FROM entity WHERE type = 'package' AND last_checked_at IS NOT NULL) AS packages_checked,
      (SELECT count(*) FROM entity WHERE ecosystem = 'ai') AS models,
      (SELECT count(*) FROM fact) AS facts_recorded,
      (SELECT count(*) FROM change_event) AS changes_detected,
      (SELECT count(*) FROM change_event WHERE detected_at > now() - interval '24 hours') AS changes_24h,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM detected_at - source_published_at))
         FROM change_event WHERE kind = 'released' AND source_published_at IS NOT NULL AND detected_at > now() - interval '7 days'
           AND detected_at >= source_published_at) AS release_detection_lag_p50_s,
      (SELECT count(*) FROM entity WHERE origin = 'demand') AS on_demand_packages,
      (SELECT count(*) FROM entity WHERE type = 'package' AND last_checked_at > now() - interval '1 hour') AS verified_last_hour,
      (SELECT count(*) FROM entity WHERE type = 'package' AND tracked AND error_count > 0) AS packages_with_errors
  `);
  const row = r.rows[0];
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === null ? null : Math.round(Number(v))]));
}

export { canonicalName };

// ------------------------------------------------------------------------------------ versiones

export async function versionList(entity: EntityRow, limit: number, stableOnly = false) {
  const rows = await recentVersions(pool, entity.id, limit, stableOnly);
  const m = await maintenanceOf(pool, entity.id);
  return {
    data: {
      entity: entity.key,
      versions: rows.map((r) => ({ version: r.version, published_at: iso(r.published_at), prerelease: r.prerelease, withdrawn: r.withdrawn })),
      maintenance: m,
    },
    meta: {
      total_versions: m.total_versions,
      returned: rows.length,
      order: 'published_at desc',
      withdrawn_means: entity.ecosystem === 'npm' ? 'deprecated on npm' : entity.ecosystem === 'crates' ? 'yanked on crates.io' : entity.ecosystem === 'packagist' ? 'marked abandoned on Packagist' : 'all files yanked on PyPI',
      source: VERSIONS_SOURCE(entity.ecosystem, entity.name),
      license: DATA_LICENSE,
    },
  };
}

/** Estado de una versión exacta: si existe, cuándo salió, si fue retirada, cuántas mayores atrás y sus vulnerabilidades (OSV). */
export async function versionStatus(entity: EntityRow, version: string) {
  const eco = entity.ecosystem as Ecosystem;
  const r = await pool.query<{ version: string; published_at: Date | null; prerelease: boolean; withdrawn: boolean }>(
    `SELECT version, published_at, prerelease, withdrawn FROM package_version WHERE entity_id = $1 AND version = $2`,
    [entity.id, version],
  );
  const row = r.rows[0];
  const f = await factsOf(pool, entity.id);
  const latest: string | undefined = f.get('latest_version')?.value?.version;
  const newer = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM package_version WHERE entity_id = $1 AND NOT prerelease AND published_at > (SELECT published_at FROM package_version WHERE entity_id = $1 AND version = $2)`,
    [entity.id, version],
  );
  let vulns = null;
  let vulnError: string | null = null;
  try {
    vulns = await vulnsForVersion(eco, entity.name, version);
  } catch (err) {
    vulnError = err instanceof Error ? err.message : String(err);
  }
  const lm = latest ? majorOf(eco, latest) : null;
  const vm = majorOf(eco, version);
  return {
    data: {
      entity: entity.key,
      version,
      // null = todavía no sincronizamos el historial de este paquete (no podemos afirmar que no exista).
      exists: row ? true : (await maintenanceOf(pool, entity.id)).total_versions === 0 ? null : false,
      published_at: iso(row?.published_at),
      prerelease: row?.prerelease ?? null,
      withdrawn: row?.withdrawn ?? null,
      latest,
      is_latest: latest === version,
      newer_stable_releases: row ? newer.rows[0]?.n ?? 0 : null,
      majors_behind: lm !== null && vm !== null ? Math.max(lm - vm, 0) : null,
      comparison_to_latest: latest ? compareVersions(eco, version, latest) : null,
      vulnerabilities: vulns?.vulnerabilities ?? null,
      nearest_fixed_version: vulns?.nearest_fixed_version ?? null,
      unfixed_vulnerabilities: vulns?.unfixed_count ?? null,
    },
    meta: {
      as_of: new Date().toISOString(),
      sources: [VERSIONS_SOURCE(entity.ecosystem, entity.name), 'https://osv.dev'],
      vulnerabilities_error: vulnError,
      notes: [
        'nearest_fixed_version is the smallest version that fixes every known vulnerability affecting this version (null if any has no fix).',
        'Vulnerability data from OSV (aggregates GitHub Security Advisories, PyPA and others); cached up to 6 hours.',
      ],
      untrusted_text_fields: ['vulnerabilities[].summary'],
      license: DATA_LICENSE,
    },
  };
}

/** Enlaces internos: peers seguidos + vecinos por popularidad en el mismo ecosistema. */
export async function relatedPackages(entity: EntityRow, peerNames: string[], limit = 12) {
  const peers = peerNames.length
    ? await pool.query<{ ecosystem: string; name: string }>(
        `SELECT ecosystem, name FROM entity WHERE type = 'package' AND tracked AND ecosystem = $1 AND name = ANY($2) AND last_checked_at IS NOT NULL LIMIT 10`,
        [entity.ecosystem, peerNames],
      )
    : { rows: [] };
  const rank = entity.popularity_rank ?? 1000;
  const near = await pool.query<{ ecosystem: string; name: string }>(
    `SELECT ecosystem, name FROM entity WHERE type = 'package' AND tracked AND ecosystem = $1 AND id <> $2 AND last_checked_at IS NOT NULL
       AND popularity_rank BETWEEN $3 AND $4 ORDER BY abs(popularity_rank - $5) LIMIT $6`,
    [entity.ecosystem, entity.id, rank - limit, rank + limit, rank, limit],
  );
  const seen = new Set<string>();
  return [...peers.rows, ...near.rows].filter((x) => (seen.has(x.name) ? false : (seen.add(x.name), true))).slice(0, limit + 4);
}

/** Listado para páginas índice (orden por popularidad). */
export async function browse(eco: Ecosystem, offset: number, limit: number) {
  const r = await pool.query<{ id: number; name: string; popularity_rank: number | null }>(
    `SELECT id, name, popularity_rank FROM entity WHERE type = 'package' AND tracked AND ecosystem = $1 AND last_checked_at IS NOT NULL
     ORDER BY popularity_rank NULLS LAST, name OFFSET $2 LIMIT $3`,
    [eco, offset, limit],
  );
  const total = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM entity WHERE type = 'package' AND tracked AND ecosystem = $1 AND last_checked_at IS NOT NULL`,
    [eco],
  );
  const ids = r.rows.map((x) => x.id);
  const facts = ids.length
    ? await pool.query<{ entity_id: number; predicate: string; value: any }>(
        `SELECT entity_id, predicate, value FROM fact WHERE entity_id = ANY($1) AND recorded_to IS NULL AND predicate IN ('latest_version','deprecated','yanked','exists')`,
        [ids],
      )
    : { rows: [] };
  const byId = new Map<number, Record<string, any>>();
  for (const f of facts.rows) byId.set(f.entity_id, { ...(byId.get(f.entity_id) ?? {}), [f.predicate]: f.value });
  return {
    total: total.rows[0]?.n ?? 0,
    items: r.rows.map((x) => {
      const f = byId.get(x.id) ?? {};
      const status = f.exists === false ? 'not_found_in_registry' : f.yanked?.yanked ? 'yanked' : f.deprecated?.deprecated ? 'deprecated' : 'active';
      return { name: x.name, rank: x.popularity_rank, version: f.latest_version?.version ?? null, published_at: f.latest_version?.published_at ?? null, status };
    }),
  };
}
