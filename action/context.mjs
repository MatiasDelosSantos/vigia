#!/usr/bin/env node
// Vigia project context: writes verified facts about this project's dependencies into AGENTS.md (or CLAUDE.md), so AI
// coding agents start every session knowing which versions are end of life, vulnerable, deprecated or behind a major.
// Zero dependencies, Node 18+. It sends the manifest to Vigia (https://vigia.coredls.cloud/v1/context); nothing is stored.
//
//   node vigia-context.mjs                       # package.json or requirements.txt -> AGENTS.md
//   node vigia-context.mjs --out CLAUDE.md
//   node vigia-context.mjs --runtime python@3.9  # runtime not declared in the manifest
//   node vigia-context.mjs --print               # print instead of writing
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
if (flag('help') || flag('h')) {
  console.log('Usage: node vigia-context.mjs [--manifest FILE] [--out FILE] [--runtime node@18,python@3.9] [--print] [--url BASE]');
  process.exit(0);
}

const base = (opt('url', process.env.VIGIA_URL || 'https://vigia.coredls.cloud')).replace(/\/$/, '');
const manifestPath = opt('manifest', existsSync('package.json') ? 'package.json' : existsSync('requirements.txt') ? 'requirements.txt' : null);
if (!manifestPath || !existsSync(manifestPath)) {
  console.error('No package.json or requirements.txt found. Use --manifest FILE.');
  process.exit(1);
}
const ecosystem = /requirements.*\.txt$/i.test(manifestPath) ? 'pypi' : 'npm';
const manifest = readFileSync(manifestPath, 'utf8');

// Runtime hints: explicit flag first, then the usual version files.
const runtime = [opt('runtime', '')];
const first = (file) => (existsSync(file) ? readFileSync(file, 'utf8').trim().replace(/^v/i, '') : null);
const nvm = first('.nvmrc') ?? first('.node-version');
if (nvm && /^\d/.test(nvm)) runtime.push(`node@${nvm.split('.')[0]}`);
const py = first('.python-version');
if (py && /^\d+\.\d+/.test(py)) runtime.push(`python@${py.split('.').slice(0, 2).join('.')}`);

const res = await fetch(`${base}/v1/context`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'user-agent': 'vigia-context-script/1.0' },
  body: JSON.stringify({ ecosystem, manifest, runtime: runtime.filter(Boolean).join(',') }),
});
if (!res.ok) {
  console.error(`Vigia answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const { markdown } = await res.json();

if (flag('print')) {
  process.stdout.write(markdown);
  process.exit(0);
}

const out = opt('out', existsSync('AGENTS.md') || !existsSync('CLAUDE.md') ? 'AGENTS.md' : 'CLAUDE.md');
const START = '<!-- vigia:start -->';
const END = '<!-- vigia:end -->';
let text = existsSync(out) ? readFileSync(out, 'utf8') : '';
const a = text.indexOf(START);
const b = text.indexOf(END);
if (a >= 0 && b > a) text = text.slice(0, a) + markdown.trimEnd() + text.slice(b + END.length);
else text = (text ? text.replace(/\s*$/, '\n\n') : '') + markdown;
writeFileSync(out, text);
console.log(`Updated ${out} (${markdown.split('\n').length} lines). Review it and commit.`);
