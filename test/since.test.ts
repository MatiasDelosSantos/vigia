import { describe, expect, it } from 'vitest';
import { computeNewMajors, parseCutoff } from '../src/since.js';
import { sinceMonths } from '../src/api/since-pages.js';
import { parseRuntimeHints } from '../src/context.js';

const v = (version: string, published_at: string) => ({ version, published_at });

describe('changes since cutoff', () => {
  it('detecta versiones mayores nacidas después del corte', () => {
    const r = computeNewMajors(
      'npm',
      [v('13.5.0', '2024-01-01'), v('14.0.0', '2024-06-01'), v('14.2.1', '2025-02-01'), v('15.0.0', '2025-07-10'), v('15.1.0', '2025-08-01'), v('16.0.0', '2026-03-01'), v('14.2.9', '2026-04-01')],
      new Date('2025-06-30'),
    )!;
    expect(r.version_at_cutoff).toBe('14.2.1');
    expect(r.major_at_cutoff).toBe(14);
    expect(r.new_majors.map((m) => [m.major, m.first_version, m.first_published])).toEqual([[15, '15.0.0', '2025-07-10'], [16, '16.0.0', '2026-03-01']]);
    expect(r.latest).toBe('16.0.0');
    expect(r.majors_since).toBe(2);
  });

  it('ignora backports, paquetes sin cambio de mayor, paquetes posteriores al corte y versiones por calendario', () => {
    const cut = new Date('2025-06-30');
    expect(computeNewMajors('npm', [v('1.0.0', '2024-01-01'), v('1.4.0', '2025-09-01')], cut)).toBeNull();
    expect(computeNewMajors('npm', [v('2.0.0', '2025-07-01')], cut)).toBeNull();
    expect(computeNewMajors('npm', [v('1.0.0', '2024-01-01'), v('0.9.0', '2025-09-01')], cut)).toBeNull();
    expect(computeNewMajors('pypi', [v('2024.2.2', '2024-02-02'), v('2025.8.3', '2025-08-03')], cut)).toBeNull();
  });

  it('también funciona con las versiones de PyPI', () => {
    const r = computeNewMajors('pypi', [v('1.26.4', '2024-02-05'), v('2.0.0', '2024-06-16'), v('2.3.0', '2025-06-07'), v('3.0.0', '2026-01-10')], new Date('2025-06-30'))!;
    expect(r.major_at_cutoff).toBe(2);
    expect(r.new_majors[0]).toMatchObject({ major: 3, first_version: '3.0.0' });
  });

  it('interpreta fechas de corte', () => {
    expect(parseCutoff('2025-06')?.toISOString().slice(0, 10)).toBe('2025-06-30');
    expect(parseCutoff('2024-02')?.toISOString().slice(0, 10)).toBe('2024-02-29');
    expect(parseCutoff('2025-06-15')?.toISOString().slice(0, 10)).toBe('2025-06-15');
    expect(parseCutoff('2099-01')).toBeNull();
    expect(parseCutoff('2010-01')).toBeNull();
    expect(parseCutoff('junio 2025')).toBeNull();
    expect(parseCutoff(undefined)).toBeNull();
  });

  it('lista meses completos (el mes en curso queda afuera)', () => {
    const m = sinceMonths(new Date('2026-10-10T00:00:00Z'));
    expect(m[0]).toBe('2024-01');
    expect(m.at(-1)).toBe('2026-09');
    expect(m).toHaveLength(33);
  });
});

describe('project context', () => {
  it('lee pistas de runtime', () => {
    expect(parseRuntimeHints('node@18, python@3.9')).toEqual([
      { product: 'nodejs', version: '18', source: 'given' },
      { product: 'python', version: '3.9', source: 'given' },
    ]);
    expect(parseRuntimeHints('cobol@85,node@')).toEqual([]);
    expect(parseRuntimeHints(undefined)).toEqual([]);
  });
});
