// Vigia GitHub Action: revisa package.json / requirements.txt contra /v1/check. Sin dependencias (Node 20+).
import { readFileSync, existsSync, readdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';

const env = process.env;
const API = (env.INPUT_API_URL || 'https://vigia.coredls.cloud').replace(/\/$/, '');
const FAIL_ON = new Set((env.INPUT_FAIL_ON || '').split(',').map((s) => s.trim()).filter(Boolean));
const TOKEN = env.INPUT_GITHUB_TOKEN || '';
const ROOT = env.GITHUB_WORKSPACE || process.cwd();
const MARKER = '<!-- vigia-dependency-check -->';

function manifests() {
  const explicit = (env.INPUT_MANIFESTS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (explicit.length) return explicit;
  return readdirSync(ROOT).filter((f) => f === 'package.json' || /^requirements.*\.txt$/.test(f));
}

const ecosystemOf = (file) => (path.basename(file) === 'package.json' ? 'npm' : 'pypi');

async function check(file) {
  const res = await fetch(`${API}/v1/check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'vigia-github-action/1.0' },
    body: JSON.stringify({ ecosystem: ecosystemOf(file), manifest: readFileSync(path.join(ROOT, file), 'utf8') }),
  });
  if (!res.ok) throw new Error(`Vigia API ${res.status} for ${file}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const pageUrl = (eco, name) => `${API}/${eco}/${name}`;
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|');

function markdown(results) {
  const lines = [MARKER, '## Vigia dependency check', ''];
  for (const { file, eco, data } of results) {
    const s = data.summary;
    lines.push(
      `### \`${file}\``,
      '',
      `${s.total} dependencies · **${s.min_version_vulnerable ?? 0}** allow vulnerable versions · **${s.deprecated}** deprecated · **${s.outdated_major}** behind a major version · ${s.outdated} outdated`,
      '',
    );
    const flagged = data.data.filter(
      (d) => (d.min_version_vulnerabilities?.length ?? 0) > 0 || d.package_deprecated || d.verdict === 'outdated_major' || d.verdict === 'outdated',
    );
    if (flagged.length === 0) {
      lines.push('No issues found. ✅', '');
      continue;
    }
    lines.push('| Dependency | Declared | Latest | Verdict | Vulnerabilities (lowest allowed version) |', '|---|---|---|---|---|');
    for (const d of flagged) {
      const vulns = d.min_version_vulnerabilities ?? [];
      const v = vulns.length ? `${d.min_version}: ${vulns.slice(0, 3).map((id) => `[${id}](https://osv.dev/vulnerability/${id})`).join(', ')}${vulns.length > 3 ? ` +${vulns.length - 3}` : ''}` : '—';
      const verdict = `${d.verdict ?? d.error}${d.package_deprecated ? ' · **deprecated**' : ''}`;
      lines.push(`| [${esc(d.name)}](${pageUrl(eco, d.name)}) | \`${esc(d.spec || '*')}\` | ${esc(d.latest ?? '—')} | ${esc(verdict)} | ${v} |`);
    }
    lines.push('');
  }
  lines.push(`<sub>Data: [Vigia](${API}) (registries, deps.dev, OSV) · verified ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</sub>`);
  return lines.join('\n');
}

async function comment(body) {
  if (!TOKEN || !env.GITHUB_EVENT_PATH || !env.GITHUB_REPOSITORY) return;
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const pr = event.pull_request?.number;
  if (!pr) return;
  const api = `${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}/issues`;
  const headers = { authorization: `Bearer ${TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'vigia-github-action' };
  const list = await (await fetch(`${api}/${pr}/comments?per_page=100`, { headers })).json();
  const existing = Array.isArray(list) ? list.find((c) => typeof c.body === 'string' && c.body.includes(MARKER)) : null;
  const res = existing
    ? await fetch(`${api}/comments/${existing.id}`, { method: 'PATCH', headers, body: JSON.stringify({ body }) })
    : await fetch(`${api}/${pr}/comments`, { method: 'POST', headers, body: JSON.stringify({ body }) });
  if (!res.ok) console.log(`::warning::Could not comment on the PR (${res.status}). Grant "pull-requests: write" permission.`);
}

async function main() {
  const files = manifests().filter((f) => existsSync(path.join(ROOT, f)));
  if (files.length === 0) {
    console.log('::notice::Vigia: no package.json or requirements*.txt found.');
    return;
  }
  const results = [];
  for (const file of files) results.push({ file, eco: ecosystemOf(file), data: await check(file) });

  const totals = { vulnerable: 0, deprecated: 0, major: 0, outdated: 0 };
  for (const { file, data } of results) {
    for (const d of data.data) {
      const vulns = d.min_version_vulnerabilities ?? [];
      if (vulns.length) {
        totals.vulnerable++;
        console.log(`::warning file=${file},title=Vulnerable range: ${d.name}::${d.name} ${d.spec} allows ${d.min_version}, affected by ${vulns.join(', ')}`);
      }
      if (d.package_deprecated) {
        totals.deprecated++;
        console.log(`::warning file=${file},title=Deprecated: ${d.name}::${String(d.deprecation_message ?? 'Deprecated package').slice(0, 200)}`);
      }
      if (d.verdict === 'outdated_major') totals.major++;
      if (d.verdict === 'outdated') totals.outdated++;
    }
  }
  const md = markdown(results);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, md + '\n');
  else console.log(md);
  if (env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, `vulnerable=${totals.vulnerable}\ndeprecated=${totals.deprecated}\noutdated_major=${totals.major}\n`);
  }
  await comment(md).catch((err) => console.log(`::warning::Vigia comment failed: ${err.message}`));

  const failed = [...FAIL_ON].filter((k) => (k === 'major' ? totals.major : totals[k] ?? 0) > 0);
  if (failed.length) {
    console.log(`::error::Vigia: failing because of: ${failed.join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.log(`::error::Vigia check failed: ${err.message}`);
  process.exitCode = 1;
});
