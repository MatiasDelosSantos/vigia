import { config } from '../config.js';
import { LOCALES } from '../i18n/index.js';
import { agentSection, crumbs, esc, layout, localeUrl } from './pages.js';
import type { changesSince } from '../since.js';

const L = LOCALES[0]!;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const ECO_LABEL: Record<string, string> = { npm: 'npm', pypi: 'PyPI', crates: 'crates.io', packagist: 'Packagist' };
const code = (s: string) => `<code dir="ltr">${esc(s)}</code>`;

/** Meses con página propia: desde enero de 2024 hasta el mes pasado (el mes en curso aún no terminó). */
export function sinceMonths(now = new Date()): string[] {
  const out: string[] = [];
  let y = 2024;
  let m = 1;
  const endY = now.getUTCFullYear();
  const endM = now.getUTCMonth(); // 0-based: el mes en curso queda afuera
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export function sinceIndexHtml(months: string[]): string {
  const bc = crumbs(L, [['What changed since', null]]);
  const byYear = new Map<string, string[]>();
  for (const m of months) byYear.set(m.slice(0, 4), [...(byYear.get(m.slice(0, 4)) ?? []), m]);
  const body = `${bc.html}<h1>What changed in software since your knowledge cutoff</h1>
<p>AI models are trained up to a date and ecosystems keep moving. Pick the month your model's training data ends to see the major package versions, runtime releases, end-of-life dates and AI models that appeared after it.</p>
${[...byYear.entries()]
  .reverse()
  .map(([y, ms]) => `<h2>${esc(y)}</h2><ul class="grid">${ms.map((m) => `<li><a href="/since/${m}">${esc(monthLabel(m))}</a></li>`).join('')}</ul>`)
  .join('')}
${agentSection(L)}
<h2>For agents</h2>
<pre>GET ${esc(config.publicUrl)}/v1/since?cutoff=2025-06</pre>`;
  return layout(L, {
    title: 'What changed in software since a date: new major versions, runtimes and AI models — Vigia',
    description: 'For any month since 2024: the npm, PyPI, Rust and PHP packages that shipped a new major version, the runtimes released or ended, and the AI models launched after it.',
    path: '/since',
    body,
    singleLanguage: true,
    ld: [bc.ld, { '@type': 'CollectionPage', name: 'What changed in software since a date', url: localeUrl(L, '/since') }],
  });
}

export function sinceHtml(ym: string, r: Awaited<ReturnType<typeof changesSince>>, neighbours: { prev: string | null; next: string | null }): string {
  const d = r.data;
  const label = monthLabel(ym);
  const path = `/since/${ym}`;
  const bc = crumbs(L, [['What changed since', '/since'], [label, null]]);
  const majors = d.new_major_versions
    .map((m) => {
      const nm = m.new_majors.map((x) => `${x.major}.x <span class="muted">(${esc(x.first_published)})</span>`).join(', ');
      const guide = m.upgrade_guide ? ` · <a href="${esc(m.upgrade_guide.replace(config.publicUrl, ''))}">what breaks</a>` : '';
      return `<tr><td><a href="/${esc(m.ecosystem)}/${esc(m.name)}" dir="ltr">${esc(m.name)}</a> <span class="muted">${esc(ECO_LABEL[m.ecosystem] ?? m.ecosystem)}</span></td><td>${code(m.version_at_cutoff)}</td><td>${nm}${guide}</td><td>${code(m.latest)}</td></tr>`;
    })
    .join('');
  const rt = d.runtimes_and_platforms;
  const cyc = (rows: Array<{ product: string; label: string; cycle: string }>, extra: (x: any) => string) =>
    rows.length ? `<ul>${rows.map((x) => `<li><a href="/eol/${esc(x.product)}/${esc(x.cycle)}">${esc(x.label)} ${esc(x.cycle)}</a> ${extra(x)}</li>`).join('')}</ul>` : '<p class="muted">None.</p>';
  const models = d.ai_models_released
    .map((m) => `<tr><td><a href="/models/${esc(m.id)}" dir="ltr">${esc(m.id)}</a></td><td>${esc(m.released)}</td><td dir="ltr">${m.input_per_million_usd === null ? '—' : `US$ ${esc(m.input_per_million_usd)}`} / ${m.output_per_million_usd === null ? '—' : `US$ ${esc(m.output_per_million_usd)}`}</td><td dir="ltr">${esc(m.context_length?.toLocaleString('en-US') ?? '—')}</td></tr>`)
    .join('');

  const body = `${bc.html}<h1>What changed in software since ${esc(label)}</h1>
<p>If a model's training data ends in ${esc(label)}, this is what it does not know. ${esc(d.summary.packages_with_new_major_versions)} popular packages shipped a new major version, ${esc(d.summary.runtime_versions_released)} runtime or platform versions were released and ${esc(d.summary.runtime_versions_reached_end_of_life)} reached end of life. Verified ${esc(d.as_of)}.</p>
<h2>New major versions after ${esc(label)}</h2>
${majors ? `<div class="card"><table><tr><th>Package</th><th>Version at the cutoff</th><th>New major versions</th><th>Latest today</th></tr>${majors}</table></div>` : '<p class="muted">No popular package shipped a new major version in this period.</p>'}
<p class="muted">Most popular packages first. A new major version can contain breaking changes: check the upgrade guide or <a href="/docs">the API</a> before writing code against it.</p>
<h2>Runtimes, frameworks and platforms</h2>
<h3>Released</h3>${cyc(rt.new_cycles, (x) => `<span class="muted">released ${esc(x.released)}${x.lts ? ', LTS' : ''}</span>`)}
<h3>Reached end of life</h3>${cyc(rt.reached_end_of_life, (x) => `<span class="muted">ended ${esc(x.eol)}</span>`)}
<h3>Ending within 180 days</h3>${cyc(rt.ending_within_180_days, (x) => `<span class="muted">ends ${esc(x.eol)}</span>`)}
<h2>AI models released</h2>
${models ? `<div class="card"><table><tr><th>Model</th><th>Released</th><th>Input / output per 1M tokens</th><th>Context</th></tr>${models}</table></div>` : '<p class="muted">None listed.</p>'}
<p class="muted">${esc(r.meta.coverage)} ${esc(r.meta.limits[0] ?? '')}</p>
<p>${neighbours.prev ? `<a href="/since/${neighbours.prev}">← ${esc(monthLabel(neighbours.prev))}</a>` : ''} ${neighbours.next ? `· <a href="/since/${neighbours.next}">${esc(monthLabel(neighbours.next))} →</a>` : ''} · <a href="/since">All months</a></p>
${agentSection(L)}
<h2>For agents</h2>
<pre>GET ${esc(config.publicUrl)}/v1/since?cutoff=${esc(ym)}</pre>`;
  return layout(L, {
    title: `What changed in software since ${label}: new major versions, runtimes, AI models — Vigia`,
    description: `${d.summary.packages_with_new_major_versions} popular packages shipped a new major version, ${d.summary.runtime_versions_released} runtimes were released and ${d.summary.ai_models_released} AI models launched after ${label}.`.slice(0, 300),
    path,
    body,
    singleLanguage: true,
    ld: [bc.ld, { '@type': 'TechArticle', headline: `What changed in software since ${label}`, url: localeUrl(L, path), dateModified: d.as_of, inLanguage: 'en' }],
  });
}
