import { describe, expect, it } from 'vitest';
import { evaluateNpm, evaluatePypi, parsePackageJson, parseRequirements } from '../src/check.js';
import { canonicalJson, canonicalName, normalizePypiName } from '../src/util.js';

describe('evaluateNpm', () => {
  it('rango que incluye la última versión', () => {
    expect(evaluateNpm('^16.1.0', '16.3.6')).toEqual({ verdict: 'up_to_date', majors_behind: 0 });
  });
  it('rango una versión mayor atrás', () => {
    expect(evaluateNpm('^15.0.0', '16.3.6')).toEqual({ verdict: 'outdated_major', majors_behind: 1 });
  });
  it('versión fija vieja dentro de la misma mayor', () => {
    expect(evaluateNpm('16.1.0', '16.3.6')).toEqual({ verdict: 'outdated', majors_behind: 0 });
  });
  it('en 0.x un salto de minor es incompatible', () => {
    expect(evaluateNpm('^0.3.0', '0.5.1').verdict).toBe('outdated_major');
  });
  it('comodín', () => {
    expect(evaluateNpm('*', '1.0.0').verdict).toBe('unpinned');
  });
  it('specs no semver', () => {
    expect(evaluateNpm('github:user/repo', '1.0.0').verdict).toBe('unsupported_spec');
    expect(evaluateNpm('workspace:*', '1.0.0').verdict).toBe('unsupported_spec');
  });
});

describe('evaluatePypi', () => {
  it('sin restricción', () => {
    expect(evaluatePypi('', '2.34.2').verdict).toBe('unpinned');
  });
  it('rango que incluye la última', () => {
    expect(evaluatePypi('>=2.0,<3', '2.34.2').verdict).toBe('up_to_date');
  });
  it('pin exacto de mayor anterior', () => {
    expect(evaluatePypi('==1.26.4', '2.3.1')).toEqual({ verdict: 'outdated_major', majors_behind: 1 });
  });
  it('compatible release que excluye la última', () => {
    expect(evaluatePypi('~=2.31.0', '2.34.2')).toEqual({ verdict: 'outdated', majors_behind: 0 });
  });
});

describe('parseo de manifests', () => {
  it('package.json con deps y devDeps', () => {
    const deps = parsePackageJson(JSON.stringify({ dependencies: { react: '^19.0.0' }, devDependencies: { vitest: '^5.0.0' } }));
    expect(deps).toEqual([
      { name: 'react', spec: '^19.0.0', dev: false },
      { name: 'vitest', spec: '^5.0.0', dev: true },
    ]);
  });
  it('requirements.txt con comentarios, extras, marcadores y opciones', () => {
    const txt = [
      '# comentario',
      '-r base.txt',
      '--index-url https://example.com/simple',
      'requests[socks]>=2.31  # http',
      'numpy==1.26.4 ; python_version < "3.13"',
      'Django',
      'pkg @ https://example.com/pkg.whl',
      'git+https://github.com/x/y.git',
    ].join('\n');
    expect(parseRequirements(txt)).toEqual([
      { name: 'requests', spec: '>=2.31' },
      { name: 'numpy', spec: '==1.26.4' },
      { name: 'Django', spec: '' },
    ]);
  });
});

describe('util', () => {
  it('normaliza nombres de PyPI según PEP 503', () => {
    expect(normalizePypiName('Typing_Extensions')).toBe('typing-extensions');
    expect(normalizePypiName('zope.interface')).toBe('zope-interface');
  });
  it('valida nombres npm con scope y rechaza inválidos', () => {
    expect(canonicalName('npm', '@Types/Node')).toBe('@types/node');
    expect(canonicalName('npm', '../etc/passwd')).toBeNull();
    expect(canonicalName('npm', 'a b')).toBeNull();
  });
  it('canonicalJson es independiente del orden de las claves', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
});

describe('evaluatePypi con cota superior', () => {
  it('"<4" con última 6.x son 3 mayores atrás', () => {
    expect(evaluatePypi('<4', '6.1.1')).toEqual({ verdict: 'outdated_major', majors_behind: 3 });
  });
  it('">=3.2,<4.0" con última 6.x', () => {
    expect(evaluatePypi('>=3.2,<4.0', '6.1.1')).toEqual({ verdict: 'outdated_major', majors_behind: 3 });
  });
  it('"<=5.2" con última 6.x es 1 mayor atrás', () => {
    expect(evaluatePypi('<=5.2', '6.1.1')).toEqual({ verdict: 'outdated_major', majors_behind: 1 });
  });
});
