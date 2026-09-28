import { pool } from './db.js';
import { config } from './config.js';
import { refreshEntity, intervalFor } from './connectors/index.js';
import { factsOf, getEntity, recordDemand, upsertEntity, type EntityRow, type FactRow } from './facts.js';
import { canonicalName, entityKey, type Ecosystem } from './util.js';

export const DATA_LICENSE = 'CC-BY-4.0 (Vigía); los datos de origen mantienen los términos de cada fuente';

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
  const registryUrl = entity.ecosystem === 'npm' ? `https://www.npmjs.com/package/${entity.name}` : `https://pypi.org/project/${entity.name}/`;

  return {
    data: {
      entity: entity.key,
      ecosystem: entity.ecosystem,
      name: entity.attrs?.display_name ?? entity.name,
      status,
      latest: v('latest_version'),
      ...(entity.ecosystem === 'npm'
        ? { dist_tags: v('dist_tags'), requires: { engines: v('engines'), peer_dependencies: v('peer_dependencies') } }
        : { requires: { python: v('requires_python') }, yanked: yanked }),
      deprecation: deprecated?.deprecated ? { message: deprecated.message } : null,
      license: v('license'),
      advisories_on_latest: v('advisories'),
      description: entity.attrs?.description ?? null,
      repository: entity.attrs?.repository ?? null,
      links: { registry: registryUrl, page: `${config.publicUrl}/${entity.ecosystem}/${entity.name}`, history: `${config.publicUrl}/v1/packages/${entity.ecosystem}/${entity.name}/history` },
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
    meta: { observed_since: iso(firstSeen.rows[0]?.t), note: 'Historial observado por Vigía desde que empezó a seguir la entidad.', license: DATA_LICENSE },
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
      note: 'Precios de referencia según OpenRouter (agregador); pueden diferir del precio directo del proveedor.',
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
      (SELECT count(*) FROM entity WHERE type = 'package' AND last_checked_at IS NOT NULL) AS packages_checked,
      (SELECT count(*) FROM entity WHERE ecosystem = 'ai') AS models,
      (SELECT count(*) FROM fact) AS facts_recorded,
      (SELECT count(*) FROM change_event) AS changes_detected,
      (SELECT count(*) FROM change_event WHERE detected_at > now() - interval '24 hours') AS changes_24h,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM detected_at - source_published_at))
         FROM change_event WHERE kind = 'released' AND source_published_at IS NOT NULL AND detected_at > now() - interval '7 days'
           AND detected_at >= source_published_at) AS release_detection_lag_p50_s,
      (SELECT count(*) FROM entity WHERE origin = 'demand') AS on_demand_packages
  `);
  const row = r.rows[0];
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === null ? null : Math.round(Number(v))]));
}

export { canonicalName };
