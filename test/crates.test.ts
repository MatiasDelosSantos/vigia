import { describe, expect, it } from 'vitest';
import { canonicalName, isEcosystem } from '../src/util.js';
import { checkVersion, parseConstraints, sortDesc } from '../src/upgrade.js';
import { compareVersions, isPrerelease, majorOf } from '../src/versions.js';
import { routeGroup } from '../src/analytics.js';

describe('crates.io', () => {
  it('reconoce el ecosistema y valida nombres', () => {
    expect(isEcosystem('crates')).toBe(true);
    expect(canonicalName('crates', 'Serde_JSON')).toBe('serde_json');
    expect(canonicalName('crates', 'tokio-util')).toBe('tokio-util');
    expect(canonicalName('crates', '../etc')).toBeNull();
    expect(canonicalName('crates', 'a'.repeat(65))).toBeNull();
    expect(canonicalName('crates', '')).toBeNull();
  });

  it('ordena y compara versiones con semver', () => {
    expect(sortDesc('crates', ['0.9.0', '1.0.0', '1.0.0-rc.1', '0.10.0'])).toEqual(['1.0.0', '1.0.0-rc.1', '0.10.0', '0.9.0']);
    expect(isPrerelease('crates', '1.0.0-alpha.1')).toBe(true);
    expect(isPrerelease('crates', '1.0.0')).toBe(false);
    expect(compareVersions('crates', '1.2.0', '1.10.0')).toBeLessThan(0);
    expect(majorOf('crates', '2.3.4')).toBe(2);
  });

  it('rust-version es una versión mínima: compatible si el Rust objetivo es igual o mayor', () => {
    const v = { engines: { rust: '1.70' }, peer: null, requires_python: null };
    const [c] = parseConstraints('rust@1.75');
    expect(checkVersion('crates', v, [c!])[0]!.ok).toBe(true);
    expect(checkVersion('crates', v, parseConstraints('rust@1.70'))[0]!.ok).toBe(true);
    expect(checkVersion('crates', v, parseConstraints('rust@1.65'))[0]!.ok).toBe(false);
    // Sin rust-version declarado: no se puede afirmar (null), y no cuenta como incompatible.
    expect(checkVersion('crates', { engines: null, peer: null, requires_python: null }, parseConstraints('rust@1.50'))[0]!.ok).toBeNull();
  });

  it('las páginas de crates se agrupan como paquetes', () => {
    expect(routeGroup('/crates/serde')).toBe('page:package');
    expect(routeGroup('/es/crates')).toBe('page:browse');
  });
});
