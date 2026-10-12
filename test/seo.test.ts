import { describe, expect, it } from 'vitest';
import { layout, translatedIndexable } from '../src/api/pages.js';
import { LOCALES } from '../src/i18n/index.js';

const es = LOCALES.find((l) => l.code === 'es')!;
const en = LOCALES[0]!;
const page = (L: typeof en, path: string) => layout(L, { title: 't', description: 'd', path, body: '' });

describe('indexación de traducciones', () => {
  it('sólo las páginas generales se ofrecen traducidas', () => {
    for (const p of ['/', '/check', '/docs', '/models', '/upgrade', '/npm', '/pypi']) expect(translatedIndexable(p), p).toBe(true);
    for (const p of ['/npm/react', '/packagist/laravel/framework', '/models/anthropic', '/models/openai/gpt-4o', '/upgrade/npm/next/14-to-15', '/npm?page=2', '/changes', '/status'])
      expect(translatedIndexable(p), p).toBe(false);
  });

  it('una página de datos traducida lleva noindex y no anuncia traducciones; en inglés queda indexable', () => {
    const esPkg = page(es, '/npm/react');
    expect(esPkg).toContain('content="noindex, follow"');
    expect(esPkg).not.toContain('hreflang=');
    const enPkg = page(en, '/npm/react');
    expect(enPkg).not.toContain('noindex');
    expect(enPkg).not.toContain('hreflang=');
  });

  it('las páginas generales mantienen sus 18 idiomas', () => {
    const esHome = page(es, '/check');
    expect(esHome).not.toContain('noindex');
    expect((esHome.match(/rel="alternate" hreflang=/g) ?? []).length).toBe(19); // 18 idiomas + x-default
  });
});
