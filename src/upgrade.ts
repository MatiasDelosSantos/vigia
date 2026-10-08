import semver from 'semver';
import * as pep440 from '@renovatebot/pep440';
import type { Surface } from './apisurface.js';
import type { Ecosystem } from './util.js';

// ------------------------------------------------------------------------------------ diff de superficies

export interface UpgradeDiff {
  modules_removed: string[];
  modules_added: string[];
  removed: Array<{ module: string; name: string; kind: string; sig: string }>;
  changed: Array<{ module: string; name: string; kind_before: string; kind_after: string; before: string; after: string }>;
  members_removed: Array<{ module: string; owner: string; member: string; before: string }>;
  members_changed: Array<{ module: string; owner: string; member: string; before: string; after: string }>;
  deprecated: Array<{ module: string; name: string; message: string }>;
  added: Array<{ module: string; name: string; kind: string }>;
  counts: { removed: number; changed: number; members_removed: number; members_changed: number; deprecated: number; added: number; modules_removed: number };
  truncated: boolean;
}

const CAP = 400;
const modName = (pkg: string, mod: string) => (mod === '.' ? pkg : `${pkg}/${mod.replace(/^\.\//, '')}`);

/** Compara dos superficies. Firmas distintas no siempre rompen código: se reportan como "changed" con antes/después. */
export function diffSurfaces(pkg: string, a: Surface, b: Surface): UpgradeDiff {
  const d: UpgradeDiff = {
    modules_removed: [],
    modules_added: [],
    removed: [],
    changed: [],
    members_removed: [],
    members_changed: [],
    deprecated: [],
    added: [],
    counts: { removed: 0, changed: 0, members_removed: 0, members_changed: 0, deprecated: 0, added: 0, modules_removed: 0 },
    truncated: a.truncated || b.truncated,
  };
  const push = <T>(list: T[], item: T) => {
    if (list.length < CAP) list.push(item);
    else d.truncated = true;
  };
  for (const mod of Object.keys(a.modules)) if (!(mod in b.modules)) d.modules_removed.push(modName(pkg, mod));
  for (const mod of Object.keys(b.modules)) if (!(mod in a.modules)) d.modules_added.push(modName(pkg, mod));

  for (const [mod, aExp] of Object.entries(a.modules)) {
    const bExp = b.modules[mod];
    if (!bExp) continue;
    const m = modName(pkg, mod);
    for (const [name, ea] of Object.entries(aExp)) {
      const eb = bExp[name];
      if (!eb) {
        d.counts.removed++;
        push(d.removed, { module: m, name, kind: ea.kind, sig: ea.sig });
        continue;
      }
      if (ea.kind !== eb.kind || ea.sig !== eb.sig) {
        d.counts.changed++;
        push(d.changed, { module: m, name, kind_before: ea.kind, kind_after: eb.kind, before: ea.sig, after: eb.sig });
      }
      if (eb.dep !== undefined && ea.dep === undefined) {
        d.counts.deprecated++;
        push(d.deprecated, { module: m, name, message: eb.dep });
      }
      if (ea.members && eb.members) {
        for (const [mem, ma] of Object.entries(ea.members)) {
          const mb = eb.members[mem];
          if (!mb) {
            d.counts.members_removed++;
            push(d.members_removed, { module: m, owner: name, member: mem, before: ma.t });
          } else {
            if (ma.t !== mb.t) {
              d.counts.members_changed++;
              push(d.members_changed, { module: m, owner: name, member: mem, before: ma.t, after: mb.t });
            }
            if (mb.dep !== undefined && ma.dep === undefined) {
              d.counts.deprecated++;
              push(d.deprecated, { module: m, name: `${name}.${mem}`, message: mb.dep });
            }
          }
        }
      }
    }
    for (const [name, eb] of Object.entries(bExp)) {
      if (!(name in aExp)) {
        d.counts.added++;
        push(d.added, { module: m, name, kind: eb.kind });
      }
    }
  }
  d.counts.modules_removed = d.modules_removed.length;
  return d;
}

// ------------------------------------------------------------------------------------ changelog

export interface ChangelogSection {
  version: string;
  text: string;
}

const VERSION_IN_HEADING = /^#{1,4}\s.*?\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/;

