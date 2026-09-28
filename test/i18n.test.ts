import { describe, expect, it } from 'vitest';
import { LOCALES, t } from '../src/i18n/index.js';
import { en, type MessageKey } from '../src/i18n/en.js';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n', () => {
  it('hay 18 idiomas con códigos únicos', () => {
    expect(LOCALES).toHaveLength(18);
    expect(new Set(LOCALES.map((l) => l.code)).size).toBe(18);
  });

  for (const L of LOCALES) {
    it(`${L.code}: mismas claves y mismos marcadores que el inglés, sin textos vacíos`, () => {
      for (const key of Object.keys(en) as MessageKey[]) {
        const s = L.m[key];
        expect(s, `${L.code}.${key}`).toBeTruthy();
        expect(placeholders(s), `${L.code}.${key}`).toEqual(placeholders(en[key]));
      }
      expect(Object.keys(L.m).sort()).toEqual(Object.keys(en).sort());
    });
  }

  it('interpola variables', () => {
    const es = LOCALES.find((l) => l.code === 'es')!;
    expect(t(es, 'list.retiring', { date: '2026-12-01' })).toBe('se retira el 2026-12-01');
  });

  it('el árabe se marca como RTL', () => {
    expect(LOCALES.find((l) => l.code === 'ar')!.dir).toBe('rtl');
  });
});
