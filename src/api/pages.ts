import { config } from '../config.js';
import { LOCALES, t, type AnyKey, type Locale } from '../i18n/index.js';

export const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** JSON para incrustar en <script type="application/ld+json"> sin permitir cerrar la etiqueta. */
const jsonLd = (o: unknown) => JSON.stringify(o).replace(/</g, '\\u003c');

/** URL absoluta de una ruta neutral ('/npm/next', '/') en un idioma. */
export function localeUrl(L: Locale, path: string): string {
  if (!L.prefix) return `${config.publicUrl}${path}`;
  return `${config.publicUrl}${L.prefix}${path === '/' ? '/' : path}`;
}

const CSS = `
:root{--bg:#fbfaf7;--fg:#1d1c1a;--muted:#6b675f;--line:#e4e0d8;--card:#fff;--accent:#1f5f8b;--ok:#2e7d4f;--warn:#a15c00;--bad:#b3261e;--code:#f3f1ec}
@media (prefers-color-scheme:dark){:root{--bg:#141412;--fg:#ecebe6;--muted:#a19d94;--line:#2c2b28;--card:#1b1a18;--accent:#7fb6dc;--ok:#6cc08b;--warn:#e0a54a;--bad:#f08a80;--code:#23221f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Arabic","Noto Sans Devanagari","Noto Sans JP","Noto Sans KR","Noto Sans SC",sans-serif}
main{max-width:860px;margin:0 auto;padding:32px 16px 64px}a{color:var(--accent)}
header.top{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:24px}
header.top a.brand{font-weight:700;text-decoration:none;color:var(--fg);font-size:18px}nav{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:14px}
h1{font-size:28px;margin:0 0 4px;word-break:break-word}h2{font-size:18px;margin:32px 0 8px}.muted{color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:12px 0;overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:14px}td,th{text-align:start;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:500;width:34%}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;background:var(--code);border-radius:6px}code{padding:1px 5px}pre{padding:12px;overflow-x:auto;margin:8px 0;direction:ltr;text-align:left}
.badge{display:inline-block;font-size:12px;font-weight:600;padding:2px 8px;border-radius:99px;border:1px solid currentColor}
.active,.available,.up_to_date{color:var(--ok)}.deprecated,.retiring,.outdated{color:var(--warn)}.yanked,.not_found_in_registry,.removed_from_catalog{color:var(--bad)}
ul{padding-inline-start:20px}ul.changes{font-size:14px}footer{margin-top:48px;font-size:13px;color:var(--muted)}
.langs{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:8px}.langs a[aria-current]{font-weight:700;color:var(--fg);text-decoration:none}
.crumbs{font-size:13px;color:var(--muted);margin:0 0 10px}.crumbs a{color:var(--muted)}.crumbs span[aria-hidden]{margin:0 6px}
details.faq{border-bottom:1px solid var(--line);padding:10px 0}details.faq summary{cursor:pointer;font-weight:600}details.faq p{margin:8px 0 0}
.grid{display:flex;flex-wrap:wrap;gap:6px 16px;padding:0;list-style:none}.pager{display:flex;gap:16px;align-items:center;margin:16px 0}
`;

/** Ícono del sitio (SVG): una "V" sobre un ojo de vigía. */
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1f5f8b"/><path d="M14 18h9l9 22 9-22h9L37 48h-10z" fill="#fff"/><circle cx="32" cy="14" r="4" fill="#7fd1ff"/></svg>`;

const OG_LOCALE: Record<string, string> = { en: 'en_US', es: 'es_ES', pt: 'pt_BR', fr: 'fr_FR', de: 'de_DE', it: 'it_IT', nl: 'nl_NL', pl: 'pl_PL', ru: 'ru_RU', uk: 'uk_UA', tr: 'tr_TR', ar: 'ar_AR', hi: 'hi_IN', id: 'id_ID', vi: 'vi_VN', ja: 'ja_JP', ko: 'ko_KR', zh: 'zh_CN' };

/** Migas de pan visibles + su JSON-LD (BreadcrumbList). */
export function crumbs(L: Locale, items: Array<[label: string, path: string | null]>): { html: string; ld: unknown } {
  const all: Array<[string, string | null]> = [[t(L, 'crumb.home'), '/'], ...items];
  const html = `<nav class="crumbs" aria-label="breadcrumb">${all
    .map(([label, path], i) => (path && i < all.length - 1 ? `<a href="${esc(localeUrl(L, path).slice(config.publicUrl.length))}">${esc(label)}</a>` : `<span>${esc(label)}</span>`))
    .join('<span aria-hidden="true">›</span>')}</nav>`;
  const ld = {
    '@type': 'BreadcrumbList',
    itemListElement: all.map(([label, path], i) => ({ '@type': 'ListItem', position: i + 1, name: label, ...(path ? { item: localeUrl(L, path) } : {}) })),
  };
  return { html, ld };
}

export function layout(
  L: Locale,
  opts: { title: string; description: string; path: string; body: string; ld?: unknown; mdPath?: string; singleLanguage?: boolean },
): string {
  const url = localeUrl(L, opts.path);
  const alternates = opts.singleLanguage ? '' : LOCALES.map((x) => `<link rel="alternate" hreflang="${x.lang}" href="${esc(localeUrl(x, opts.path))}">`).join('');
  const langLinks = opts.singleLanguage ? '' : LOCALES.map(
    (x) => `<a href="${esc(localeUrl(x, opts.path))}" hreflang="${x.lang}" lang="${x.lang}"${x === L ? ' aria-current="page"' : ''}>${esc(x.name)}</a>`,
  ).join('');
  const home = L.prefix ? `${L.prefix}/` : '/';
  const ldGraph = opts.ld === undefined ? null : Array.isArray(opts.ld) ? { '@context': 'https://schema.org', '@graph': opts.ld } : opts.ld;
  const og = [
    ['og:type', 'website'],
    ['og:site_name', 'Vigia'],
    ['og:title', opts.title],
    ['og:description', opts.description],
    ['og:url', url],
    ['og:locale', OG_LOCALE[L.code] ?? 'en_US'],
  ]
    .map(([p, c]) => `<meta property="${p}" content="${esc(c)}">`)
    .join('');
  return `<!doctype html><html lang="${L.lang}" dir="${L.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title)}</title><meta name="description" content="${esc(opts.description)}"><link rel="canonical" href="${esc(url)}">
${alternates}${opts.singleLanguage ? '' : `<link rel="alternate" hreflang="x-default" href="${esc(localeUrl(LOCALES[0]!, opts.path))}">`}
${opts.mdPath ? `<link rel="alternate" type="text/markdown" href="${esc(config.publicUrl + opts.mdPath)}">` : ''}
<link rel="alternate" type="application/json" href="${esc(config.publicUrl)}/openapi.json" title="OpenAPI">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><meta name="theme-color" content="#1f5f8b">
${og}<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(opts.title)}"><meta name="twitter:description" content="${esc(opts.description)}">
${ldGraph ? `<script type="application/ld+json">${jsonLd(ldGraph)}</script>` : ''}
<style>${CSS}</style></head><body><main>
<header class="top"><a class="brand" href="${home}">Vigia</a><nav><a href="${L.prefix}/check"><strong>${esc(t(L, 'nav.check'))}</strong></a><a href="${L.prefix}/upgrade">${esc(t(L, 'nav.upgrades'))}</a><a href="${L.prefix}/npm">npm</a><a href="${L.prefix}/pypi">PyPI</a><a href="${L.prefix}/docs">${esc(t(L, 'nav.docs'))}</a><a href="${L.prefix}/changes">${esc(t(L, 'nav.changes'))}</a><a href="${L.prefix}/models">${esc(t(L, 'nav.models'))}</a><a href="/openapi.json">${esc(t(L, 'nav.api'))}</a></nav></header>
${opts.body}
<footer>${esc(t(L, 'footer.text'))} <a href="${L.prefix}/status">${esc(t(L, 'nav.status'))}</a> · <a href="/terms">${esc(t(L, 'footer.terms'))}</a> · <a href="/privacy">${esc(t(L, 'footer.privacy'))}</a> · <a href="/llms.txt">llms.txt</a> · <a href="/v1/stats">${esc(t(L, 'footer.stats'))}</a>
<nav class="langs" aria-label="${esc(t(L, 'footer.languages'))}">${langLinks}</nav></footer>
</main></body></html>`;
}