/** Divide un CHANGELOG.md en secciones por versión (encabezados markdown que contienen un número de versión). */
export function parseChangelog(text: string, maxSections = 300, maxChars = 3000): ChangelogSection[] {
  const lines = text.split(/\r?\n/);
  const out: ChangelogSection[] = [];
  let cur: { version: string; lines: string[] } | null = null;
  for (const line of lines) {
    const m = VERSION_IN_HEADING.exec(line);
    if (m) {
      if (cur) out.push({ version: cur.version, text: cur.lines.join('\n').trim().slice(0, maxChars) });
      if (out.length >= maxSections) return out;
      cur = { version: m[1]!, lines: [] };
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  if (cur && out.length < maxSections) out.push({ version: cur.version, text: cur.lines.join('\n').trim().slice(0, maxChars) });
  return out;
}

/** Secciones con from < versión <= to, de la más nueva a la más vieja, con un tope total de caracteres. */
export function changelogBetween(sections: ChangelogSection[], from: string, to: string, maxTotal = 12_000): ChangelogSection[] {
  const pick = sections
    .filter((s) => semver.valid(s.version) && semver.gt(s.version, from) && semver.lte(s.version, to))
    .sort((x, y) => semver.rcompare(x.version, y.version));
  const out: ChangelogSection[] = [];
  let total = 0;
  for (const s of pick) {
    if (total + s.text.length > maxTotal) break;
    out.push(s);
    total += s.text.length;
  }
  return out;
}

// ------------------------------------------------------------------------------------ compatibilidad

export interface Constraint {
  name: string; // node | python | nombre de un peer (react, typescript…)
  version: string; // 18 | 18.17 | 18.2.0
}

export interface VersionConstraints {
  version: string;
  engines: Record<string, string> | null;
  peer: Record<string, string> | null;
  requires_python: string | null;
}

export type Check = { constraint: string; range: string | null; ok: boolean | null };

export function parseConstraints(raw: string): Constraint[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((s) => {
      const at = s.lastIndexOf('@');
      return at > 0 ? { name: s.slice(0, at).toLowerCase(), version: s.slice(at + 1) } : { name: s.toLowerCase(), version: '' };
    })
    .filter((c) => c.version && /^[0-9][0-9A-Za-z.+-]*$/.test(c.version));
}

/** ¿La versión objetivo (p. ej. "18" o "18.2.0") cumple el rango? null = la versión del paquete no declara este requisito. */
export function satisfiesTarget(eco: Ecosystem, range: string | null | undefined, target: string): boolean | null {
  if (!range) return null;
  if (eco === 'pypi') {
    const parts = target.split('.');
    const full = [...parts, '0', '0'].slice(0, 3).join('.');
    try {
      return pep440.satisfies(full, range);
    } catch {
      return null;
    }
  }
  const r = semver.validRange(range, { loose: true });
  if (!r) return null;
  const parts = target.split('.');
  // "18" = cualquier 18.x: compatible si el rango admite alguna 18.x; "18.2.0" exacto: satisfies.
  if (parts.length < 3) return semver.intersects(r, parts.length === 1 ? `${parts[0]}.x` : `${parts[0]}.${parts[1]}.x`, { loose: true });
  return semver.satisfies(target, r, { loose: true, includePrerelease: true });
}

export function checkVersion(eco: Ecosystem, v: VersionConstraints, constraints: Constraint[]): Check[] {
  return constraints.map((c) => {
    // crates.io: rust-version es la versión mínima de Rust, es decir el rango ">=x".
    const range =
      eco === 'pypi'
        ? c.name === 'python'
          ? v.requires_python
          : null
        : eco === 'crates'
          ? c.name === 'rust' && v.engines?.rust
            ? `>=${v.engines.rust}`
            : null
          : eco === 'packagist' && c.name === 'php'
            ? v.engines?.php ?? null
            : c.name === 'node'
              ? v.engines?.node ?? null
              : v.peer?.[c.name] ?? null;
    return { constraint: `${c.name}@${c.version}`, range, ok: satisfiesTarget(eco, range, c.version) };
  });
}

export function sortDesc(eco: Ecosystem, versions: string[]): string[] {
  return eco !== 'pypi'
    ? versions.filter((v) => semver.valid(v)).sort((a, b) => semver.rcompare(a, b))
    : versions.filter((v) => pep440.valid(v)).sort((a, b) => pep440.rcompare(a, b));
}
