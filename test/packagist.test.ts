import { describe, expect, it } from 'vitest';
import { canonicalName } from '../src/util.js';
import { composerRange, expandMinified, semverOf } from '../src/connectors/packagist.js';
import { checkVersion, parseConstraints } from '../src/upgrade.js';
import { splitPackagePath } from '../src/paths.js';

describe('packagist', () => {
  it('valida nombres vendor/paquete', () => {
    expect(canonicalName('packagist', 'Laravel/Framework')).toBe('laravel/framework');
    expect(canonicalName('packagist', 'symfony/polyfill-mbstring')).toBe('symfony/polyfill-mbstring');
    expect(canonicalName('packagist', 'laravel')).toBeNull();
    expect(canonicalName('packagist', '../../etc/passwd')).toBeNull();
    expect(canonicalName('packagist', 'a/b/c')).toBeNull();
  });

  it('expande el formato minificado de Composer', () => {
    const out = expandMinified([
      { name: 'a/b', version: '2.0.0', require: { php: '^8.1' }, license: ['MIT'] },
      { version: '1.9.0' },
      { version: '1.8.0', require: { php: '^7.4' }, license: '__unset' },
    ]);
    expect(out[1]).toMatchObject({ name: 'a/b', version: '1.9.0', require: { php: '^8.1' }, license: ['MIT'] });
    expect(out[2]!.license).toBeUndefined();
    expect(out[2]!.require).toEqual({ php: '^7.4' });
  });

  it('normaliza versiones y restricciones de Composer', () => {
    expect(semverOf('v13.35.0')).toBe('13.35.0');
    expect(semverOf('1.2')).toBe('1.2.0');
    expect(semverOf('dev-master')).toBeNull();
    expect(composerRange('^7.4 || ^8.0')).toBe('^7.4 || ^8.0');
    expect(composerRange('>=7.2 <8.0')).toBe('>=7.2 <8.0');
    expect(composerRange('^7.4|^8.0')).toBe('^7.4 || ^8.0');
    expect(composerRange('>=5.3,<7.0@dev')).toBe('>=5.3 <7.0');
    expect(composerRange('dev-master')).toBeNull();
    expect(composerRange(undefined)).toBeNull();
  });

  it('compatibilidad con PHP y con otros paquetes', () => {
    const v = { engines: { php: '^8.1 || ^8.2' }, peer: { 'illuminate/support': '^10.0' }, requires_python: null };
    expect(checkVersion('packagist', v, parseConstraints('php@8.2'))[0]!.ok).toBe(true);
    expect(checkVersion('packagist', v, parseConstraints('php@7.4'))[0]!.ok).toBe(false);
    expect(checkVersion('packagist', v, parseConstraints('illuminate/support@10'))[0]!.ok).toBe(true);
    expect(checkVersion('packagist', v, parseConstraints('illuminate/support@11'))[0]!.ok).toBe(false);
  });

  it('los nombres con barra no confunden los sufijos de la ruta', () => {
    expect(splitPackagePath('packagist/laravel/framework/versions')).toMatchObject({ eco: 'packagist', name: 'laravel/framework', suffix: 'versions' });
    expect(splitPackagePath('packagist/laravel/history')).toMatchObject({ name: 'laravel/history', suffix: '' });
    expect(splitPackagePath('packagist/acme/versions/versions/1.0.0')).toMatchObject({ name: 'acme/versions', suffix: 'version', version: '1.0.0' });
  });
});
