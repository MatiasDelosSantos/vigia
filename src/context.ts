import semver from 'semver';
import { checkDependencies, parsePackageJson, parseRequirements, type Dependency } from './check.js';
import { resolvePackage } from './service.js';
import { vulnsForVersion } from './osv.js';
import { guidesFor, upgradeReport } from './intel.js';
import { cycleView, findProduct, productView } from './eol.js';
import { config } from './config.js';
import type { Ecosystem } from './util.js';

/**
 * Contexto de proyecto para agentes: toma el manifest de dependencias (package.json o requirements.txt) y devuelve un
 * bloque de Markdown listo para pegar en AGENTS.md / CLAUDE.md / .cursorrules. Los agentes leen esos archivos solos,
 * así que reciben los hechos (versiones fuera de soporte, vulnerabilidades, cambios incompatibles) sin tener que decidir llamar a nada.
 */

export const MARK_START = '<!-- vigia:start -->';
export const MARK_END = '<!-- vigia:end -->';
const MAX_ATTENTION = 25;
const MAX_LINES_PER_PACKAGE = 5;

const RUNTIME_PRODUCT: Record<string, string> = { node: 'nodejs', nodejs: 'nodejs', python: 'python', php: 'php', ruby: 'ruby', go: 'go', java: 'java', rust: 'rust', dotnet: 'dotnet' };

export interface RuntimeHint {
  product: string;
  version: string;
  source: string;
}

/** "node@18,python@3.9" → pistas de runtime (los nombres se normalizan a identificadores de endoflife.date). */
export function parseRuntimeHints(raw: string | undefined | null): RuntimeHint[] {
  if (!raw) return [];
  const out: RuntimeHint[] = [];
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6)) {
    const at = part.lastIndexOf('@');
    if (at <= 0) continue;
    const product = RUNTIME_PRODUCT[part.slice(0, at).toLowerCase()];
    const version = part.slice(at + 1).trim();
    if (product && /^[0-9][0-9A-Za-z.+-]{0,20}$/.test(version)) out.push({ product, version, source: 'given' });
  }
  return out;
}

/** Del package.json: engines.node (">=18" → "18"). */
function enginesNode(manifest: string): RuntimeHint[] {
  try {
    const range = JSON.parse(manifest)?.engines?.node;
    if (typeof range !== 'string') return [];
    const min = semver.validRange(range) ? semver.minVersion(range)?.version : null;
    return min ? [{ product: 'nodejs', version: String(semver.major(min)), source: 'package.json engines.node' }] : [];
  } catch {
    return [];
  }
}

const clip = (s: string, n = 110) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const tick = (s: string) => `\`${s.replace(/`/g, "'")}\``;

async function breakingLines(name: string, installedMajor: number, latestMajor: number): Promise<{ lines: string[]; guide: string | null }> {
  const entity = await resolvePackage('npm', name, false);
  if (!entity) return { lines: [], guide: null };
  const hops = (await guidesFor(entity.id)).filter((g) => g.from >= installedMajor && g.to <= latestMajor).slice(-2);
  if (hops.length === 0) return { lines: [], guide: null };
  const lines: string[] = [];
  for (const hop of hops) {
    const r = await upgradeReport(entity, String(hop.from), String(hop.to));
    if (r.status !== 'ok') continue;
    const bc = (r.data as any).breaking_candidates;
    if (!bc) continue;
    const prefix = hops.length > 1 ? `${hop.from}→${hop.to}: ` : '';
    for (const x of (bc.removed_modules ?? []).slice(0, 2)) lines.push(`${prefix}import path removed: ${tick(x)}`);
    for (const x of (bc.removed_exports ?? []).slice(0, 2)) lines.push(`${prefix}removed: ${tick(`${x.module} · ${x.name}`)}`);
    for (const x of (bc.changed_signatures ?? []).slice(0, 3)) lines.push(`${prefix}${tick(`${x.module} · ${x.name}`)}: ${tick(clip(x.before, 60))} → ${tick(clip(x.after, 70))}`);
    for (const x of ((r.data as any).newly_deprecated ?? []).slice(0, 1)) lines.push(`${prefix}newly deprecated: ${tick(`${x.module} · ${x.name}`)}`);
  }
  const last = hops.at(-1)!;
  return { lines: lines.slice(0, MAX_LINES_PER_PACKAGE), guide: `${config.publicUrl}/upgrade/npm/${name}/${last.from}-to-${last.to}` };
}

export interface ContextResult {
  markdown: string;
  data: {
    ecosystem: Ecosystem;
    generated: string;
    summary: { dependencies: number; needs_attention: number; vulnerable: number; deprecated: number; outdated_major: number; end_of_life_runtimes: number; unresolved: number };
    runtimes: Array<{ product: string; version: string; status: string; eol: string | null; source: string }>;
  };
}

