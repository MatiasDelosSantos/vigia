#!/usr/bin/env node
// Vigia hook for Claude Code (zero dependencies, Node 18+).
//
//   session  (SessionStart): checks the project's package.json / requirements.txt and gives the agent the facts that
//            matter: end-of-life runtimes, known vulnerabilities, deprecated packages, breaking changes in the major
//            versions the project is behind on.
//   edit     (PostToolUse on Edit|Write|MultiEdit): when the agent changes package.json or requirements.txt, re-checks
//            and tells it what the new dependency set looks like.
//
// It sends the manifest to https://vigia.coredls.cloud/v1/context (nothing is stored). It never blocks Claude Code:
// on any error it exits silently. Set VIGIA_DISABLE=1 to turn it off, VIGIA_URL to use another server.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';

const mode = process.argv[2];
const base = (process.env.VIGIA_URL || 'https://vigia.coredls.cloud').replace(/\/$/, '');
const CACHE_MS = 6 * 3600_000;

async function readStdin() {
  let s = '';
  for await (const chunk of process.stdin) s += chunk;
  try {
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
}

// Claude Code limita cada additionalContext a 10.000 caracteres: se corta en un salto de línea antes de ese tope.
const MAX_CONTEXT = 9500;

function emit(eventName, text) {
  if (text.length > MAX_CONTEXT) text = `${text.slice(0, text.lastIndexOf('\n', MAX_CONTEXT))}\n…(shortened; regenerate the full block at ${base}/context)`;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext: text } }));
}

function runtimeHints(dir) {
  const out = [];
  const first = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8').trim().replace(/^v/i, '') : null);
  const nvm = first('.nvmrc') ?? first('.node-version');
  if (nvm && /^\d/.test(nvm)) out.push(`node@${nvm.split('.')[0]}`);
  const py = first('.python-version');
  if (py && /^\d+\.\d+/.test(py)) out.push(`python@${py.split('.').slice(0, 2).join('.')}`);
  return out.join(',');
}

async function context(manifestPath) {
  const manifest = readFileSync(manifestPath, 'utf8');
  const ecosystem = /requirements.*\.txt$/i.test(manifestPath) ? 'pypi' : 'npm';
  const res = await fetch(`${base}/v1/context`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'vigia-claude-code-hook/1.0' },
    body: JSON.stringify({ ecosystem, manifest, runtime: runtimeHints(dirname(manifestPath)) }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) return null;
  return (await res.json()).markdown ?? null;
}

async function main() {
  if (process.env.VIGIA_DISABLE === '1') return;
  const input = await readStdin();
  const project = resolve(input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());

  if (mode === 'session') {
    const manifestPath = ['package.json', 'requirements.txt'].map((f) => join(project, f)).find(existsSync);
    if (!manifestPath) return;
    // Caché de 6 h por proyecto (se descarta si el manifest cambió después).
    const cacheFile = join(tmpdir(), `vigia-ctx-${createHash('sha1').update(manifestPath).digest('hex').slice(0, 12)}.json`);
    let md = null;
    try {
      const c = JSON.parse(readFileSync(cacheFile, 'utf8'));
      if (Date.now() - c.at < CACHE_MS && c.at > statSync(manifestPath).mtimeMs) md = c.md;
    } catch {
      // sin caché
    }
    if (!md) {
      md = await context(manifestPath);
      if (md) writeFileSync(cacheFile, JSON.stringify({ at: Date.now(), md }));
    }
    if (md) emit('SessionStart', `Vigia checked this project's dependencies against the registries, OSV and endoflife.date. These facts may be newer than your training data; prefer them when they conflict with what you remember.\n\n${md}`);
    return;
  }

  if (mode === 'edit') {
    const file = input.tool_input?.file_path;
    if (typeof file !== 'string') return;
    const name = basename(file);
    if (!(name === 'package.json' || /^requirements.*\.txt$/i.test(name)) || file.split(/[\/]/).includes('node_modules')) return;
    const full = resolve(project, file.split('/').join(sep));
    if (!existsSync(full)) return;
    const md = await context(full);
    if (md) emit('PostToolUse', `You changed ${name}. Vigia re-checked the dependencies; review anything under "Needs attention" before continuing.\n\n${md}`);
  }
}

main().catch(() => {}).finally(() => process.exit(0));
