import semver from 'semver';
import * as pep440 from '@renovatebot/pep440';
import { pool } from './db.js';
import { config } from './config.js';
import { factsOf } from './facts.js';
import { resolvePackage } from './service.js';
import { canonicalName, type Ecosystem } from './util.js';

export interface Dependency {
  name: string;
  spec: string;
  dev?: boolean;
}

export type Verdict = 'up_to_date' | 'outdated' | 'outdated_major' | 'unpinned' | 'unsupported_spec';

export interface Evaluation {
  verdict: Verdict;
  majors_behind: number | null;
}

// ------------------------------------------------------------------------ parseo de manifests

export function parsePackageJson(text: string): Dependency[] {
  const pkg = JSON.parse(text);
  const out: Dependency[] = [];
  for (const [field, dev] of [['dependencies', false], ['devDependencies', true], ['optionalDependencies', false]] as const) {
    for (const [name, spec] of Object.entries<unknown>(pkg[field] ?? {})) {
      if (typeof spec === 'string') out.push({ name, spec, dev });
    }
  }
  return out;
}

/** requirements.txt: ignora comentarios, opciones (-r, -e, --index-url…), URLs y marcadores de entorno. */
export function parseRequirements(text: string): Dependency[] {
  const out: Dependency[] = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.replace(/\s+#.*$/, '').replace(/^#.*$/, '').trim();
    if (!line || line.startsWith('-') || /:\/\//.test(line) || line.includes(' @ ')) continue;
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*([^;]*)/.exec(line);
    if (m) out.push({ name: m[1]!, spec: m[2]!.trim() });
  }
  return out;
}

// ------------------------------------------------------------------------ evaluación de un rango contra la última versión

export function evaluateNpm(spec: string, latest: string): Evaluation {
  const range = semver.validRange(spec);
  if (!range || !semver.valid(latest)) return { verdict: 'unsupported_spec', majors_behind: null };
  if (spec.trim() === '*' || spec.trim() === '' || spec.trim() === 'latest') return { verdict: 'unpinned', majors_behind: 0 };
  if (semver.satisfies(latest, range)) return { verdict: 'up_to_date', majors_behind: 0 };
  const min = semver.minVersion(range);
  if (!min) return { verdict: 'unsupported_spec', majors_behind: null };
  const behind = semver.major(latest) - semver.major(min);
  // Caso 0.x: en semver un salto de minor en 0.x también es incompatible.
  const zeroMinorJump = behind === 0 && semver.major(latest) === 0 && semver.minor(latest) > semver.minor(min);
  return { verdict: behind > 0 || zeroMinorJump ? 'outdated_major' : 'outdated', majors_behind: Math.max(behind, 0) };
}

export function evaluatePypi(spec: string, latest: string): Evaluation {
  if (!pep440.valid(latest)) return { verdict: 'unsupported_spec', majors_behind: null };
  if (spec === '') return { verdict: 'unpinned', majors_behind: 0 };
  if (!pep440.validRange(spec)) return { verdict: 'unsupported_spec', majors_behind: null };
  if (pep440.satisfies(latest, spec)) return { verdict: 'up_to_date', majors_behind: 0 };
  const referenced = [...spec.matchAll(/(?:===?|~=|>=|>)\s*([0-9][^,\s]*)/g)].map((m) => m[1]!).filter((v) => pep440.valid(v));
  if (referenced.length === 0) return { verdict: 'outdated', majors_behind: null };
  const behind = pep440.major(latest)! - Math.min(...referenced.map((v) => pep440.major(v)!));
  return { verdict: behind > 0 ? 'outdated_major' : 'outdated', majors_behind: Math.max(behind, 0) };
}

// ------------------------------------------------------------------------ check completo

export async function checkDependencies(eco: Ecosystem, deps: Dependency[]) {
  const limited = deps.slice(0, 300);
  let liveBudget = config.liveResolveLimit;
  const results = await Promise.all(
    limited.map(async (d) => {
      const name = canonicalName(eco, d.name);
      if (!name) return { name: d.name, spec: d.spec, dev: d.dev ?? false, error: 'invalid_name' };
      let entity = await resolvePackage(eco, name, false);
      if (!entity && liveBudget > 0) {
        liveBudget--;
        entity = await resolvePackage(eco, name, true).catch(() => null);
      }
      if (!entity) return { name, spec: d.spec, dev: d.dev ?? false, error: 'not_resolved_yet', retry_after_s: 60 };
      const f = await factsOf(pool, entity.id);
      if (f.get('exists')?.value === false) return { name, spec: d.spec, dev: d.dev ?? false, error: 'not_found_in_registry' };
      const latest: string | undefined = f.get('latest_version')?.value?.version;
      if (!latest) return { name, spec: d.spec, dev: d.dev ?? false, error: 'not_resolved_yet', retry_after_s: 60 };
      const ev = eco === 'npm' ? evaluateNpm(d.spec, latest) : evaluatePypi(d.spec, latest);
      const dep = f.get('deprecated')?.value;
      return {
        name,
        spec: d.spec,
        dev: d.dev ?? false,
        latest,
        latest_published_at: f.get('latest_version')?.value?.published_at ?? null,
        ...ev,
        package_deprecated: Boolean(dep?.deprecated),
        deprecation_message: dep?.deprecated ? dep.message : null,
        verified_at: f.get('latest_version')?.last_verified_at.toISOString() ?? null,
      };
    }),
  );
  const count = (pred: (r: any) => boolean) => results.filter(pred).length;
  return {
    data: results,
    summary: {
      total: results.length,
      truncated: deps.length > limited.length,
      up_to_date: count((r) => r.verdict === 'up_to_date'),
      outdated: count((r) => r.verdict === 'outdated'),
      outdated_major: count((r) => r.verdict === 'outdated_major'),
      deprecated: count((r) => r.package_deprecated),
      unresolved: count((r) => 'error' in r),
    },
    meta: {
      as_of: new Date().toISOString(),
      notes: [
        'verdict compara el rango declarado contra la última versión estable publicada (dist-tag latest en npm).',
        'outdated_major indica que actualizar a la última versión implica un salto de versión mayor (posibles breaking changes).',
        'El contenido del manifest no se almacena.',
      ],
    },
  };
}