const fmtDate = (s: unknown) => (s ? `<span dir="ltr">${esc(String(s).replace('T', ' ').replace(/\.\d+Z$|Z$/, ' UTC'))}</span>` : '<span class="muted">—</span>');
const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
const statusLabel = (L: Locale, s: string) => esc(t(L, `status.${s}` as AnyKey) ?? s);
const pkgPath = (d: any) => `/${d.ecosystem}/${d.entity.slice(d.ecosystem.length + 1)}`;

export interface PackageExtras {
  versions: Array<{ version: string; published_at: Date | null; prerelease: boolean; withdrawn: boolean }>;
  related: Array<{ ecosystem: string; name: string }>;
  compat?: Array<{ target: string; version: string | null }>;
  guides?: Array<{ from: number; to: number }>;
}

const daysSince = (iso: string | null | undefined) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null);
const dateOnly = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10) : '—');

export function packageHtml(L: Locale, view: any, history: any[], extras: PackageExtras): string {
  const d = view.data;
  const m = view.meta;
  const latest = d.latest ?? {};
  const mt = d.maintenance ?? {};
  const eco = d.ecosystem as 'npm' | 'pypi';
  const ecoLabel = eco === 'npm' ? 'npm' : 'PyPI';
  const runtime = eco === 'npm' ? 'Node.js' : 'Python';
  const none = `<span class="muted">${esc(t(L, 'pkg.noneDeclared'))}</span>`;
  const reqText: string | null = eco === 'npm' ? (d.requires?.engines ? JSON.stringify(d.requires.engines) : null) : d.requires?.python ? `python ${d.requires.python}` : null;
  const reqs = reqText ? `<code>${esc(reqText)}</code>` : none;
  const peerNames = d.requires?.peer_dependencies ? Object.keys(d.requires.peer_dependencies) : [];
  const relatedSet = new Set(extras.related.map((r) => r.name));
  const peers = d.requires?.peer_dependencies
    ? Object.entries(d.requires.peer_dependencies)
        .map(([k, v]) => (relatedSet.has(k) ? `<a href="${L.prefix}/${eco}/${esc(k)}"><code>${esc(k)} ${esc(v)}</code></a>` : `<code>${esc(k)} ${esc(v)}</code>`))
        .join(' ')
    : '<span class="muted">—</span>';
  const tags = d.dist_tags ? Object.entries(d.dist_tags).map(([k, v]) => `<code>${esc(k)}: ${esc(v)}</code>`).join(' ') : '';
  const version = latest.version ?? t(L, 'pkg.unknown');
  const activity = t(L, `maint.${mt.activity ?? 'unknown'}` as AnyKey);
  const advisories: string[] = d.advisories_on_latest ?? [];
  const path = pkgPath(d);
  const bc = crumbs(L, [[ecoLabel, `/${eco}`], [d.name, null]]);

  // Preguntas frecuentes: respuestas cortas, fechadas y verificables (lo que los buscadores de IA citan).
  const faq: Array<[string, string]> = [];
  if (latest.version) {
    faq.push([
      t(L, 'faq.latestQ', { name: d.name }),
      t(L, 'faq.latestA', { name: d.name, version: latest.version, date: dateOnly(latest.published_at), verified: dateOnly(m.last_verified_at) }),
    ]);
  }
  faq.push([
    t(L, 'faq.deprecatedQ', { name: d.name }),
    d.deprecation ? t(L, 'faq.deprecatedYes', { name: d.name, message: String(d.deprecation.message ?? '').slice(0, 200) }) : t(L, 'faq.deprecatedNo', { name: d.name }),
  ]);
  faq.push([
    t(L, 'faq.requiresQ', { name: d.name, runtime }),
    reqText ? t(L, 'faq.requiresA', { name: d.name, version, req: reqText }) : t(L, 'faq.requiresNone', { name: d.name, version, runtime }),
  ]);
  if (latest.version) {
    faq.push([
      t(L, 'faq.vulnQ', { name: d.name, version: latest.version }),
      advisories.length
        ? t(L, 'faq.vulnYes', { name: d.name, version: latest.version, count: advisories.length, ids: advisories.slice(0, 5).join(', ') })
        : t(L, 'faq.vulnNo', { name: d.name, version: latest.version }),
    ]);
  }
  if (mt.last_release_at) {
    faq.push([
      t(L, 'faq.maintQ', { name: d.name }),
      t(L, 'faq.maintA', { name: d.name, count: mt.releases_last_12m ?? 0, days: mt.days_since_last_release ?? daysSince(mt.last_release_at) ?? 0, activity }),
    ]);
  }

  const versionsRows = extras.versions
    .map(
      (v) =>
        `<tr><td><code dir="ltr">${esc(v.version)}</code>${v.prerelease ? ` <span class="muted">${esc(t(L, 'versions.prerelease'))}</span>` : ''}${v.withdrawn ? ` <span class="badge deprecated">${esc(t(L, 'versions.withdrawn'))}</span>` : ''}</td><td>${fmtDate(v.published_at?.toISOString())}</td></tr>`,
    )
    .join('');

  const body = `
${bc.html}
<p class="muted">${esc(ecoLabel)} · <span dir="ltr">${esc(d.entity)}</span></p>
<h1><span dir="ltr">${esc(d.name)}</span> <span class="badge ${esc(d.status)}">${statusLabel(L, d.status)}</span></h1>
${d.description ? `<p dir="auto" lang="und">${esc(d.description)}</p>` : ''}
<div class="card"><table>
${row(t(L, 'pkg.latest'), `<strong dir="ltr">${esc(latest.version ?? '—')}</strong>`)}
${row(t(L, 'pkg.published'), fmtDate(latest.published_at))}
${d.deprecation ? row(t(L, 'pkg.deprecation'), `<span dir="auto" lang="und">${esc(d.deprecation.message)}</span>`) : ''}
${row(eco === 'npm' ? t(L, 'pkg.requiresEngines') : t(L, 'pkg.requires'), reqs)}
${eco === 'npm' ? row(t(L, 'pkg.peers'), peers) : ''}
${tags ? row(t(L, 'pkg.distTags'), tags) : ''}
${row(t(L, 'pkg.license'), esc(d.license ?? '—'))}
${row(t(L, 'pkg.advisories'), advisories.length ? advisories.map((a) => `<a href="https://osv.dev/vulnerability/${encodeURIComponent(a)}" rel="nofollow"><code>${esc(a)}</code></a>`).join(' ') : esc(t(L, 'pkg.noneKnown')))}
${row(t(L, 'pkg.lastVerified'), fmtDate(m.last_verified_at))}
${row(t(L, 'pkg.sources'), m.sources.map((s: string) => `<a href="${esc(s)}" rel="nofollow">${esc(new URL(s).host)}</a>`).join(', '))}
</table></div>

${
  mt.total_versions
    ? `<h2>${esc(t(L, 'maint.title'))}</h2>
<div class="card"><table>
${row(t(L, 'maint.activity'), `<span class="badge ${mt.activity === 'active' ? 'active' : mt.activity === 'dormant' ? 'yanked' : 'deprecated'}">${esc(activity)}</span>`)}
${row(t(L, 'maint.lastRelease'), mt.last_release_at ? `${fmtDate(mt.last_release_at)} · ${esc(t(L, 'maint.daysAgo', { days: mt.days_since_last_release ?? 0 }))}` : '—')}
${row(t(L, 'maint.releases12m'), esc(mt.releases_last_12m ?? 0))}
${row(t(L, 'maint.totalVersions'), esc(mt.total_versions ?? 0))}
</table></div>
<p class="muted">${esc(t(L, 'maint.note'))}</p>`
    : ''
}

${
  extras.versions.length
    ? `<h2>${esc(t(L, 'versions.title'))}</h2>
<div class="card"><table><tr><th>${esc(t(L, 'versions.colVersion'))}</th><th>${esc(t(L, 'versions.colDate'))}</th></tr>${versionsRows}</table></div>
<p class="muted">${esc(t(L, 'versions.showing', { n: extras.versions.length, total: mt.stable_versions ?? extras.versions.length }))} <a href="/v1/packages${esc(path)}/versions?stable=true" rel="nofollow">JSON</a></p>`
    : ''
}

${packageIntelSections(L, eco, d.entity.slice(eco.length + 1), extras.compat ?? [], extras.guides ?? [])}

<h2>${esc(t(L, 'faq.title'))}</h2>
${faq.map(([q, a]) => `<details class="faq" open><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}

