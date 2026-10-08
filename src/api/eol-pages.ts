import { config } from '../config.js';
import { LOCALES } from '../i18n/index.js';
import { agentSection, crumbs, esc, layout, localeUrl } from './pages.js';
import type { DecoratedCycle, ProductSummary } from '../eol.js';

const L = LOCALES[0]!;
const BADGE: Record<string, string> = { supported: 'active', security_only: 'deprecated', end_of_life: 'yanked', upcoming: 'available' };
const STATUS: Record<string, string> = { supported: 'Supported', security_only: 'Security fixes only', end_of_life: 'End of life', upcoming: 'Not released yet' };
const d = (s: string | null) => (s ? `<span dir="ltr">${esc(s)}</span>` : '<span class="muted">—</span>');
const badge = (status: string) => `<span class="badge ${BADGE[status] ?? ''}">${esc(STATUS[status] ?? status)}</span>`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const faqHtml = (faq: Array<[string, string]>) => faq.map(([q, a]) => `<details class="faq" open><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('');
const faqLd = (faq: Array<[string, string]>) => ({ '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;

/** "Supported until 2027-10-31 (in 388 days)" / "End of life since 2025-10-31 (342 days ago)". */
function whenEol(c: DecoratedCycle): string {
  if (c.status === 'end_of_life') {
    return c.eol_from ? `End of life since ${c.eol_from} (${plural(c.days_since_eol ?? 0, 'day')} ago)` : 'End of life (the project marks it as finished, no date given)';
  }
  if (c.status === 'upcoming') return c.release_date ? `Scheduled for release on ${c.release_date}` : 'Not released yet';
  return c.eol_from ? `Receives fixes until ${c.eol_from} (in ${plural(c.days_until_eol ?? 0, 'day')})` : 'No end-of-life date announced yet';
}

export function eolIndexHtml(products: ProductSummary[]): string {
  const bc = crumbs(L, [['End of life', null]]);
  const groups = new Map<string, ProductSummary[]>();
  for (const p of products) groups.set(p.category ?? 'other', [...(groups.get(p.category ?? 'other') ?? []), p]);
  const order = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const body = `${bc.html}<h1>Software end-of-life dates</h1>
<p class="muted">Support status and end-of-life (EOL) dates of ${products.length} products: programming languages, runtimes, frameworks, databases and operating systems. Dates come from each project's release policy (via endoflife.date); the status is computed from today's date on every request.</p>
${order
  .map(
    ([cat, items]) =>
      `<h2>${esc(cat)} (${items.length})</h2><ul class="grid">${items.map((p) => `<li><a href="/eol/${esc(p.product)}" dir="ltr">${esc(p.label)}</a></li>`).join('')}</ul>`,
  )
  .join('')}
${agentSection(L)}
<h2>For agents</h2>
<pre>GET ${esc(config.publicUrl)}/v1/eol
GET ${esc(config.publicUrl)}/v1/eol/python
GET ${esc(config.publicUrl)}/v1/eol/python/3.9</pre>`;
  return layout(L, {
    title: 'Software end-of-life (EOL) dates: Python, Node.js, PHP, Java and more — Vigia',
    description: `Support status and end-of-life dates for ${products.length} products: languages, runtimes, frameworks, databases and operating systems. Updated automatically.`,
    path: '/eol',
    body,
    singleLanguage: true,
    ld: [bc.ld, { '@type': 'CollectionPage', name: 'Software end-of-life dates', url: localeUrl(L, '/eol') }],
  });
}

export function eolProductHtml(view: { data: any; meta: any }): string {
  const p = view.data as { product: string; label: string; category: string | null; release_policy: string | null; newest_cycle: string | null; supported_cycles: string[]; cycles: DecoratedCycle[] };
  const path = `/eol/${p.product}`;
  const bc = crumbs(L, [['End of life', '/eol'], [p.label, null]]);
  const today = new Date().toISOString().slice(0, 10);
  const newest = p.cycles[0];
  const summary = p.supported_cycles.length
    ? `As of ${today}, the supported ${p.label} versions are ${p.supported_cycles.join(', ')}.`
    : `As of ${today}, none of the listed ${p.label} versions is supported.`;

  const rows = p.cycles
    .map(
      (c) =>
        `<tr><td><a href="/eol/${esc(p.product)}/${esc(c.cycle)}" dir="ltr"><strong>${esc(c.cycle)}</strong></a>${c.lts ? ' <span class="muted">LTS</span>' : ''}${c.codename ? ` <span class="muted">${esc(c.codename)}</span>` : ''}</td><td>${badge(c.status)}</td><td>${d(c.release_date)}</td><td>${d(c.support_until)}</td><td>${d(c.eol_from ?? (c.eol_flag ? 'ended' : null))}</td><td><code dir="ltr">${esc(c.latest ?? '—')}</code></td></tr>`,
    )
    .join('');

  const faq: Array<[string, string]> = [
    [`Which ${p.label} versions are still supported?`, `${summary}${p.supported_cycles.length ? ' Versions not listed are end of life and no longer receive security fixes.' : ''}`],
  ];
  if (newest) faq.push([`What is the latest ${p.label} version?`, `The newest ${p.label} release cycle is ${newest.cycle}${newest.latest ? `, whose latest version is ${newest.latest}${newest.latest_date ? ` (${newest.latest_date})` : ''}` : ''}.`]);
  const lts = p.cycles.filter((c) => c.lts && c.status !== 'end_of_life' && c.status !== 'upcoming');
  if (lts.length) faq.push([`Which ${p.label} versions are LTS?`, `Long-term support versions still receiving fixes: ${lts.map((c) => c.cycle).join(', ')}.`]);

  const body = `${bc.html}
<h1>${esc(p.label)} end-of-life dates and support status</h1>
<p>${esc(summary)}</p>
<div class="card"><table><tr><th>Version</th><th>Status</th><th>Released</th><th>Active support until</th><th>End of life</th><th>Latest</th></tr>${rows}</table></div>
<p class="muted">Status is computed from today's date. "Security fixes only" means active support has ended but security fixes continue until end of life. Source: <a href="https://endoflife.date/${esc(p.product)}" rel="nofollow">endoflife.date</a>${p.release_policy ? ` · <a href="${esc(p.release_policy)}" rel="nofollow">release policy</a>` : ''}. Verified ${esc((view.meta.last_verified_at ?? '').slice(0, 10) || '—')}.</p>
<h2>Frequently asked questions</h2>${faqHtml(faq)}
${agentSection(L)}
<h2>For agents</h2>
<pre>GET ${esc(config.publicUrl)}/v1/eol/${esc(p.product)}
GET ${esc(config.publicUrl)}/v1/eol/${esc(p.product)}/${esc(newest?.cycle ?? '1')}</pre>`;
  return layout(L, {
    title: `${p.label} end of life (EOL) dates and support status — Vigia`,
    description: `${summary} Release, active-support and end-of-life dates for every ${p.label} version.`.slice(0, 300),
    path,
    body,
    singleLanguage: true,
    ld: [bc.ld, faqLd(faq)],
  });
}

export function eolCycleHtml(view: { data: any; meta: any }): string {
  const { product, label, cycle: c, recommendation } = view.data as { product: string; label: string; cycle: DecoratedCycle; recommendation: string | null };
  const path = `/eol/${product}/${c.cycle}`;
  const bc = crumbs(L, [['End of life', '/eol'], [label, `/eol/${product}`], [c.cycle, null]]);
  const name = `${label} ${c.cycle}`;
  const headline = whenEol(c);

  const faq: Array<[string, string]> = [];
  faq.push([
    `Is ${name} end of life?`,
    c.status === 'end_of_life'
      ? `Yes. ${headline}. It no longer receives security or bug fixes.`
      : c.status === 'upcoming'
        ? `No. ${name} has not been released yet. ${headline}.`
        : c.status === 'security_only'
          ? `Not yet, but active support has ended: ${name} only receives security fixes${c.eol_from ? ` until ${c.eol_from}` : ''}.`
          : `No. ${name} is supported. ${headline}.`,
  ]);
  faq.push([`When does ${name} reach end of life?`, c.eol_from ? `${name} ${c.status === 'end_of_life' ? 'reached' : 'reaches'} end of life on ${c.eol_from}.` : c.eol_flag ? `${name} is marked as end of life, without a specific date.` : `No end-of-life date has been announced for ${name}.`]);
  if (c.release_date) faq.push([`When was ${name} released?`, `${name} was first released on ${c.release_date}.`]);
  if (c.latest) faq.push([`What is the latest ${name} version?`, `The latest ${c.cycle} release is ${c.latest}${c.latest_date ? `, published on ${c.latest_date}` : ''}.`]);
  if (c.lts) faq.push([`Is ${name} an LTS release?`, `Yes${c.lts_from ? `, long-term support started on ${c.lts_from}` : ''}.`]);

  const body = `${bc.html}
<h1>${esc(name)} end of life (EOL) date and support status</h1>
<p>${badge(c.status)} <strong>${esc(headline)}</strong></p>
${recommendation ? `<p>${esc(recommendation)}</p>` : ''}
<div class="card"><table>
${row('Product', `<a href="/eol/${esc(product)}">${esc(label)}</a>`)}
${row('Version cycle', `<code dir="ltr">${esc(c.cycle)}</code>${c.codename ? ` <span class="muted">${esc(c.codename)}</span>` : ''}`)}
${row('Status', badge(c.status))}
${row('Released', d(c.release_date))}
${c.lts ? row('LTS', c.lts_from ? `since ${d(c.lts_from)}` : 'yes') : ''}
${row('Active support until', d(c.support_until))}
${row('End of life', d(c.eol_from ?? (c.eol_flag ? 'ended' : null)))}
${row('Latest version', c.latest ? `<code dir="ltr">${esc(c.latest)}</code>${c.latest_date ? ` <span class="muted">(${esc(c.latest_date)})</span>` : ''}` : '—')}
${row('Last verified', d((view.meta.last_verified_at ?? '').slice(0, 10) || null))}
</table></div>
<p><a href="/eol/${esc(product)}">All ${esc(label)} versions →</a> · Source: <a href="https://endoflife.date/${esc(product)}" rel="nofollow">endoflife.date</a></p>
<h2>Frequently asked questions</h2>${faqHtml(faq)}
${agentSection(L)}
<h2>For agents</h2>
<pre>GET ${esc(config.publicUrl)}/v1/eol/${esc(product)}/${esc(c.cycle)}</pre>`;
  const short = c.status === 'end_of_life' ? `reached end of life${c.eol_from ? ` on ${c.eol_from}` : ''}` : c.eol_from ? `is supported until ${c.eol_from}` : 'has no announced end-of-life date';
  return layout(L, {
    title: `${name} end of life (EOL): ${c.status === 'end_of_life' ? `ended${c.eol_from ? ` ${c.eol_from}` : ''}` : c.status === 'upcoming' ? 'not released yet' : c.eol_from ? `supported until ${c.eol_from}` : 'supported'} — Vigia`,
    description: `${name} ${short}. Release date, active support, security fixes and latest version.`.slice(0, 300),
    path,
    body,
    singleLanguage: true,
    ld: [bc.ld, faqLd(faq)],
  });
}
