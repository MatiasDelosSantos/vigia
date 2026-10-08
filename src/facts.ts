import type { Queryable } from './db.js';
import { canonicalJson, sha256 } from './util.js';

export interface FactInput {
  predicate: string;
  value: unknown;
  validFrom?: string | null;
  method: string;
  confidence: number;
  sourceUrl: string;
  sourceSha256?: string | null;
  /** Cuándo lo publicó la fuente (para medir el lag de detección en el changefeed). */
  sourcePublishedAt?: string | null;
}

export interface FactRow {
  hash: string;
  predicate: string;
  value: any;
  valid_from: Date | null;
  recorded_from: Date;
  recorded_to: Date | null;
  method: string;
  confidence: number;
  source_url: string;
  source_sha256: string | null;
  last_verified_at: Date;
}

export interface EntityRow {
  id: number;
  type: string;
  ecosystem: string;
  name: string;
  key: string;
  attrs: any;
  popularity_rank: number | null;
  tracked: boolean;
  origin: string;
  check_interval_s: number;
  last_checked_at: Date | null;
  last_changed_at: Date | null;
  error_count: number;
  last_error: string | null;
}

/** Tipo de evento de cambio según el predicado; null = el cambio no se publica en el changefeed. */
function changeKind(predicate: string, oldValue: any, newValue: any): string | null {
  switch (predicate) {
    case 'latest_version':
      return 'released';
    case 'deprecated':
      return newValue?.deprecated ? 'deprecated' : 'undeprecated';
    case 'yanked':
      return newValue?.yanked ? 'yanked' : 'unyanked';
    case 'exists':
      return newValue === false ? 'removed' : 'restored';
    case 'engines':
    case 'requires_python':
      return 'runtime_requirement_changed';
    case 'advisories':
      return (newValue?.length ?? 0) > (oldValue?.length ?? 0) ? 'advisory_added' : 'advisory_changed';
    case 'pricing':
      return 'price_changed';
    case 'expiration_date':
      return newValue ? 'retirement_announced' : 'retirement_cleared';
    case 'context_length':
      return 'limit_changed';
    case 'license':
      return 'license_changed';
    case 'eol_cycles':
      return 'lifecycle_changed';
    default:
      return null;
  }
}

/**
 * Registra un hecho. Si el valor vigente es igual, sólo actualiza la verificación; si cambió, cierra la
 * versión anterior (recorded_to), inserta la nueva y emite un change_event. Devuelve true si hubo cambio.
 */
export async function setFact(db: Queryable, entity: Pick<EntityRow, 'id' | 'key'>, f: FactInput): Promise<boolean> {
  const value = canonicalJson(f.value ?? null);
  const current = await db.query<{ id: number; value: any }>(
    `SELECT id, value FROM fact WHERE entity_id = $1 AND predicate = $2 AND recorded_to IS NULL`,
    [entity.id, f.predicate],
  );
  const cur = current.rows[0];
  if (cur && canonicalJson(cur.value) === value) {
    await db.query(`UPDATE fact SET last_verified_at = now(), source_sha256 = COALESCE($2, source_sha256) WHERE id = $1`, [cur.id, f.sourceSha256 ?? null]);
    return false;
  }
  const now = new Date().toISOString();
  const hash = 'f_' + sha256(`${entity.key}|${f.predicate}|${value}|${now}`).slice(0, 20);
  if (cur) await db.query(`UPDATE fact SET recorded_to = $2 WHERE id = $1`, [cur.id, now]);
  await db.query(
    `INSERT INTO fact (hash, entity_id, predicate, value, valid_from, recorded_from, method, confidence, source_url, source_sha256, last_verified_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $6)`,
    [hash, entity.id, f.predicate, value, f.validFrom ?? null, now, f.method, f.confidence, f.sourceUrl, f.sourceSha256 ?? null],
  );
  if (cur) {
    const kind = changeKind(f.predicate, cur.value, f.value);
    if (kind) {
      await db.query(
        `INSERT INTO change_event (entity_id, predicate, kind, old_value, new_value, source_published_at) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
        [entity.id, f.predicate, kind, canonicalJson(cur.value), value, f.sourcePublishedAt ?? null],
      );
    }
    await db.query(`UPDATE entity SET last_changed_at = now() WHERE id = $1`, [entity.id]);
  }
  return true;
}

/** Marca como re-verificados todos los hechos vigentes (p. ej. cuando la fuente responde 304). */
export async function touchFacts(db: Queryable, entityId: number): Promise<void> {
  await db.query(`UPDATE fact SET last_verified_at = now() WHERE entity_id = $1 AND recorded_to IS NULL`, [entityId]);
}

/** Hechos vigentes, o los que Vigía afirmaba en el instante asOf. */
export async function factsOf(db: Queryable, entityId: number, asOf?: Date): Promise<Map<string, FactRow>> {
  const rows = asOf
    ? await db.query<FactRow>(
        `SELECT * FROM fact WHERE entity_id = $1 AND recorded_from <= $2 AND (recorded_to IS NULL OR recorded_to > $2)`,
        [entityId, asOf],
      )
    : await db.query<FactRow>(`SELECT * FROM fact WHERE entity_id = $1 AND recorded_to IS NULL`, [entityId]);
  return new Map(rows.rows.map((r) => [r.predicate, r]));
}

export async function getEntity(db: Queryable, key: string): Promise<EntityRow | null> {
  const r = await db.query<EntityRow>(`SELECT * FROM entity WHERE key = $1`, [key]);
  return r.rows[0] ?? null;
}

export async function upsertEntity(
  db: Queryable,
  e: { type: string; ecosystem: string; name: string; key: string; popularityRank?: number | null; origin: string; intervalS: number; tracked?: boolean },
): Promise<EntityRow> {
  const r = await db.query<EntityRow>(
    `INSERT INTO entity (type, ecosystem, name, key, popularity_rank, origin, check_interval_s, tracked)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (key) DO UPDATE SET popularity_rank = COALESCE(LEAST(entity.popularity_rank, EXCLUDED.popularity_rank), entity.popularity_rank, EXCLUDED.popularity_rank)
     RETURNING *`,
    [e.type, e.ecosystem, e.name, e.key, e.popularityRank ?? null, e.origin, e.intervalS, e.tracked ?? true],
  );
  return r.rows[0]!;
}

export async function recordDemand(db: Queryable, key: string, found: boolean): Promise<void> {
  await db.query(
    `INSERT INTO demand_signal (key, found) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET hits = demand_signal.hits + 1, found = $2, last_hit_at = now()`,
    [key, found],
  );
}