<h2>${esc(t(L, 'pkg.changes'))}</h2>
${
  history.length
    ? `<ul class="changes">${history.map((h) => `<li>${fmtDate(h.detected_at)} — <strong>${esc(h.kind)}</strong> ${h.predicate === 'latest_version' ? `<span dir="ltr">${esc(h.old_value?.version)} → ${esc(h.new_value?.version)}</span>` : ''}</li>`).join('')}</ul>`
    : `<p class="muted">${esc(t(L, 'pkg.noChanges'))}</p>`
}

${
  extras.related.length
    ? `<h2>${esc(t(L, 'related.title'))}</h2><ul class="grid">${extras.related
        .map((r) => `<li><a href="${L.prefix}/${esc(r.ecosystem)}/${esc(r.name)}" dir="ltr">${esc(r.name)}</a></li>`)
        .join('')}</ul>`
    : ''
}

${badgesSection(L, eco, d.entity.slice(eco.length + 1))}

<h2>${esc(t(L, 'pkg.forAgents'))}</h2>
<pre>GET ${esc(config.publicUrl)}/v1/packages${esc(path)}
GET ${esc(config.publicUrl)}/v1/packages${esc(path)}/versions/{version}</pre>`;

  return layout(L, {
    title: `${d.name} (${ecoLabel}) — ${t(L, 'pkg.latestVersion')} ${version}`,
    description: t(L, 'pkg.metaDesc', { name: d.name, version, status: t(L, `status.${d.status}` as AnyKey), verified: dateOnly(m.last_verified_at) }),
    path,
    mdPath: `${path}.md`,
    body,
    ld: [
      {
        '@type': 'SoftwareSourceCode',
        name: d.name,
        description: d.description ?? undefined,
        version: latest.version ?? undefined,
        dateModified: latest.published_at ?? undefined,
        license: d.license ?? undefined,
        codeRepository: d.repository ?? undefined,
        programmingLanguage: eco === 'npm' ? 'JavaScript' : 'Python',
        sameAs: [d.links.registry],
        url: localeUrl(L, path),
        inLanguage: L.lang,
      },
      bc.ld,
      {
        '@type': 'FAQPage',
        mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
      },
    ],
  });
}

/** Versión Markdown (para agentes): siempre en inglés, idioma neutral de las herramientas. */
export function packageMarkdown(view: any): string {
  const d = view.data;
  const m = view.meta;
  const l = d.latest ?? {};
  return [
    `# ${d.name} (${d.ecosystem})`,
    '',
    `- Status: ${d.status}`,
    `- Latest stable version: ${l.version ?? 'unknown'} (published ${l.published_at ?? 'unknown date'})`,
    d.deprecation ? `- Deprecation: ${d.deprecation.message}` : null,
    d.ecosystem === 'npm' ? `- Engines: ${d.requires?.engines ? JSON.stringify(d.requires.engines) : 'none declared'}` : `- Requires Python: ${d.requires?.python ?? 'none declared'}`,
    d.ecosystem === 'npm' && d.requires?.peer_dependencies ? `- Peer dependencies: ${JSON.stringify(d.requires.peer_dependencies)}` : null,
    `- License: ${d.license ?? 'unknown'}`,
    `- Advisories on latest version: ${d.advisories_on_latest?.length ? d.advisories_on_latest.join(', ') : 'none known'}`,
    `- Verified: ${m.last_verified_at ?? 'pending'}`,
    `- Sources: ${m.sources.join(', ')}`,
    '',
    `JSON: ${config.publicUrl}/v1/packages${pkgPath(d)}`,
  ]
    .filter((x) => x !== null)
    .join('\n');
}

