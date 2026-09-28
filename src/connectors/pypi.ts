import { tx, type Queryable } from '../db.js';
import { setFact, touchFacts, type EntityRow } from '../facts.js';
import { httpGet, normalizePypiName, sha256, UpstreamError } from '../util.js';
import type { IngestResult } from './npm.js';
import { isPrerelease, upsertVersions, type VersionRow } from '../versions.js';

const INACTIVE_CLASSIFIER = 'Development Status :: 7 - Inactive';

function repoFrom(projectUrls: Record<string, string> | null | undefined): string | null {
  if (!projectUrls) return null;
  for (const [label, url] of Object.entries(projectUrls)) {
    if (/^(source|source code|repository|code|github)$/i.test(label.trim())) return url.slice(0, 300);
  }
  return null;
}

export async function ingestPypi(db: Queryable, entity: EntityRow): Promise<IngestResult> {
  const url = `https://pypi.org/pypi/${encodeURIComponent(entity.name)}/json`;
  // Sin historial de versiones todavía: descarga completa (ignoramos el ETag una vez).
  const etag = entity.attrs?.versions_synced ? entity.attrs?.etags?.json : null;
  const res = await httpGet(url, { etag, timeoutMs: 30_000 });

  if (res.status === 404) {
    const changed = await tx((c) => setFact(c, entity, { predicate: 'exists', value: false, method: 'registry', confidence: 1, sourceUrl: url }));
    return { found: false, changed };
  }
  if (res.status === 304) {
    await touchFacts(db, entity.id);
    return { found: true, changed: false };
  }
  if (res.status !== 200) throw new UpstreamError(`pypi ${res.status}`, res.status);

  const d = JSON.parse(res.body);
  const info = d.info ?? {};
  const version: string = info.version;
  const files: Array<{ upload_time_iso_8601?: string }> = d.urls ?? [];
  const publishedAt = files.map((f) => f.upload_time_iso_8601).filter(Boolean).sort()[0] ?? null;
  const src = { sourceUrl: url, sourceSha256: sha256(res.body) };
  const inactive = Array.isArray(info.classifiers) && info.classifiers.includes(INACTIVE_CLASSIFIER);
  const license: string | null =
    info.license_expression || (typeof info.license === 'string' && info.license.length > 0 && info.license.length <= 100 ? info.license : null);
  const vulns = Array.isArray(d.vulnerabilities)
    ? d.vulnerabilities.map((v: any) => String(v.id)).sort()
    : [];

  const versionRows: VersionRow[] = Object.entries<any[]>(d.releases ?? {}).map(([v, files]) => ({
    version: v,
    published_at: files.map((f) => f.upload_time_iso_8601).filter(Boolean).sort()[0] ?? null,
    prerelease: isPrerelease('pypi', v),
    // Una versión cuenta como retirada si todos sus archivos fueron yanked.
    withdrawn: files.length > 0 && files.every((f) => f.yanked === true),
  }));

  const changed = await tx(async (c) => {
    let any = false;
    await upsertVersions(c, entity.id, versionRows);
    const set = async (predicate: string, value: unknown, extra: Partial<Parameters<typeof setFact>[2]> = {}) => {
      any = (await setFact(c, entity, { predicate, value, method: 'registry', confidence: 1, ...src, ...extra })) || any;
    };
    await set('exists', true);
    await set('latest_version', { version, published_at: publishedAt }, { validFrom: publishedAt, sourcePublishedAt: publishedAt });
    await set('requires_python', info.requires_python || null);
    await set('yanked', { yanked: Boolean(info.yanked), reason: info.yanked_reason ? String(info.yanked_reason).slice(0, 500) : null });
    // PyPI no tiene "deprecated" formal; el clasificador "Inactive" es la señal que declara el propio autor.
    await set('deprecated', { deprecated: inactive, message: inactive ? `Classifier: ${INACTIVE_CLASSIFIER}` : null }, { confidence: 0.8 });
    await set('license', license);
    await set('requires_dist', Array.isArray(info.requires_dist) ? info.requires_dist.slice(0, 200) : []);
    await set('advisories', vulns);
    const attrs = {
      ...entity.attrs,
      etags: { json: res.etag },
      versions_synced: true,
      display_name: info.name ?? entity.name,
      description: typeof info.summary === 'string' ? info.summary.slice(0, 500) : null,
      repository: repoFrom(info.project_urls),
      homepage: info.home_page || info.project_urls?.Homepage || null,
      release_count: d.releases ? Object.keys(d.releases).length : null,
    };
    await c.query(`UPDATE entity SET attrs = $2 WHERE id = $1`, [entity.id, attrs]);
    return any;
  });
  return { found: true, changed };
}

/** Lee el feed RSS de actualizaciones de PyPI y adelanta la revisión de los paquetes que seguimos. */
export async function pollPypiRss(db: Queryable): Promise<number> {
  const res = await httpGet('https://pypi.org/rss/updates.xml', { accept: 'application/rss+xml' });
  if (res.status !== 200) throw new UpstreamError(`pypi rss ${res.status}`, res.status);
  const names = new Set<string>();
  for (const m of res.body.matchAll(/<item>\s*<title>([^<]+)<\/title>/g)) {
    const title = m[1]!.trim();
    const name = title.slice(0, title.lastIndexOf(' ')).trim();
    if (name) names.add(`pypi:${normalizePypiName(name)}`);
  }
  if (names.size === 0) return 0;
  const r = await db.query(`UPDATE entity SET next_check_at = now() WHERE key = ANY($1) AND tracked AND next_check_at > now()`, [[...names]]);
  return r.rowCount ?? 0;
}
