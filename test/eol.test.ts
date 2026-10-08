import { describe, expect, it } from 'vitest';
import { cycleStatus, decorate, matchCycle } from '../src/eol.js';
import { normalizeCycles, type EolCycle } from '../src/connectors/eol.js';

const cycle = (o: Partial<EolCycle>): EolCycle => ({
  cycle: '3.9', codename: null, release_date: '2020-10-05', lts: false, lts_from: null, support_until: '2022-05-17', eol_from: '2025-10-31', eol_flag: false, latest: '3.9.25', latest_date: '2025-10-31', ...o,
});

describe('eol', () => {
  it('calcula el estado según la fecha', () => {
    const c = cycle({});
    expect(cycleStatus(c, '2020-01-01')).toBe('upcoming');
    expect(cycleStatus(c, '2021-01-01')).toBe('supported');
    expect(cycleStatus(c, '2023-01-01')).toBe('security_only');
    expect(cycleStatus(c, '2025-10-31')).toBe('end_of_life');
    expect(cycleStatus(cycle({ eol_from: null, support_until: null }), '2030-01-01')).toBe('supported');
    expect(cycleStatus(cycle({ eol_from: null, eol_flag: true }), '2030-01-01')).toBe('end_of_life');
  });

  it('cuenta los días hasta el fin de vida y desde él', () => {
    expect(decorate(cycle({}), '2025-10-01').days_until_eol).toBe(30);
    expect(decorate(cycle({}), '2025-11-30').days_since_eol).toBe(30);
    expect(decorate(cycle({}), '2025-11-30').days_until_eol).toBeNull();
  });

  it('asocia una versión con su ciclo', () => {
    const cs = [{ cycle: '3.9' }, { cycle: '3.10' }, { cycle: '3' }, { cycle: '22.04' }, { cycle: '18' }];
    expect(matchCycle(cs, '3.9.7')?.cycle).toBe('3.9');
    expect(matchCycle(cs, '3.10.1')?.cycle).toBe('3.10');
    expect(matchCycle(cs, '3.1')?.cycle).toBe('3');
    expect(matchCycle(cs, 'v18.17.1')?.cycle).toBe('18');
    expect(matchCycle(cs, '22.04.3')?.cycle).toBe('22.04');
    expect(matchCycle(cs, '3.9')?.cycle).toBe('3.9');
    expect(matchCycle(cs, '4.0')).toBeNull();
    expect(matchCycle(cs, '180')).toBeNull();
  });

  it('normaliza la respuesta de endoflife.date', () => {
    const out = normalizeCycles([
      { name: '3.14', codename: null, releaseDate: '2025-10-07', isLts: false, eoasFrom: '2027-10-01', isEol: false, eolFrom: '2030-10-31', latest: { name: '3.14.8', date: '2026-09-30' } },
      { name: 20, isEol: true, eolFrom: null },
      null,
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ cycle: '3.14', support_until: '2027-10-01', eol_from: '2030-10-31', latest: '3.14.8', eol_flag: false });
    expect(out[1]).toMatchObject({ cycle: '20', eol_from: null, eol_flag: true });
  });
});