export function modelHtml(L: Locale, view: any): string {
  const d = view.data;
  const p = d.pricing ?? {};
  const price = (n: number | null) => (n === null || n === undefined ? '—' : `US$ ${n}`);
  const variable = esc(t(L, 'model.variable'));
  const body = `
<p class="muted">${esc(t(L, 'model.kind'))} · ${esc(d.provider)}</p>
<h1><span dir="ltr">${esc(d.name)}</span> <span class="badge ${esc(d.status)}">${statusLabel(L, d.status)}</span></h1>
<p><code>${esc(d.id)}</code></p>
<div class="card"><table>
${row(t(L, 'model.input'), p.variable ? variable : `<span dir="ltr">${esc(price(p.input))}</span>`)}
${row(t(L, 'model.output'), p.variable ? variable : `<span dir="ltr">${esc(price(p.output))}</span>`)}
${row(t(L, 'model.context'), esc(d.context_length ?? '—'))}
${row(t(L, 'model.maxOut'), esc(d.max_output_tokens ?? '—'))}
${row(t(L, 'model.retirement'), d.expiration_date ? `<strong dir="ltr">${esc(d.expiration_date)}</strong>` : esc(t(L, 'model.none')))}
${row(t(L, 'model.cutoff'), esc(d.knowledge_cutoff ?? '—'))}
${row(t(L, 'pkg.lastVerified'), fmtDate(view.meta.last_verified_at))}
</table></div>
<p class="muted">${esc(t(L, 'model.note'))}</p>`;
  return layout(L, {
    title: `${d.name} — ${t(L, 'model.titleSuffix')}`,
    description: t(L, 'model.metaDesc', { id: d.id }),
    path: `/models/${d.id}`,
    body,
  });
}

export function listPage(L: Locale, title: string, intro: string, path: string, items: string): string {
  return layout(L, { title: `${title} — Vigia`, description: intro, path, body: `<h1>${esc(title)}</h1><p class="muted">${esc(intro)}</p>${items}` });
}

export function homeHtml(L: Locale, stats: Record<string, number | null>, popular: Record<'npm' | 'pypi', string[]>): string {
  const u = esc(config.publicUrl);
  const lag = stats.release_detection_lag_p50_s;
  const body = `
<h1>${esc(t(L, 'home.h1'))}</h1>
<p>${esc(t(L, 'home.lead'))}</p>
<p><a href="${L.prefix}/check"><strong>${esc(t(L, 'home.checkCta'))}</strong></a></p>
<div class="card"><table>
${row(t(L, 'stat.npm'), esc(stats.npm_tracked ?? 0))}
${row(t(L, 'stat.pypi'), esc(stats.pypi_tracked ?? 0))}
${row(t(L, 'stat.models'), esc(stats.models ?? 0))}
${row(t(L, 'stat.changes24h'), esc(stats.changes_24h ?? 0))}
${row(t(L, 'stat.lag'), lag == null ? '—' : esc(`${Math.round(lag / 60)} ${t(L, 'unit.min')}`))}
</table></div>
${popularLists(L, popular)}
<h2>${esc(t(L, 'home.try'))}</h2>
<pre>curl ${u}/v1/packages/npm/next
curl ${u}/v1/packages/pypi/requests
curl -X POST ${u}/v1/check -H 'content-type: application/json' \\
  -d '{"ecosystem":"npm","dependencies":{"react":"^17.0.0"}}'</pre>
<h2>${esc(t(L, 'home.connect'))}</h2>
<pre>claude mcp add --transport http vigia ${u}/mcp</pre>
<p>${esc(t(L, 'home.listed', { name: 'cloud.coredls.vigia/vigia' }))} <a href="${L.prefix}/docs">${esc(t(L, 'home.moreDocs'))}</a></p>`;
  return layout(L, {
    title: t(L, 'home.title'),
    description: t(L, 'home.metaDesc'),
    path: '/',
    body,
    ld: { '@context': 'https://schema.org', '@type': 'WebAPI', name: 'Vigia', url: localeUrl(L, '/'), documentation: localeUrl(L, '/docs'), inLanguage: L.lang },
  });
}

// ------------------------------------------------------------------------------------------ documentación

const ENDPOINTS: Array<[string, AnyKey]> = [
  ['GET /v1/packages/{npm|pypi}/{name}', 'docs.ep.package'],
  ['GET /v1/packages/{npm|pypi}/{name}/history', 'docs.ep.history'],
  ['GET /v1/packages/{npm|pypi}/{name}/versions', 'docs.ep.versions'],
  ['GET /v1/packages/{npm|pypi}/{name}/versions/{version}', 'docs.ep.version'],
  ['POST /v1/check', 'docs.ep.check'],
  ['GET /v1/models · GET /v1/models/{id}', 'docs.ep.models'],
  ['GET /v1/changes?since={seq}', 'docs.ep.changes'],
  ['GET /v1/search?q=', 'docs.ep.search'],
  ['GET /v1/facts/{hash}', 'docs.ep.facts'],
  ['GET /v1/stats', 'docs.ep.stats'],
];
const SOURCES: AnyKey[] = ['docs.src.npm', 'docs.src.pypi', 'docs.src.models', 'docs.src.demand', 'docs.src.history'];

export function docsMarkdown(L: Locale): string {
  const u = config.publicUrl;
  return [
    `# Vigia — ${t(L, 'docs.h1')}`,
    '',
    t(L, 'docs.intro'),
    '',
    `## ${t(L, 'docs.whenTitle')}`,
    `- ${t(L, 'docs.when1')}`,
    `- ${t(L, 'docs.when2')}`,
    `- ${t(L, 'docs.when3')}`,
    '',
    `## ${t(L, 'docs.mcpTitle')}`,
    `${t(L, 'docs.mcpText')} Endpoint: \`${u}/mcp\` — registry: \`cloud.coredls.vigia/vigia\``,
    '',
    `    claude mcp add --transport http vigia ${u}/mcp`,
    '',
    `## ${t(L, 'docs.restTitle')}`,
    ...ENDPOINTS.map(([ep, k]) => `- \`${ep}\` — ${t(L, k)}`),
    '',
    `OpenAPI: ${u}/openapi.json`,
    '',
    `## ${t(L, 'docs.sourcesTitle')}`,
    ...SOURCES.map((k) => `- ${t(L, k)}`),
    '',
    `## ${t(L, 'docs.limitsTitle')}`,
    t(L, 'docs.limits'),
    '',
    t(L, 'docs.langNote'),
    '',
  ].join('\n');
}

export function docsHtml(L: Locale): string {
  const u = esc(config.publicUrl);
  const body = `
<h1>${esc(t(L, 'docs.h1'))}</h1>
<p>${esc(t(L, 'docs.intro'))}</p>
<h2>${esc(t(L, 'docs.whenTitle'))}</h2>
<ul><li>${esc(t(L, 'docs.when1'))}</li><li>${esc(t(L, 'docs.when2'))}</li><li>${esc(t(L, 'docs.when3'))}</li></ul>
<h2>${esc(t(L, 'docs.mcpTitle'))}</h2>
<p>${esc(t(L, 'docs.mcpText'))}</p>
<pre>claude mcp add --transport http vigia ${u}/mcp</pre>
<h2>${esc(t(L, 'docs.restTitle'))}</h2>
<div class="card"><table>${ENDPOINTS.map(([ep, k]) => `<tr><th><code dir="ltr">${esc(ep)}</code></th><td>${esc(t(L, k))}</td></tr>`).join('')}</table></div>
<p><a href="/openapi.json">openapi.json</a></p>
<h2>${esc(t(L, 'docs.sourcesTitle'))}</h2>
<ul>${SOURCES.map((k) => `<li>${esc(t(L, k))}</li>`).join('')}</ul>
<h2>${esc(t(L, 'docs.limitsTitle'))}</h2>
<p>${esc(t(L, 'docs.limits'))}</p>
<p class="muted">${esc(t(L, 'docs.langNote'))}</p>`;
  return layout(L, { title: t(L, 'docs.title'), description: t(L, 'docs.metaDesc'), path: '/docs', mdPath: `${L.prefix}/docs.md`, body });
}

