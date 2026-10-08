import semver from 'semver';
import { tx, type Queryable } from '../db.js';
import { setFact, touchFacts, type EntityRow } from '../facts.js';
import { httpGet, sha256, UpstreamError } from '../util.js';
import type { IngestResult } from './npm.js';
import { upsertVersions, type VersionRow } from '../versions.js';
import { vulnIdsBatch } from '../osv.js';

/** Metadata estática (CDN) de Packagist en formato Composer v2 "minificado". */
const REPO = 'https://repo.packagist.org/p2';

/**
 * El formato minificado de Composer sólo repite en cada versión los campos que cambian respecto de la anterior;
 * el valor "__unset" borra el campo. Esto lo expande a documentos completos.
 */
export function expandMinified(list: Array<Record<string, any>>): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = [];
  let prev: Record<string, any> = {};
  for (const item of list) {
    const cur: Record<string, any> = { ...prev };
    for (const [k, v] of Object.entries(item)) {
      if (v === '__unset') delete cur[k];
      else cur[k] = v;
    }
    out.push(cur);
    prev = cur;
  }
  return out;
}

/** "v13.35.0" → "13.35.0", "1.2" → "1.2.0"; null si no es una versión semver utilizable. */
export function semverOf(raw: string): string | null {
  const s = raw.trim().replace(/^v/i, '');
  if (semver.valid(s)) return s;
  if (/^\d+\.\d+$/.test(s)) return `${s}.0`;
  return null;
}

/** Restricción de Composer → rango semver: "|" y "||" como OR, comas como AND, sin banderas de estabilidad. */
export function composerRange(c: string | undefined | null): string | null {
  if (!c || typeof c !== 'string') return null;
  const r = c
    .replace(/@\w+/g, '')
    .replace(/\s*\|\|?\s*/g, ' || ')
    .replace(/\s*,\s*/g, ' ')
    .trim();
  return r && semver.validRange(r, { loose: true }) ? r : null;
}

export async function ingestPackagist(db: Queryable, entity: EntityRow): Promise<IngestResult> {
  const url = `${REPO}/${entity.name}.json`;
  const etag = entity.attrs?.versions_synced ? entity.attrs?.etags?.json : null;
  const res = await httpGet(url, { etag, timeoutMs: 45_000 });

  if (res.status === 404) {
    const changed = await tx((c) => setFact(c, entity, { predicate: 'exists', value: false, method: 'registry', confidence: 1, sourceUrl: url }));
    return { found: false, changed };
  }
  if (res.status === 304) {
    await touchFacts(db, entity.id);
    return { found: true, changed: false };
  }
  if (res.status !== 200) throw new UpstreamError(`packagist ${res.status}`, res.status);

  const d = JSON.parse(res.body);
  const raw: Array<Record<string, any>> = d.packages?.[entity.name] ?? [];
  const docs = d.minified ? expandMinified(raw) : raw;
  if (docs.length === 0) return { found: false, changed: false };

  const rows: VersionRow[] = [];
  const byVersion = new Map<string, Record<string, any>>();
  for (const v of docs) {
    const ver = semverOf(String(v.version ?? ''));
    if (!ver || byVersion.has(ver)) continue;
    byVersion.set(ver, v);
    const require: Record<string, string> = v.require ?? {};
    const peer: Record<string, string> = {};
    for (const [k, c] of Object.entries(require)) {
      if (k === 'php' || k.startsWith('ext-') || k.startsWith('lib-') || k === 'composer-plugin-api') continue;
      const r = composerRange(c);
      if (r) peer[k.toLowerCase()] = r;
    }
    const php = composerRange(require.php);
    rows.push({
      version: ver,
      published_at: typeof v.time === 'string' ? v.time : null,
      prerelease: (semver.prerelease(ver)?.length ?? 0) > 0,
      withdrawn: Boolean(v.abandoned),
      ...(php ? { engines: { php } } : {}),
      ...(Object.keys(peer).length ? { peer } : {}),
    });
  }
  const stable = rows.filter((r) => !r.prerelease).map((r) => r.version).sort(semver.rcompare);
  const latestVer = stable[0] ?? rows.map((r) => r.version).sort(semver.rcompare)[0];
  // Metapaquetes que sólo publican ramas de desarrollo (p. ej. roave/security-advisories): no hay versiones que seguir.
  if (!latestVer) return { found: false, changed: false };
  const latestDoc = byVersion.get(latestVer)!;
  const publishedAt: string | null = typeof latestDoc.time === 'string' ? latestDoc.time : null;
  const abandoned = latestDoc.abandoned;
  const src = { sourceUrl: url, sourceSha256: sha256(res.body) };
  const license = Array.isArray(latestDoc.license) ? latestDoc.license.join(' OR ').slice(0, 100) : null;
  const php = composerRange(latestDoc.require?.php);

  let advisories: string[] | null = null;
  try {
    const ids = await vulnIdsBatch('packagist', [{ name: entity.name, version: latestVer }]);
    advisories = [...new Set(ids[0] ?? [])].sort();
  } catch {
    advisories = null;
  }

  const changed = await tx(async (c) => {
    let any = false;
    await upsertVersions(c, entity.id, rows);
    const set = async (predicate: string, value: unknown, extra: Partial<Parameters<typeof setFact>[2]> = {}) => {
      any = (await setFact(c, entity, { predicate, value, method: 'registry', confidence: 1, ...src, ...extra })) || any;
    };
    await set('exists', true);
    await set('latest_version', { version: latestVer, published_at: publishedAt }, { validFrom: publishedAt, sourcePublishedAt: publishedAt });
    await set('php_requirement', php);
    await set('yanked', { yanked: false, reason: null });
    await set('deprecated', {
      deprecated: Boolean(abandoned),
      message: abandoned ? (typeof abandoned === 'string' ? `Abandoned on Packagist; suggested replacement: ${abandoned}` : 'Marked as abandoned on Packagist') : null,
    });
    await set('license', license);
    if (advisories) await set('advisories', advisories, { sourceUrl: 'https://api.osv.dev/v1/querybatch', confidence: 0.95 });
    const attrs = {
      ...entity.attrs,
      etags: { json: res.etag },
      versions_synced: true,
      requirements_v: 1,
      display_name: entity.name,
      description: typeof latestDoc.description === 'string' ? latestDoc.description.slice(0, 500) : null,
      repository: typeof latestDoc.source?.url === 'string' ? latestDoc.source.url.replace(/\.git$/, '').slice(0, 300) : null,
      homepage: typeof latestDoc.homepage === 'string' ? latestDoc.homepage.slice(0, 300) : null,
      release_count: rows.length,
    };
    await c.query(`UPDATE entity SET attrs = $2 WHERE id = $1`, [entity.id, attrs]);
    return any;
  });
  return { found: true, changed };
}
