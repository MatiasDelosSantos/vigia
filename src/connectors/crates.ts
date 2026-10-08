import semver from 'semver';
import { tx, type Queryable } from '../db.js';
import { setFact, touchFacts, type EntityRow } from '../facts.js';
import { httpGet, sha256, UpstreamError } from '../util.js';
import type { IngestResult } from './npm.js';
import { upsertVersions, type VersionRow } from '../versions.js';
import { vulnIdsBatch } from '../osv.js';

/** crates.io pide un User-Agent identificable y no más de 1 request por segundo (ver util.httpGet y config.hostGapMs). */
const API = 'https://crates.io/api/v1/crates';

interface CrateVersion {
  num: string;
  created_at?: string;
  yanked?: boolean;
  rust_version?: string | null;
  license?: string | null;
}

export async function ingestCrates(db: Queryable, entity: EntityRow): Promise<IngestResult> {
  const url = `${API}/${encodeURIComponent(entity.name)}`;
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
  if (res.status !== 200) throw new UpstreamError(`crates.io ${res.status}`, res.status);

  const d = JSON.parse(res.body);
  const crate = d.crate ?? {};
  const versions: CrateVersion[] = Array.isArray(d.versions) ? d.versions : [];
  const latestNum: string | undefined = crate.max_stable_version ?? crate.max_version ?? crate.newest_version;
  const latest = versions.find((v) => v.num === latestNum);
  if (!latestNum) throw new UpstreamError('crates.io: respuesta sin versiones', 502);
  const publishedAt = latest?.created_at ?? null;
  const src = { sourceUrl: url, sourceSha256: sha256(res.body) };

  const rows: VersionRow[] = versions
    .filter((v) => typeof v.num === 'string')
    .map((v) => ({
      version: v.num,
      published_at: v.created_at ?? null,
      prerelease: (semver.prerelease(v.num)?.length ?? 0) > 0,
      withdrawn: v.yanked === true,
      // La versión mínima de Rust que declara cada versión (rust-version); sin declarar = desconocida.
      ...(v.rust_version ? { engines: { rust: v.rust_version } } : {}),
    }));

  // Avisos de seguridad de la última versión (OSV); si OSV falla se conservan los ya guardados.
  let advisories: string[] | null = null;
  try {
    const ids = await vulnIdsBatch('crates', [{ name: entity.name, version: latestNum }]);
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
    await set('latest_version', { version: latestNum, published_at: publishedAt }, { validFrom: publishedAt, sourcePublishedAt: publishedAt });
    await set('rust_version', latest?.rust_version ?? null);
    await set('yanked', { yanked: latest?.yanked === true, reason: null });
    // crates.io no tiene "deprecated" formal; se publica explícitamente para que la forma de los datos sea igual a la de los otros ecosistemas.
    await set('deprecated', { deprecated: false, message: null });
    await set('license', latest?.license ? String(latest.license).slice(0, 100) : null);
    if (advisories) await set('advisories', advisories, { sourceUrl: 'https://api.osv.dev/v1/querybatch', confidence: 0.95 });
    const attrs = {
      ...entity.attrs,
      etags: { json: res.etag },
      versions_synced: true,
      requirements_v: 1,
      display_name: crate.name ?? entity.name,
      description: typeof crate.description === 'string' ? crate.description.slice(0, 500) : null,
      repository: typeof crate.repository === 'string' ? crate.repository.slice(0, 300) : null,
      homepage: typeof crate.homepage === 'string' ? crate.homepage.slice(0, 300) : null,
      release_count: versions.length,
      downloads: typeof crate.downloads === 'number' ? crate.downloads : null,
    };
    await c.query(`UPDATE entity SET attrs = $2 WHERE id = $1`, [entity.id, attrs]);
    return any;
  });
  return { found: true, changed };
}
