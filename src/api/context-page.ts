import { config } from '../config.js';
import { LOCALES } from '../i18n/index.js';
import { agentSection, crumbs, esc, layout, localeUrl } from './pages.js';
import type { ContextResult } from '../context.js';

const L = LOCALES[0]!;

const EXAMPLE_NPM = JSON.stringify(
  { name: 'my-app', engines: { node: '>=18' }, dependencies: { next: '^14.2.0', react: '^18.2.0', lodash: '4.17.15', request: '^2.88.0' }, devDependencies: { typescript: '^5.4.0' } },
  null,
  2,
);

export function contextHtml(state: { ecosystem?: 'npm' | 'pypi'; manifest?: string; runtime?: string; result?: ContextResult; error?: string }): string {
  const bc = crumbs(L, [['Project context for AI agents', null]]);
  const eco = state.ecosystem ?? 'npm';
  const sel = (v: string) => (eco === v ? ' selected' : '');
  const out = state.result
    ? `<h2>Your context block</h2>
<p>Paste it into <code>AGENTS.md</code> (Codex, Cursor, Copilot and others), <code>CLAUDE.md</code> (Claude Code) or <code>.cursor/rules</code>. Agents read those files by themselves, so they start every session knowing this, with no tool to install. The markers let a script replace the block later.</p>
<p><button type="button" class="btn" id="ctx-copy">Copy</button></p>
<pre id="ctx-out" style="white-space:pre-wrap">${esc(state.result.markdown)}</pre>
<script>document.getElementById('ctx-copy').onclick=function(){var b=this;navigator.clipboard.writeText(document.getElementById('ctx-out').textContent).then(function(){var o=b.textContent;b.textContent='Copied!';setTimeout(function(){b.textContent=o},1500)})}</script>`
    : '';
  const body = `${bc.html}<h1>Give your AI agent the facts about your dependencies</h1>
<p>Paste your <code>package.json</code> or <code>requirements.txt</code>. Vigia checks every dependency against the registry, OSV and endoflife.date and writes a short block for <code>AGENTS.md</code> / <code>CLAUDE.md</code>: versions that are end of life, known vulnerabilities, deprecated packages and what breaks in the major versions you are behind on. Nothing is stored.</p>
${state.error ? `<p class="badge deprecated">${esc(state.error)}</p>` : ''}
<form method="post" action="/context">
<p><label>Manifest type: <select name="ecosystem"><option value="npm"${sel('npm')}>npm — package.json</option><option value="pypi"${sel('pypi')}>PyPI — requirements.txt</option></select></label>
 · <label>Runtime (optional): <input name="runtime" value="${esc(state.runtime ?? '')}" placeholder="python@3.9 or node@18" size="22"></label></p>
<p><textarea name="manifest" rows="14" style="width:100%;font:13px ui-monospace,Menlo,Consolas,monospace;padding:10px;box-sizing:border-box" placeholder="Paste the file here">${esc(state.manifest ?? EXAMPLE_NPM)}</textarea></p>
<p><button type="submit" class="btn">Generate</button></p>
</form>
${out}
<h2>Automate it</h2>
<p>Run the same thing from your repository (zero dependencies, Node 18+). It rewrites only the block between the markers:</p>
<pre>curl -fsSL ${esc(config.publicUrl)}/context.mjs -o vigia-context.mjs
node vigia-context.mjs            # reads package.json or requirements.txt, updates AGENTS.md</pre>
<p class="muted">Read the script before running it: it is a single short file that sends your manifest to ${esc(config.publicUrl)}/v1/context and writes the answer into the file you choose. Source: <a href="https://github.com/MatiasDelosSantos/vigia/blob/master/action/context.mjs">action/context.mjs</a>.</p>
${agentSection(L)}
<h2>For agents</h2>
<pre>POST ${esc(config.publicUrl)}/v1/context   {"ecosystem":"npm","manifest":"...","runtime":"node@18"}</pre>`;
  return layout(L, {
    title: 'Generate AGENTS.md / CLAUDE.md dependency facts for AI coding agents — Vigia',
    description: 'Paste your package.json or requirements.txt and get a block for AGENTS.md or CLAUDE.md with end-of-life runtimes, vulnerabilities, deprecated packages and breaking changes, so AI agents stop writing outdated code.',
    path: '/context',
    body,
    singleLanguage: true,
    ld: [bc.ld, { '@type': 'WebApplication', name: 'Vigia project context generator', url: localeUrl(L, '/context'), applicationCategory: 'DeveloperApplication', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' } }],
  });
}