export async function buildProjectContext(input: { ecosystem: 'npm' | 'pypi'; manifest: string; runtime?: string }): Promise<ContextResult> {
  const eco = input.ecosystem;
  const all: Dependency[] = eco === 'npm' ? parsePackageJson(input.manifest) : parseRequirements(input.manifest);
  // Primero las de producción; las de desarrollo después, hasta un máximo.
  const deps = [...all.filter((d) => !d.dev).slice(0, 100), ...all.filter((d) => d.dev).slice(0, 50)];
  const check = await checkDependencies(eco, deps);
  const items = check.data as any[];

  const attention: Array<{ line: string[]; weight: number }> = [];
  let vulnerable = 0;
  let deprecated = 0;
  let outdatedMajor = 0;
  const calm: string[] = [];
  for (const r of items) {
    if ('error' in r) continue;
    const vulns: string[] = r.min_version_vulnerabilities ?? [];
    const isMajor = r.verdict === 'outdated_major';
    if (vulns.length === 0 && !r.package_deprecated && !isMajor) {
      calm.push(r.name);
      continue;
    }
    const head: string[] = [];
    let weight = 0;
    if (vulns.length) {
      vulnerable++;
      weight += 100;
      let fix = '';
      try {
        const v = await vulnsForVersion(eco, r.name, r.min_version);
        if (v.nearest_fixed_version) fix = `; nearest fixed version ${v.nearest_fixed_version}`;
      } catch {
        // OSV no respondió: se listan igual los IDs
      }
      head.push(`- **${r.name}** ${tick(r.spec || '*')}: ${vulns.length} known ${vulns.length === 1 ? 'vulnerability' : 'vulnerabilities'} in ${r.min_version} (${vulns.slice(0, 3).join(', ')}${vulns.length > 3 ? ', …' : ''})${fix}.`);
    }
    if (r.package_deprecated) {
      deprecated++;
      weight += 50;
      head.push(`- **${r.name}** is deprecated${r.deprecation_message ? `: ${clip(String(r.deprecation_message), 140)}` : ''}.`);
    }
    if (isMajor) {
      outdatedMajor++;
      weight += 10 + (r.majors_behind ?? 1);
      const behind = r.majors_behind ? ` (${r.majors_behind} major ${r.majors_behind === 1 ? 'version' : 'versions'} behind)` : '';
      const entry = [`- **${r.name}** ${tick(r.spec)}: latest is ${r.latest}${behind}.`];
      if (eco === 'npm' && r.min_version && r.latest && semver.valid(r.latest) && semver.valid(r.min_version)) {
        const b = await breakingLines(r.name, semver.major(r.min_version), semver.major(r.latest)).catch(() => ({ lines: [], guide: null }));
        if (b.lines.length) entry.push(`  Breaking changes (from the packages' TypeScript types):`, ...b.lines.map((l) => `  - ${l}`));
        if (b.guide) entry.push(`  Details: ${b.guide}`);
      }
      head.push(...entry);
    }
    attention.push({ line: head, weight });
  }
  attention.sort((a, b) => b.weight - a.weight);

  // Runtimes: los dados explícitamente tienen prioridad sobre los deducidos del manifest.
  const hints = [...parseRuntimeHints(input.runtime), ...(eco === 'npm' ? enginesNode(input.manifest) : [])];
  const seen = new Set<string>();
  const runtimes: ContextResult['data']['runtimes'] = [];
  const runtimeLines: string[] = [];
  for (const h of hints) {
    if (seen.has(h.product)) continue;
    seen.add(h.product);
    const e = await findProduct(h.product);
    const v = e ? await cycleView(e, h.version) : null;
    if (!e || !v) continue;
    const c = v.data.cycle;
    runtimes.push({ product: h.product, version: h.version, status: c.status, eol: c.eol_from, source: h.source });
    const supported = (await productView(e)).data.supported_cycles.slice(0, 4).join(', ');
    const label = v.data.label;
    runtimeLines.push(
      c.status === 'end_of_life'
        ? `- ${label} ${h.version} (${h.source}): **end of life${c.eol_from ? ` since ${c.eol_from}` : ''}**, no security fixes. Supported: ${supported}.`
        : c.status === 'security_only'
          ? `- ${label} ${h.version} (${h.source}): security fixes only${c.eol_from ? ` until ${c.eol_from}` : ''}. Supported: ${supported}.`
          : `- ${label} ${h.version} (${h.source}): supported${c.eol_from ? ` until ${c.eol_from}` : ''}.`,
    );
  }

  const generated = new Date().toISOString().slice(0, 10);
  const shown = attention.slice(0, MAX_ATTENTION);
  const sections: string[] = [
    MARK_START,
    `## Dependency facts for AI agents (generated by Vigia on ${generated})`,
    '',
    `Generated from this project's ${eco === 'npm' ? 'package.json' : 'requirements.txt'}, checked against the ${eco === 'npm' ? 'npm' : 'PyPI'} registry, OSV and endoflife.date. Your training data may be older than these facts: when they conflict with what you remember, trust this section. Regenerate at ${config.publicUrl}/context`,
  ];
  if (runtimeLines.length) sections.push('', '### Runtime', ...runtimeLines);
  if (shown.length) {
    sections.push('', '### Needs attention', ...shown.flatMap((s) => s.line));
    if (attention.length > shown.length) sections.push(`- …and ${attention.length - shown.length} more.`);
  } else {
    sections.push('', '### Needs attention', '- Nothing: no known vulnerabilities, deprecated packages or major versions behind among the dependencies checked.');
  }
  if (calm.length) sections.push('', `### Up to date or minor updates (${calm.length})`, clip(calm.join(', '), 600));
  const unresolved = items.filter((r) => 'error' in r).length;
  if (unresolved) sections.push('', `(${unresolved} dependencies could not be resolved and are not listed.)`);
  sections.push(
    '',
    '### Verify before writing code',
    `If the Vigia MCP server is connected (\`claude mcp add --transport http vigia ${config.publicUrl}/mcp\`), call \`symbol_status\` before using a library API you are not sure exists in the installed version, \`upgrade_impact\` before upgrading across a major version, and \`eol_status\` before choosing a runtime or base image. Without MCP, the same facts are at ${config.publicUrl}/docs.`,
    MARK_END,
  );

  const endOfLife = runtimes.filter((r) => r.status === 'end_of_life').length;
  return {
    markdown: sections.join('\n') + '\n',
    data: {
      ecosystem: eco,
      generated,
      summary: { dependencies: items.length, needs_attention: attention.length, vulnerable, deprecated, outdated_major: outdatedMajor, end_of_life_runtimes: endOfLife, unresolved },
      runtimes,
    },
  };
}