export function llmsTxt(): string {
  const u = config.publicUrl;
  return `# Vigia

> Verified, dated facts about the state of software (npm, PyPI) and AI models, for agents: latest version, deprecation, requirements and changes, with sources and verification timestamps.

## Docs
- [Documentation](${u}/docs.md): REST API and MCP server usage
- [OpenAPI](${u}/openapi.json): API specification

## API
- [npm package status](${u}/v1/packages/npm/react): GET /v1/packages/{npm|pypi}/{name}
- [Version status and vulnerabilities](${u}/v1/packages/npm/express/versions/4.17.1): GET /v1/packages/{npm|pypi}/{name}/versions/{version}
- [Version history and maintenance](${u}/v1/packages/npm/react/versions?stable=true): GET /v1/packages/{npm|pypi}/{name}/versions
- [Check dependencies](${u}/docs.md): POST /v1/check
- [AI models](${u}/v1/models): prices, context windows and retirement dates
- [Recent changes](${u}/v1/changes): changefeed

## MCP
- [MCP server](${u}/mcp): streamable HTTP, no auth, registry name cloud.coredls.vigia/vigia

## Documentation in other languages
${LOCALES.filter((L) => L.prefix)
  .map((L) => `- [${L.name}](${u}${L.prefix}/docs.md)`)
  .join('\n')}
`;
}

// ------------------------------------------------------------------------------------------ páginas índice y otras

export const BROWSE_PAGE_SIZE = 100;

export function browseHtml(
  L: Locale,
  eco: 'npm' | 'pypi',
  page: number,
  data: { total: number; items: Array<{ name: string; version: string | null; published_at: string | null; status: string }> },
): string {
  const ecoLabel = eco === 'npm' ? 'npm' : 'PyPI';
  const pages = Math.max(1, Math.ceil(data.total / BROWSE_PAGE_SIZE));
  const path = page > 1 ? `/${eco}?page=${page}` : `/${eco}`;
  const bc = crumbs(L, [[ecoLabel, null]]);
  const link = (p: number) => `${L.prefix}/${eco}${p > 1 ? `?page=${p}` : ''}`;
  const pager = `<nav class="pager" aria-label="pagination">${page > 1 ? `<a href="${link(page - 1)}" rel="prev">← ${esc(t(L, 'browse.prev'))}</a>` : ''}<span class="muted">${esc(t(L, 'browse.page', { n: page, total: pages }))}</span>${page < pages ? `<a href="${link(page + 1)}" rel="next">${esc(t(L, 'browse.next'))} →</a>` : ''}</nav>`;
  const rows = data.items
    .map(
      (x) =>
        `<tr><td><a href="${L.prefix}/${eco}/${esc(x.name)}" dir="ltr">${esc(x.name)}</a></td><td><code dir="ltr">${esc(x.version ?? '—')}</code></td><td><span class="badge ${esc(x.status)}">${statusLabel(L, x.status)}</span></td><td>${esc(dateOnly(x.published_at))}</td></tr>`,
    )
    .join('');
  const title = t(L, 'browse.title', { eco: ecoLabel });
  const body = `${bc.html}<h1>${esc(title)}</h1><p class="muted">${esc(t(L, 'browse.intro'))}</p>${pager}
<div class="card"><table><tr><th>${esc(t(L, 'browse.colPackage'))}</th><th>${esc(t(L, 'browse.colVersion'))}</th><th>${esc(t(L, 'browse.colStatus'))}</th><th>${esc(t(L, 'browse.colReleased'))}</th></tr>${rows}</table></div>${pager}`;
  return layout(L, {
    title: page > 1 ? `${title} — ${t(L, 'browse.page', { n: page, total: pages })}` : title,
    description: t(L, 'browse.intro'),
    path,
    body,
    ld: [{ '@type': 'CollectionPage', name: title, url: localeUrl(L, path), inLanguage: L.lang }, bc.ld],
  });
}

export function popularLists(L: Locale, lists: Record<'npm' | 'pypi', string[]>): string {
  return (['npm', 'pypi'] as const)
    .map((eco) => {
      const label = eco === 'npm' ? 'npm' : 'PyPI';
      return `<h2>${esc(t(L, 'home.popular', { eco: label }))}</h2><ul class="grid">${lists[eco]
        .map((n) => `<li><a href="${L.prefix}/${eco}/${esc(n)}" dir="ltr">${esc(n)}</a></li>`)
        .join('')}</ul><p><a href="${L.prefix}/${eco}">${esc(t(L, 'home.seeAll', { eco: label }))} →</a></p>`;
    })
    .join('');
}

export function statusHtml(L: Locale, s: Record<string, number | null>): string {
  const lag = s.release_detection_lag_p50_s;
  const body = `${crumbs(L, [[t(L, 'nav.status'), null]]).html}<h1>${esc(t(L, 'health.title'))}</h1><p>${esc(t(L, 'health.intro'))}</p>
<div class="card"><table>
${row(t(L, 'stat.npm'), esc(s.npm_tracked ?? 0))}
${row(t(L, 'stat.pypi'), esc(s.pypi_tracked ?? 0))}
${row(t(L, 'health.checked'), esc(s.packages_checked ?? 0))}
${row(t(L, 'health.verified1h'), esc(s.verified_last_hour ?? 0))}
${row(t(L, 'stat.models'), esc(s.models ?? 0))}
${row(t(L, 'health.facts'), esc(s.facts_recorded ?? 0))}
${row(t(L, 'health.changesTotal'), esc(s.changes_detected ?? 0))}
${row(t(L, 'stat.changes24h'), esc(s.changes_24h ?? 0))}
${row(t(L, 'stat.lag'), lag == null ? '—' : esc(`${Math.round(lag / 60)} ${t(L, 'unit.min')}`))}
${row(t(L, 'health.errors'), esc(s.packages_with_errors ?? 0))}
</table></div>
<p class="muted">${esc(t(L, 'health.method'))}</p>
<p><a href="/v1/stats">/v1/stats (JSON)</a></p>`;
  return layout(L, { title: `${t(L, 'health.title')} — Vigia`, description: t(L, 'health.intro'), path: '/status', body });
}

