import { config } from '../config.js';
import { LOCALES, t, type Locale, type MessageKey } from '../i18n/index.js';

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
`;

export function layout(
  L: Locale,
  opts: { title: string; description: string; path: string; body: string; ld?: unknown; mdPath?: string },
): string {
  const url = localeUrl(L, opts.path);
  const alternates = LOCALES.map((x) => `<link rel="alternate" hreflang="${x.lang}" href="${esc(localeUrl(x, opts.path))}">`).join('');
  const langLinks = LOCALES.map(
    (x) => `<a href="${esc(localeUrl(x, opts.path))}" hreflang="${x.lang}" lang="${x.lang}"${x === L ? ' aria-current="page"' : ''}>${esc(x.name)}</a>`,
  ).join('');
  const home = L.prefix ? `${L.prefix}/` : '/';
  return `<!doctype html><html lang="${L.lang}" dir="${L.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title)}</title><meta name="description" content="${esc(opts.description)}"><link rel="canonical" href="${esc(url)}">
${alternates}<link rel="alternate" hreflang="x-default" href="${esc(localeUrl(LOCALES[0]!, opts.path))}">
${opts.mdPath ? `<link rel="alternate" type="text/markdown" href="${esc(config.publicUrl + opts.mdPath)}">` : ''}
<link rel="alternate" type="application/json" href="${esc(config.publicUrl)}/openapi.json" title="OpenAPI">
${opts.ld ? `<script type="application/ld+json">${jsonLd(opts.ld)}</script>` : ''}
<style>${CSS}</style></head><body><main>
<header class="top"><a class="brand" href="${home}">Vigia</a><nav><a href="${L.prefix}/docs">${esc(t(L, 'nav.docs'))}</a><a href="${L.prefix}/changes">${esc(t(L, 'nav.changes'))}</a><a href="${L.prefix}/models">${esc(t(L, 'nav.models'))}</a><a href="/openapi.json">${esc(t(L, 'nav.api'))}</a></nav></header>
${opts.body}
<footer>${esc(t(L, 'footer.text'))} <a href="/llms.txt">llms.txt</a> · <a href="/v1/stats">${esc(t(L, 'footer.stats'))}</a>
<nav class="langs" aria-label="${esc(t(L, 'footer.languages'))}">${langLinks}</nav></footer>
</main></body></html>`;
}

const fmtDate = (s: unknown) => (s ? `<span dir="ltr">${esc(String(s).replace('T', ' ').replace(/\.\d+Z$|Z$/, ' UTC'))}</span>` : '<span class="muted">—</span>');
const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
const statusLabel = (L: Locale, s: string) => esc(t(L, `status.${s}` as MessageKey) ?? s);
const pkgPath = (d: any) => `/${d.ecosystem}/${d.entity.slice(d.ecosystem.length + 1)}`;

export function packageHtml(L: Locale, view: any, history: any[]): string {
  const d = view.data;
  const m = view.meta;
  const latest = d.latest ?? {};
  const none = `<span class="muted">${esc(t(L, 'pkg.noneDeclared'))}</span>`;
  const reqs =
    d.ecosystem === 'npm'
      ? d.requires?.engines ? `<code>${esc(JSON.stringify(d.requires.engines))}</code>` : none
      : d.requires?.python ? `<code>python ${esc(d.requires.python)}</code>` : none;
  const peers = d.requires?.peer_dependencies
    ? Object.entries(d.requires.peer_dependencies).map(([k, v]) => `<code>${esc(k)} ${esc(v)}</code>`).join(' ')
    : '<span class="muted">—</span>';
  const tags = d.dist_tags ? Object.entries(d.dist_tags).map(([k, v]) => `<code>${esc(k)}: ${esc(v)}</code>`).join(' ') : '';
  const version = latest.version ?? t(L, 'pkg.unknown');
  // Descripción y mensaje de deprecación vienen del registry: se muestran tal cual (sin traducir) y con lang neutro.
  const body = `
