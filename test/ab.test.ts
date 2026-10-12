import { describe, expect, it } from 'vitest';
import { agentBar, agentSection, ctaVariant } from '../src/api/pages.js';
import { LOCALES } from '../src/i18n/index.js';

describe('prueba A/B del bloque de instalación', () => {
  it('la variante depende sólo de la ruta y reparte parejo', () => {
    expect(ctaVariant('/npm/react')).toBe(ctaVariant('/npm/react'));
    const counts = { a: 0, f: 0, g: 0 };
    for (let i = 0; i < 3000; i++) counts[ctaVariant(`/npm/paquete-${i}`)]++;
    for (const v of Object.values(counts)) expect(v).toBeGreaterThan(900);
  });

  it('los botones llevan atributos de seguimiento y el comando para copiar', () => {
    for (const html of [agentSection(LOCALES[0]!), agentBar(LOCALES[0]!)]) {
      expect(html).toContain('data-cta="copy"');
      expect(html).toContain('data-copy="claude mcp add --transport http vigia');
      expect(html).toContain('data-cta="cursor"');
      expect(html).toContain('data-cta="vscode"');
    }
  });
});

describe('bloques de la variante de contenido', () => {
  it('el prompt para copiar apunta a la API de ese paquete y los botones se registran', async () => {
    const { assistantBlock, humanActionsBlock } = await import('../src/api/pages.js');
    const f = assistantBlock('npm', 'express');
    expect(f).toContain('/v1/packages/npm/express');
    expect(f).toContain('data-cta="prompt"');
    const g = humanActionsBlock('pypi', 'requests');
    expect(g).toContain('/feed/package/pypi/requests.atom');
    expect(g).toContain('data-cta="feed"');
    expect(g).toContain('requirements.txt');
  });
});
