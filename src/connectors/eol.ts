import { tx, type Queryable } from '../db.js';
import { setFact, touchFacts, type EntityRow } from '../facts.js';
import { httpGet, sha256, UpstreamError } from '../util.js';
import type { IngestResult } from './npm.js';

export const EOL_API = 'https://endoflife.date/api/v1/products';

/** Un ciclo de vida de un producto (por ejemplo Python 3.9) tal como lo guardamos. Las fechas son YYYY-MM-DD. */
export interface EolCycle {
  cycle: string;
  codename: string | null;
  release_date: string | null;
  lts: boolean;
  lts_from: string | null;
  /** Fin del soporte activo (después sólo hay correcciones de seguridad). */
  support_until: string | null;
  /** Fin de vida: ya no hay ninguna corrección. */
  eol_from: string | null;
  /** true cuando la fuente marca el ciclo como terminado pero sin fecha. */
  eol_flag: boolean;
  latest: string | null;
  latest_date: string | null;
}

const date = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const text = (v: unknown, max = 80): string | null => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null);

export function normalizeCycles(releases: any[]): EolCycle[] {
  return releases
    .filter((r) => r && (typeof r.name === 'string' || typeof r.name === 'number'))
    .map((r) => ({
      cycle: String(r.name).slice(0, 40),
      codename: text(r.codename),
      release_date: date(r.releaseDate),
      lts: r.isLts === true,
      lts_from: date(r.ltsFrom),
      support_until: date(r.eoasFrom),
      eol_from: date(r.eolFrom),
      eol_flag: r.isEol === true && !date(r.eolFrom),
      latest: text(r.latest?.name),
      latest_date: date(r.latest?.date),
    }));
}

/** endoflife.date (licencia MIT): ciclos de vida de ~480 productos. Un request por producto. */
export async function ingestEol(db: Queryable, entity: EntityRow): Promise<IngestResult> {
  const url = `${EOL_API}/${encodeURIComponent(entity.name)}/`;
  const etag = entity.attrs?.etags?.json ?? null;
  const res = await httpGet(url, { etag, timeoutMs: 30_000 });
  if (res.status === 404) {
    const changed = await tx((c) => setFact(c, entity, { predicate: 'exists', value: false, method: 'aggregator', confidence: 1, sourceUrl: url }));
    return { found: false, changed };
  }
  if (res.status === 304) {
    await touchFacts(db, entity.id);
    return { found: true, changed: false };
  }
  if (res.status !== 200) throw new UpstreamError(`endoflife.date ${res.status}`, res.status);

  const r = JSON.parse(res.body).result ?? {};
  const cycles = normalizeCycles(Array.isArray(r.releases) ? r.releases : []);
  const src = { sourceUrl: url, sourceSha256: sha256(res.body), method: 'aggregator', confidence: 0.95 };
  const changed = await tx(async (c) => {
    let any = false;
    any = (await setFact(c, entity, { predicate: 'exists', value: true, ...src })) || any;
    any = (await setFact(c, entity, { predicate: 'eol_cycles', value: cycles, ...src })) || any;
    const attrs = {
      ...entity.attrs,
      etags: { json: res.etag },
      display_name: text(r.label, 120) ?? entity.name,
      category: text(r.category, 40),
      tags: Array.isArray(r.tags) ? r.tags.filter((t: unknown) => typeof t === 'string').slice(0, 10) : [],
      aliases: Array.isArray(r.aliases) ? r.aliases.filter((t: unknown) => typeof t === 'string').slice(0, 10) : [],
      release_policy: text(r.links?.releasePolicy, 300),
      product_page: text(r.links?.html, 300),
    };
    await c.query(`UPDATE entity SET attrs = $2 WHERE id = $1`, [entity.id, attrs]);
    return any;
  });
  return { found: true, changed };
}