<p class="muted">${esc(d.ecosystem)} · <span dir="ltr">${esc(d.entity)}</span></p>
<h1><span dir="ltr">${esc(d.name)}</span> <span class="badge ${esc(d.status)}">${statusLabel(L, d.status)}</span></h1>
${d.description ? `<p dir="auto" lang="und">${esc(d.description)}</p>` : ''}
<div class="card"><table>
${row(t(L, 'pkg.latest'), `<strong dir="ltr">${esc(latest.version ?? '—')}</strong>`)}
${row(t(L, 'pkg.published'), fmtDate(latest.published_at))}
${d.deprecation ? row(t(L, 'pkg.deprecation'), `<span dir="auto" lang="und">${esc(d.deprecation.message)}</span>`) : ''}
${row(d.ecosystem === 'npm' ? t(L, 'pkg.requiresEngines') : t(L, 'pkg.requires'), reqs)}
${d.ecosystem === 'npm' ? row(t(L, 'pkg.peers'), peers) : ''}
${tags ? row(t(L, 'pkg.distTags'), tags) : ''}
${row(t(L, 'pkg.license'), esc(d.license ?? '—'))}
${row(t(L, 'pkg.advisories'), d.advisories_on_latest?.length ? d.advisories_on_latest.map((a: string) => `<code>${esc(a)}</code>`).join(' ') : esc(t(L, 'pkg.noneKnown')))}
${row(t(L, 'pkg.lastVerified'), fmtDate(m.last_verified_at))}
${row(t(L, 'pkg.sources'), m.sources.map((s: string) => `<a href="${esc(s)}" rel="nofollow">${esc(new URL(s).host)}</a>`).join(', '))}
</table></div>
<h2>${esc(t(L, 'pkg.changes'))}</h2>
${
  history.length
    ? `<ul class="changes">${history.map((h) => `<li>${fmtDate(h.detected_at)} — <strong>${esc(h.kind)}</strong> ${h.predicate === 'latest_version' ? `<span dir="ltr">${esc(h.old_value?.version)} → ${esc(h.new_value?.version)}</span>` : ''}</li>`).join('')}</ul>`
    : `<p class="muted">${esc(t(L, 'pkg.noChanges'))}</p>`
}
<h2>${esc(t(L, 'pkg.forAgents'))}</h2>
<pre>GET ${esc(config.publicUrl)}/v1/packages${esc(pkgPath(d))}</pre>`;
  return layout(L, {
    title: `${d.name} (${d.ecosystem}) — ${t(L, 'pkg.latestVersion')} ${version}`,
    description: t(L, 'pkg.metaDesc', { name: d.name, version, status: t(L, `status.${d.status}` as MessageKey), verified: m.last_verified_at ?? '' }),
    path: pkgPath(d),
    mdPath: `${pkgPath(d)}.md`,
    body,
    ld: {
      '@context': 'https://schema.org',
      '@type': 'SoftwareSourceCode',
      name: d.name,
      description: d.description ?? undefined,
      version: latest.version ?? undefined,
      dateModified: latest.published_at ?? undefined,
      license: d.license ?? undefined,
      codeRepository: d.repository ?? undefined,
      programmingLanguage: d.ecosystem === 'npm' ? 'JavaScript' : 'Python',
      sameAs: [d.links.registry],
      url: localeUrl(L, pkgPath(d)),
      inLanguage: L.lang,
    },
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
  return layout(L, { title, description: intro, path, body: `<h1>${esc(title)}</h1><p class="muted">${esc(intro)}</p>${items}` });
}

export function homeHtml(L: Locale, stats: Record<string, number | null>): string {
  const u = esc(config.publicUrl);
  const lag = stats.release_detection_lag_p50_s;
  const body = `
<h1>${esc(t(L, 'home.h1'))}</h1>
<p>${esc(t(L, 'home.lead'))}</p>
<div class="card"><table>
${row(t(L, 'stat.npm'), esc(stats.npm_tracked ?? 0))}
${row(t(L, 'stat.pypi'), esc(stats.pypi_tracked ?? 0))}
${row(t(L, 'stat.models'), esc(stats.models ?? 0))}
${row(t(L, 'stat.changes24h'), esc(stats.changes_24h ?? 0))}
${row(t(L, 'stat.lag'), lag == null ? '—' : esc(`${Math.round(lag / 60)} ${t(L, 'unit.min')}`))}
</table></div>
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

const ENDPOINTS: Array<[string, MessageKey]> = [
  ['GET /v1/packages/{npm|pypi}/{name}', 'docs.ep.package'],
  ['GET /v1/packages/{npm|pypi}/{name}/history', 'docs.ep.history'],
  ['POST /v1/check', 'docs.ep.check'],
  ['GET /v1/models · GET /v1/models/{id}', 'docs.ep.models'],
  ['GET /v1/changes?since={seq}', 'docs.ep.changes'],
  ['GET /v1/search?q=', 'docs.ep.search'],
  ['GET /v1/facts/{hash}', 'docs.ep.facts'],
  ['GET /v1/stats', 'docs.ep.stats'],
];
const SOURCES: MessageKey[] = ['docs.src.npm', 'docs.src.pypi', 'docs.src.models', 'docs.src.demand', 'docs.src.history'];

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
