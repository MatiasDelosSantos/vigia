import { tx, type Queryable } from '../db.js';
import { factsOf, setFact, touchFacts, type EntityRow } from '../facts.js';
import { httpGet, sha256, UpstreamError } from '../util.js';

export interface IngestResult {
  found: boolean;
  changed: boolean;
}

const REGISTRY = 'https://registry.npmjs.org';
const DIST_TAGS_MAX_AGE_MS = 6 * 3600_000;
const DEPSDEV_MAX_AGE_MS = 24 * 3600_000;

/** npm acepta el nombre con scope codificando sólo la barra: @scope%2fname. */
const encodeNpm = (name: string) => name.replace('/', '%2f');

interface DepsDevVersion {
  publishedAt?: string;
  isDeprecated?: boolean;
  deprecatedReason?: string;
  advisoryKeys?: Array<{ id: string }>;
}

async function fetchDepsDev(name: string, version: string): Promise<{ data: DepsDevVersion | null; url: string }> {
  const url = `https://api.deps.dev/v3/systems/npm/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`;
  try {
    const r = await httpGet(url);
    return { data: r.status === 200 ? (JSON.parse(r.body) as DepsDevVersion) : null, url };
  } catch {
    return { data: null, url }; // deps.dev es complementaria: si falla, seguimos con los datos del registry
  }
}

function licenseOf(m: any): string | null {
  if (typeof m.license === 'string') return m.license.slice(0, 100);
  if (m.license && typeof m.license.type === 'string') return m.license.type.slice(0, 100);
  return null;
}

function repoUrl(m: any): string | null {
  const r = typeof m.repository === 'string' ? m.repository : m.repository?.url;
  return typeof r === 'string' ? r.replace(/^git\+/, '').replace(/\.git$/, '').slice(0, 300) : null;
}

/**
 * Refresca un paquete npm. Usa /{name}/latest (≈3 KB) con ETag en lugar del documento completo
 * (que para paquetes grandes supera los 25 MB); la fecha de publicación y advisories vienen de deps.dev.
 */
export async function ingestNpm(db: Queryable, entity: EntityRow): Promise<IngestResult> {
  const etags = entity.attrs?.etags ?? {};
  const latestUrl = `${REGISTRY}/${encodeNpm(entity.name)}/latest`;
  const res = await httpGet(latestUrl, { etag: etags.latest });

  if (res.status === 404) {
    const changed = await tx((c) => setFact(c, entity, { predicate: 'exists', value: false, method: 'registry', confidence: 1, sourceUrl: latestUrl }));
    return { found: false, changed };
  }
  if (res.status !== 200 && res.status !== 304) throw new UpstreamError(`npm ${res.status}`, res.status);

  const current = await factsOf(db, entity.id);
  const now = Date.now();
  const distTagsFact = current.get('dist_tags');
  const needDistTags = res.status === 200 || !distTagsFact || now - distTagsFact.last_verified_at.getTime() > DIST_TAGS_MAX_AGE_MS;

  if (res.status === 304 && !needDistTags) {
    const advisories = current.get('advisories');
    if (!advisories || now - advisories.last_verified_at.getTime() <= DEPSDEV_MAX_AGE_MS) {
      await touchFacts(db, entity.id);
      return { found: true, changed: false };
    }
  }

  // Si el registry respondió 304 reconstruimos el manifest desde lo que ya sabemos.
  const manifest = res.status === 200 ? JSON.parse(res.body) : null;
  const version: string = manifest?.version ?? current.get('latest_version')?.value?.version;
  if (!version) throw new UpstreamError('npm: sin versión en /latest', 502);

  const prevVersion = current.get('latest_version')?.value?.version;
  const advisoriesFact = current.get('advisories');
  const needDepsDev = version !== prevVersion || !advisoriesFact || now - advisoriesFact.last_verified_at.getTime() > DEPSDEV_MAX_AGE_MS;
  const depsdev = needDepsDev ? await fetchDepsDev(entity.name, version) : null;

  let distTags: Record<string, string> | null = null;
  let distTagsEtag = etags.distTags ?? null;
  const distTagsUrl = `${REGISTRY}/-/package/${encodeNpm(entity.name)}/dist-tags`;
  if (needDistTags) {
    const dt = await httpGet(distTagsUrl, { etag: etags.distTags });
    if (dt.status === 200) {
      distTags = JSON.parse(dt.body);
      distTagsEtag = dt.etag;
    }
  }

  const publishedAt =
    depsdev?.data?.publishedAt ?? (version === prevVersion ? current.get('latest_version')?.value?.published_at ?? null : null);
  const src = { sourceUrl: latestUrl, sourceSha256: res.status === 200 ? sha256(res.body) : null };

  const changed = await tx(async (c) => {
    let any = false;
    any = (await setFact(c, entity, { predicate: 'exists', value: true, method: 'registry', confidence: 1, ...src })) || any;
    any =
      (await setFact(c, entity, {
        predicate: 'latest_version',
        value: { version, published_at: publishedAt },
        validFrom: publishedAt,
        sourcePublishedAt: publishedAt,
        method: depsdev?.data?.publishedAt ? 'registry+depsdev' : 'registry',
        confidence: 1,
        ...src,
      })) || any;
    if (manifest) {
      const deprecated = typeof manifest.deprecated === 'string' && manifest.deprecated.length > 0;
      any =
        (await setFact(c, entity, {
          predicate: 'deprecated',
          value: { deprecated, message: deprecated ? String(manifest.deprecated).slice(0, 500) : null },
          method: 'registry',
          confidence: 1,
          ...src,
        })) || any;
      any = (await setFact(c, entity, { predicate: 'engines', value: manifest.engines ?? null, method: 'registry', confidence: 1, ...src })) || any;
      any =
        (await setFact(c, entity, { predicate: 'peer_dependencies', value: manifest.peerDependencies ?? null, method: 'registry', confidence: 1, ...src })) ||
        any;
      any = (await setFact(c, entity, { predicate: 'license', value: licenseOf(manifest), method: 'registry', confidence: 1, ...src })) || any;
    } else {
      await touchFacts(c, entity.id);
    }
    if (distTags) {
      any = (await setFact(c, entity, { predicate: 'dist_tags', value: distTags, method: 'registry', confidence: 1, sourceUrl: distTagsUrl })) || any;
    }
    if (depsdev?.data) {
      const ids = (depsdev.data.advisoryKeys ?? []).map((a) => a.id).sort();
      any =
        (await setFact(c, entity, { predicate: 'advisories', value: ids, method: 'depsdev', confidence: 0.95, sourceUrl: depsdev.url })) || any;
    }
    const attrs = {
      ...entity.attrs,
      etags: { latest: res.etag ?? etags.latest ?? null, distTags: distTagsEtag },
      ...(manifest
        ? {
            description: typeof manifest.description === 'string' ? manifest.description.slice(0, 500) : null,
            repository: repoUrl(manifest),
            homepage: typeof manifest.homepage === 'string' ? manifest.homepage.slice(0, 300) : null,
          }
        : {}),
    };
    await c.query(`UPDATE entity SET attrs = $2 WHERE id = $1`, [entity.id, attrs]);
    return any;
  });
  return { found: true, changed };
}