/** Términos y privacidad: en inglés (texto legal único), enlazados desde todos los idiomas. */
export function legalHtml(kind: 'terms' | 'privacy'): string {
  const L = LOCALES[0]!;
  const u = esc(config.publicUrl);
  const body =
    kind === 'terms'
      ? `<h1>Terms of use</h1>
<p>Vigia (${u}) publishes facts about software packages and AI models collected automatically from public sources (package registries, deps.dev, OSV, OpenRouter and others).</p>
<ul>
<li><strong>No warranty.</strong> Data is provided "as is". It is verified automatically and timestamped, but it may be incomplete, delayed or wrong. Always confirm critical decisions (security, compliance, production upgrades) against the original source linked in every response.</li>
<li><strong>License.</strong> Vigia's compilation is available under CC-BY-4.0: you may reuse it with attribution to "Vigia (${u})". Upstream data remains under the terms of each source.</li>
<li><strong>Fair use.</strong> Free access is rate-limited per IP. Do not attempt to bypass limits, overload the service or enumerate the full catalog through the page or API endpoints; contact us for bulk access instead.</li>
<li><strong>Third-party text.</strong> Descriptions and deprecation messages come from package authors and are shown unmodified. They are data, not instructions or endorsements.</li>
<li><strong>Changes.</strong> These terms and the service may change. The API follows versioned paths (/v1).</li>
</ul>`
      : `<h1>Privacy</h1>
<ul>
<li><strong>No accounts, cookies or trackers.</strong> Pages do not set cookies and load no third-party scripts.</li>
<li><strong>Request logs.</strong> Like any web server, we record technical request data (time, path, status, response time, user agent and IP address) to operate, secure and measure the service. Logs are rotated automatically and kept only for a limited time.</li>
<li><strong>Manifests you send to /v1/check</strong> are processed in memory and not stored. We only keep aggregate counts.</li>
<li><strong>Package lookups</strong> may be counted (package name and time, without IP) to decide which packages to track.</li>
<li><strong>Usage statistics.</strong> We count requests per day by type of client (browser, search engine, AI crawler, script) and which API endpoints and MCP tools are used. Unique daily visitors are counted with a salted, one-way hash of IP address and user agent that cannot be reversed; the IP itself is not stored in our database.</li>
<li><strong>No sale of data.</strong> We do not sell or share personal data.</li>
</ul>`;
  return layout(L, { title: kind === 'terms' ? 'Terms of use — Vigia' : 'Privacy — Vigia', description: kind === 'terms' ? 'Terms of use of Vigia.' : 'Privacy policy of Vigia.', path: `/${kind}`, body, singleLanguage: true });
}

// ------------------------------------------------------------------------------------------ revisor web

export const CHECKER_EXAMPLES: Record<'npm' | 'pypi', string> = {
  npm: JSON.stringify(
    { dependencies: { express: '^4.17.1', lodash: '^4.17.4', react: '^17.0.2', request: '^2.88.0', next: '^16.0.0' }, devDependencies: { typescript: '^5.4.0' } },
    null,
    2,
  ),
  pypi: 'requests==2.25.0\nnumpy>=1.24,<2\ndjango<4\nflask\npyyaml==5.3.1\n',
};

const VERDICT_BADGE: Record<string, string> = { up_to_date: 'active', outdated: 'deprecated', outdated_major: 'yanked', unpinned: 'deprecated', unsupported_spec: 'retiring' };

function checkerRow(L: Locale, eco: string, d: any): string {
  const verdict = 'error' in d ? 'unresolved' : d.verdict;
  const vulns: string[] = d.min_version_vulnerabilities ?? [];
  const link = 'error' in d ? esc(d.name) : `<a href="${L.prefix}/${eco}/${esc(d.name)}" dir="ltr">${esc(d.name)}</a>`;
  const dep = d.package_deprecated ? ` <span class="badge deprecated">${statusLabel(L, 'deprecated')}</span>` : '';
  const vulnCell = vulns.length
    ? `<code dir="ltr">${esc(d.min_version)}</code>: ${vulns
        .slice(0, 4)
        .map((id) => `<a href="https://osv.dev/vulnerability/${encodeURIComponent(id)}" rel="nofollow">${esc(id)}</a>`)
        .join(' ')}${vulns.length > 4 ? ` +${vulns.length - 4}` : ''}`
    : `<span class="muted">${esc(t(L, 'checker.none'))}</span>`;
  return `<tr><td>${link}${dep}</td><td><code dir="ltr">${esc(d.spec || '*')}</code></td><td><code dir="ltr">${esc(d.latest ?? '—')}</code></td><td><span class="badge ${VERDICT_BADGE[verdict] ?? 'retiring'}">${esc(t(L, `verdict.${verdict}` as AnyKey))}</span></td><td>${vulnCell}</td></tr>`;
}

export function checkerHtml(L: Locale, state: { eco: 'npm' | 'pypi'; manifest: string; result?: any; error?: string }): string {
  const r = state.result;
  let results = '';
  if (state.error) {
    results = `<p class="badge yanked">${esc(state.error)}</p>`;
  } else if (r && r.data.length === 0) {
    results = `<p>${esc(t(L, 'checker.empty'))}</p>`;
  } else if (r) {
    const s = r.summary;
    const summary = t(L, 'checker.summary', { total: s.total, major: s.outdated_major, outdated: s.outdated, deprecated: s.deprecated, vulnerable: s.min_version_vulnerable ?? 0 });
    const head = ['checker.colDep', 'checker.colDeclared', 'checker.colLatest', 'checker.colVerdict', 'checker.colVulns'].map((k) => `<th>${esc(t(L, k as AnyKey))}</th>`).join('');
    results = `<h2>${esc(t(L, 'checker.results'))}</h2><p>${esc(summary)}</p><div class="card"><table><tr>${head}</tr>${r.data.map((d: any) => checkerRow(L, state.eco, d)).join('')}</table></div>`;
  }
  const bc = crumbs(L, [[t(L, 'nav.check'), null]]);
  const sel = (v: string) => (state.eco === v ? ' selected' : '');
  const textareaStyle = 'width:100%;font:13px ui-monospace,Menlo,Consolas,monospace;background:var(--code);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:8px';
  const buttonStyle = 'font:inherit;font-weight:600;padding:8px 18px;border-radius:8px;border:0;background:var(--accent);color:var(--bg);cursor:pointer';
  const body = `${bc.html}<h1>${esc(t(L, 'checker.title'))}</h1><p>${esc(t(L, 'checker.intro'))}</p>
<form method="post" action="${L.prefix}/check" class="card">
<p><label>${esc(t(L, 'checker.ecosystem'))}: <select name="ecosystem"><option value="npm"${sel('npm')}>npm — package.json</option><option value="pypi"${sel('pypi')}>PyPI — requirements.txt</option></select></label>
 · <a href="${L.prefix}/check?example=npm">${esc(t(L, 'checker.example'))} (npm)</a> · <a href="${L.prefix}/check?example=pypi">${esc(t(L, 'checker.example'))} (PyPI)</a></p>
<p><label for="manifest">${esc(t(L, 'checker.manifest'))}</label><br><textarea id="manifest" name="manifest" rows="12" dir="ltr" spellcheck="false" style="${textareaStyle}" required maxlength="200000">${esc(state.manifest)}</textarea></p>
<p><button type="submit" style="${buttonStyle}">${esc(t(L, 'checker.submit'))}</button> <span class="muted">${esc(t(L, 'checker.privacy'))}</span></p>
</form>
${results}
<p class="muted">${esc(t(L, 'checker.agentHint'))}</p>`;
  return layout(L, {
    title: `${t(L, 'checker.title')} — package.json, requirements.txt | Vigia`,
    description: t(L, 'checker.metaDesc'),
    path: '/check',
    body,
    ld: [
      {
        '@type': 'WebApplication',
        name: t(L, 'checker.title'),
        url: localeUrl(L, '/check'),
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Any',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        inLanguage: L.lang,
      },
      bc.ld,
    ],
  });
}

