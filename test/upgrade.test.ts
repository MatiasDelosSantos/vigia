import { describe, expect, it } from 'vitest';
import { changelogBetween, checkVersion, diffSurfaces, parseChangelog, parseConstraints, satisfiesTarget } from '../src/upgrade.js';
import type { Surface } from '../src/apisurface.js';

describe('diffSurfaces', () => {
  const a: Surface = {
    truncated: false,
    modules: {
      '.': { old: { kind: 'function', sig: '(): void' }, keep: { kind: 'function', sig: '(a: string): void' }, Cls: { kind: 'class', sig: 'class', members: { run: { t: '(): void' }, gone: { t: 'number' } } } },
      './headers': { cookies: { kind: 'function', sig: '(): ReadonlyRequestCookies' } },
      './legacy': { x: { kind: 'variable', sig: 'number' } },
    },
  };
  const b: Surface = {
    truncated: false,
    modules: {
      '.': { keep: { kind: 'function', sig: '(a: string): void', dep: 'Use other()' }, fresh: { kind: 'function', sig: '(): void' }, Cls: { kind: 'class', sig: 'class', members: { run: { t: '(): Promise<void>' } } } },
      './headers': { cookies: { kind: 'function', sig: '(): Promise<ReadonlyRequestCookies>' } },
    },
  };
  const d = diffSurfaces('next', a, b);
  it('detecta exports eliminados, firmas cambiadas y módulos quitados', () => {
    expect(d.removed.map((x) => x.name)).toEqual(['old']);
    expect(d.changed).toEqual([{ module: 'next/headers', name: 'cookies', kind_before: 'function', kind_after: 'function', before: '(): ReadonlyRequestCookies', after: '(): Promise<ReadonlyRequestCookies>' }]);
    expect(d.modules_removed).toEqual(['next/legacy']);
  });
  it('detecta miembros eliminados/cambiados, deprecaciones nuevas y agregados', () => {
    expect(d.members_removed.map((x) => `${x.owner}.${x.member}`)).toEqual(['Cls.gone']);
    expect(d.members_changed.map((x) => `${x.owner}.${x.member}`)).toEqual(['Cls.run']);
    expect(d.deprecated).toEqual([{ module: 'next', name: 'keep', message: 'Use other()' }]);
    expect(d.added.map((x) => x.name)).toEqual(['fresh']);
  });
});

describe('changelog', () => {
  const md = '# Changelog\n\n## 2.1.0\n- feat B\n\n## [2.0.0] - 2024-01-01\n### Breaking\n- removed A\n\n## v1.9.0\n- fix\n';
  it('separa por versión y filtra el rango (from, to]', () => {
    const s = parseChangelog(md);
    expect(s.map((x) => x.version)).toEqual(['2.1.0', '2.0.0', '1.9.0']);
    expect(changelogBetween(s, '1.9.0', '2.1.0').map((x) => x.version)).toEqual(['2.1.0', '2.0.0']);
  });
});

describe('compatibilidad', () => {
  it('parsea restricciones', () => {
    expect(parseConstraints('node@18, react@18.2.0,bad')).toEqual([
      { name: 'node', version: '18' },
      { name: 'react', version: '18.2.0' },
    ]);
  });
  it('evalúa rangos npm con versión mayor o exacta', () => {
    expect(satisfiesTarget('npm', '>=18.17.0', '18')).toBe(true);
    expect(satisfiesTarget('npm', '>=20.9.0', '18')).toBe(false);
    expect(satisfiesTarget('npm', '^18.2.0 || ^19.0.0', '17')).toBe(false);
    expect(satisfiesTarget('npm', null, '18')).toBeNull();
  });
  it('evalúa Requires-Python', () => {
    expect(satisfiesTarget('pypi', '>=3.9', '3.8')).toBe(false);
    expect(satisfiesTarget('pypi', '>=3.8', '3.12')).toBe(true);
  });
  it('combina engines y peers por versión', () => {
    const checks = checkVersion('npm', { version: '15.0.0', engines: { node: '>=18.18.0' }, peer: { react: '^19.0.0' }, requires_python: null }, parseConstraints('node@18,react@18'));
    expect(checks.map((c) => c.ok)).toEqual([true, false]);
  });
});