/** Sección de badges para la página de un paquete (el enlace apunta siempre a la página canónica en inglés). */
export function badgesSection(L: Locale, eco: string, name: string): string {
  const page = localeUrl(LOCALES[0]!, `/${eco}/${name}`);
  const items = (['version', 'maintained', 'status'] as const).map((type) => {
    const src = `${config.publicUrl}/badge/${eco}/${name}/${type}.svg`;
    return { src, md: `[![${type}](${src})](${page})` };
  });
  const imgs = items.map((i) => `<img src="${esc(i.src.slice(config.publicUrl.length))}" alt="" height="20" loading="lazy">`).join(' ');
  return `<h2>${esc(t(L, 'badge.title'))}</h2><p>${esc(t(L, 'badge.intro'))}</p>\n<p>${imgs}</p>\n<pre>${items.map((i) => esc(i.md)).join('\n')}</pre>`;
}

// ------------------------------------------------------------------------------------------ panel privado

const CLASS_LABEL: Record<string, string> = {
  human: 'Personas (requests)',
  ai_user: 'Agentes de IA (fetch por usuario)',
  ai_crawler: 'Crawlers de IA',
  search_bot: 'Buscadores',
  other_bot: 'Otros bots / monitores',
  seo_bot: 'Bots SEO',
  script: 'Scripts / clientes (node, python, curl)',
  unknown: 'Desconocido',
};

const TOP_TITLES: Record<string, string> = {
  mcp: 'MCP: métodos y herramientas llamadas',
  mcp_client: 'MCP: clientes (clientInfo en initialize)',
  mcp_caller: 'MCP: quién llama herramientas (tipo de cliente)',
  api: 'API: rutas por tipo de cliente',
  checker: 'Revisor web: usos',
  badge: 'Badges servidos',
  badge_ref: 'Badges: sitio que los muestra',
  page: 'Páginas vistas por personas',
  referrer: 'Personas: de dónde vienen',
  bot: 'Bots más activos',
};

export function adminStatsHtml(data: {
  days: string[];
  byDay: Record<string, Record<string, number>>;
  visitors: Record<string, number>;
  top: Record<string, Array<{ key: string; n: number }>>;
}): string {
  const classes = Object.keys(CLASS_LABEL);
  const head = `<tr><th>Día</th><th>Visitantes únicos</th>${classes.map((c) => `<th>${esc(CLASS_LABEL[c])}</th>`).join('')}</tr>`;
  const rows = data.days
    .map((d) => `<tr><td dir="ltr">${d}</td><td><strong>${data.visitors[d] ?? 0}</strong></td>${classes.map((c) => `<td>${data.byDay[d]?.[c] ?? 0}</td>`).join('')}</tr>`)
    .join('');
  const tops = Object.entries(TOP_TITLES)
    .map(([dim, title]) => {
      const list = data.top[dim] ?? [];
      const table = list.length
        ? `<div class="card"><table>${list.map((x) => `<tr><td dir="ltr">${esc(x.key)}</td><td>${x.n}</td></tr>`).join('')}</table></div>`
        : '<p class="muted">Sin datos todavía.</p>';
      return `<h2>${esc(title)}</h2>${table}`;
    })
    .join('');
  const body = `<h1>Uso de Vigia (privado)</h1><p class="muted">Últimos ${data.days.length} días (UTC). Datos agregados, sin IPs. Se actualiza cada ~30 s.</p>
<div class="card"><table>${head}${rows}</table></div>${tops}`;
  const html = layout(LOCALES[0]!, { title: 'Estadísticas — Vigia', description: 'Panel privado', path: '/admin/stats', body, singleLanguage: true });
  return html.replace('<head>', '<head><meta name="robots" content="noindex,nofollow">');
}

// ------------------------------------------------------------------------------------------ guías de actualización

const codeCell = (s: string) => `<code dir="ltr">${esc(s)}</code>`;

function listTable(L: Locale, rows: string[][], head: string[]): string {
  if (rows.length === 0) return `<p class="muted">${esc(t(L, 'up.none'))}</p>`;
  return `<div class="card"><table><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table></div>`;
}

export function upgradeHtml(
  L: Locale,
  name: string,
  a: number,
  b: number,
  state: { status: 'ok'; data: any; meta: any } | { status: 'pending' } | { status: 'error'; message: string },
): string {
  const path = `/upgrade/npm/${name}/${a}-to-${b}`;
  const bc = crumbs(L, [[t(L, 'up.indexTitle'), '/upgrade'], [name, `/npm/${name}`], [`${a} → ${b}`, null]]);
  const h1 = `<h1>${esc(t(L, 'up.h1', { name, a, b }))}</h1>`;
  if (state.status !== 'ok') {
    const msg = state.status === 'pending' ? t(L, 'up.pending') : state.message;
    return layout(L, {
      title: t(L, 'up.title', { name, a, b }),
      description: t(L, 'up.metaDesc', { name, from: `${a}.x`, to: `${b}.x` }),
      path,
      body: `${bc.html}${h1}<p class="badge deprecated">${esc(msg)}</p>`,
    }).replace('<head>', '<head><meta name="robots" content="noindex">');
  }
  const d = state.data;
  const s = d.summary;
  const bc2 = d.breaking_candidates;
  const summaryRows = s
    ? [
        [t(L, 'up.removedModules'), s.removed_modules],
        [t(L, 'up.removedExports'), s.removed_exports],
        [t(L, 'up.changedSigs'), s.changed_signatures],
        [t(L, 'up.removedMembers'), s.removed_members],
        [t(L, 'up.changedMembers'), s.changed_members],
        [t(L, 'up.deprecated'), s.newly_deprecated],
        [t(L, 'up.reqChanges'), s.requirement_changes],
        [t(L, 'up.added'), s.added_exports],
      ]
    : [[t(L, 'up.reqChanges'), d.requirement_changes.length]];
  const summary = `<div class="card"><table>${summaryRows.map(([k, v]) => row(String(k), `<strong>${esc(v)}</strong>`)).join('')}</table></div>`;
  const sections: string[] = [];
  if (!s) sections.push(`<p class="muted">${esc(t(L, 'up.noTypes'))}</p>`);
  if (bc2) {
    if (bc2.removed_modules.length) sections.push(`<h2>${esc(t(L, 'up.removedModules'))}</h2>${listTable(L, bc2.removed_modules.map((m: string) => [codeCell(m)]), [t(L, 'up.removedModules')])}`);
    sections.push(`<h2>${esc(t(L, 'up.removedExports'))}</h2>${listTable(L, bc2.removed_exports.map((x: any) => [codeCell(x.module), codeCell(x.name), esc(x.kind), codeCell(x.sig)]), ['import', 'export', 'kind', t(L, 'up.before')])}`);
    sections.push(`<h2>${esc(t(L, 'up.changedSigs'))}</h2>${listTable(L, bc2.changed_signatures.map((x: any) => [codeCell(`${x.module} · ${x.name}`), codeCell(x.before), codeCell(x.after)]), ['export', t(L, 'up.before'), t(L, 'up.after')])}`);
    sections.push(`<h2>${esc(t(L, 'up.removedMembers'))}</h2>${listTable(L, bc2.removed_members.map((x: any) => [codeCell(`${x.owner}.${x.member}`), codeCell(x.module), codeCell(x.before)]), ['member', 'import', t(L, 'up.before')])}`);
    sections.push(`<h2>${esc(t(L, 'up.changedMembers'))}</h2>${listTable(L, bc2.changed_members.map((x: any) => [codeCell(`${x.owner}.${x.member}`), codeCell(x.before), codeCell(x.after)]), ['member', t(L, 'up.before'), t(L, 'up.after')])}`);
    sections.push(`<h2>${esc(t(L, 'up.deprecated'))}</h2>${listTable(L, d.newly_deprecated.map((x: any) => [codeCell(`${x.module} · ${x.name}`), `<span dir="auto" lang="und">${esc(x.message || '—')}</span>`]), ['export', '@deprecated'])}`);
  }
  sections.push(`<h2>${esc(t(L, 'up.reqChanges'))}</h2>${listTable(L, d.requirement_changes.map((x: any) => [codeCell(x.field), codeCell(x.before ?? '—'), codeCell(x.after ?? '—')]), ['', t(L, 'up.before'), t(L, 'up.after')])}`);
  if (s && d.added_exports.length) {
    sections.push(
      `<details><summary><strong>${esc(t(L, 'up.added'))} (${d.added_exports.length})</strong></summary>${listTable(L, d.added_exports.slice(0, 200).map((x: any) => [codeCell(x.module), codeCell(x.name), esc(x.kind)]), ['import', 'export', 'kind'])}</details>`,
    );
  }
  if (d.changelog.length) {
    sections.push(
      `<h2>${esc(t(L, 'up.changelog'))}</h2><p class="muted">${esc(t(L, 'up.changelogNote'))}</p>${d.changelog
        .map((c: any) => `<details class="faq"><summary><code dir="ltr">${esc(c.version)}</code></summary><pre style="white-space:pre-wrap" dir="auto" lang="und">${esc(c.text)}</pre></details>`)
        .join('')}`,
    );
  }

  const members = s ? s.removed_members + s.changed_members : 0;
  const faq: Array<[string, string]> = [
    [t(L, 'up.faqBreakingQ', { name, a, b }), s ? t(L, 'up.faqBreakingA', { name, from: d.from, to: d.to, removed: s.removed_exports, changed: s.changed_signatures, members }) : t(L, 'up.noTypes')],
  ];
  if (s) faq.push([t(L, 'up.faqDeprecatedQ', { name, b }), t(L, 'up.faqDeprecatedA', { name, to: d.to, count: s.newly_deprecated })]);

  const body = `${bc.html}${h1}
<p>${esc(t(L, 'up.intro', { name, from: d.from, to: d.to }))}</p>
<h2>${esc(t(L, 'up.summary'))}</h2>${summary}
${sections.join('\n')}
<h2>${esc(t(L, 'faq.title'))}</h2>
${faq.map(([q, ans]) => `<details class="faq" open><summary>${esc(q)}</summary><p>${esc(ans)}</p></details>`).join('')}
<h2>${esc(t(L, 'pkg.forAgents'))}</h2>
<pre>GET ${esc(config.publicUrl)}/v1/packages/npm/${esc(name)}/upgrade?from=${esc(d.from)}&amp;to=${esc(d.to)}</pre>`;

  return layout(L, {
    title: t(L, 'up.title', { name, a, b }),
    description: t(L, 'up.metaDesc', { name, from: d.from, to: d.to }),
    path,
    body,
    ld: [
      { '@type': 'TechArticle', headline: t(L, 'up.title', { name, a, b }), about: name, inLanguage: L.lang, url: localeUrl(L, path), dateModified: state.meta?.as_of },
      bc.ld,
      { '@type': 'FAQPage', mainEntity: faq.map(([q, ans]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: ans } })) },
    ],
  });
}

export function upgradesIndexHtml(L: Locale, guides: Array<{ name: string; from: number; to: number }>): string {
  const bc = crumbs(L, [[t(L, 'up.indexTitle'), null]]);
  const rows = guides
    .map(
      (g) =>
        `<tr><td><a href="${L.prefix}/npm/${esc(g.name)}" dir="ltr">${esc(g.name)}</a></td><td><a href="${L.prefix}/upgrade/npm/${esc(g.name)}/${g.from}-to-${g.to}" dir="ltr">${g.from}.x → ${g.to}.x</a></td></tr>`,
    )
    .join('');
  const body = `${bc.html}<h1>${esc(t(L, 'up.indexTitle'))}</h1><p class="muted">${esc(t(L, 'up.indexIntro'))}</p>
${guides.length ? `<div class="card"><table><tr><th>${esc(t(L, 'browse.colPackage'))}</th><th>${esc(t(L, 'up.colGuide'))}</th></tr>${rows}</table></div>` : `<p class="muted">${esc(t(L, 'up.pending'))}</p>`}`;
  return layout(L, { title: `${t(L, 'up.indexTitle')} — npm | Vigia`, description: t(L, 'up.indexIntro'), path: '/upgrade', body, ld: [bc.ld] });
}

/** Secciones extra de la página del paquete: compatibilidad por runtime y guías disponibles. */
export function packageIntelSections(
  L: Locale,
  eco: string,
  name: string,
  compat: Array<{ target: string; version: string | null }>,
  guides: Array<{ from: number; to: number }>,
): string {
  let html = '';
  if (compat.length) {
    html += `<h2>${esc(t(L, 'compat.title'))}</h2><p class="muted">${esc(t(L, 'compat.intro'))}</p><div class="card"><table><tr><th>${esc(t(L, 'compat.colRuntime'))}</th><th>${esc(t(L, 'compat.colVersion'))}</th></tr>${compat
      .map((c) => `<tr><td>${codeCell(c.target.replace('@', ' '))}</td><td>${c.version ? codeCell(c.version) : `<span class="muted">${esc(t(L, 'compat.none'))}</span>`}</td></tr>`)
      .join('')}</table></div>`;
  }
  if (guides.length) {
    html += `<h2>${esc(t(L, 'pkg.upgradeGuides'))}</h2><ul class="grid">${guides
      .map((g) => `<li><a href="${L.prefix}/upgrade/${eco}/${esc(name)}/${g.from}-to-${g.to}" dir="ltr">${g.from}.x → ${g.to}.x</a></li>`)
      .join('')}</ul>`;
  }
  return html;
}
