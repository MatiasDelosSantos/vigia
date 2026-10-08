import type { Queryable } from '../db.js';
import type { EntityRow } from '../facts.js';
import { ingestNpm, type IngestResult } from './npm.js';
import { ingestPypi, pollPypiRss } from './pypi.js';
import { ingestCrates } from './crates.js';
import { ingestPackagist } from './packagist.js';
import { ingestEol } from './eol.js';
import { syncOpenRouter } from './openrouter.js';

export type { IngestResult };

/** Punto único de refresco: lo usan el worker (programado) y la API (resolución en vivo por demanda). */
export async function refreshEntity(db: Queryable, entity: EntityRow): Promise<IngestResult> {
  if (entity.key === 'feed:pypi-rss') {
    await pollPypiRss(db);
    return { found: true, changed: false };
  }
  if (entity.key === 'feed:openrouter-models') {
    const r = await syncOpenRouter(db);
    return { found: true, changed: r.changed > 0 };
  }
  if (entity.type === 'package' && entity.ecosystem === 'npm') return ingestNpm(db, entity);
  if (entity.type === 'package' && entity.ecosystem === 'pypi') return ingestPypi(db, entity);
  if (entity.type === 'package' && entity.ecosystem === 'crates') return ingestCrates(db, entity);
  if (entity.type === 'package' && entity.ecosystem === 'packagist') return ingestPackagist(db, entity);
  if (entity.type === 'product' && entity.ecosystem === 'eol') return ingestEol(db, entity);
  throw new Error(`sin conector para ${entity.key}`);
}

/** Cada cuánto revisar un paquete según su popularidad (los feeds tienen su propio intervalo). */
export function intervalFor(ecosystem: string, rank: number | null, origin: string): number {
  if (ecosystem === 'eol') return 12 * 3600;
  if (origin === 'demand' || rank === null) return 6 * 3600;
  // crates.io: 1 request/segundo para todo el ecosistema; con 3.000 crates, una revisión cada 12 h cabe de sobra.
  if (ecosystem === 'crates' || ecosystem === 'packagist') return rank <= 300 ? 3600 : 12 * 3600;
  if (ecosystem === 'npm') return rank <= 500 ? 15 * 60 : rank <= 2000 ? 30 * 60 : 2 * 3600;
  // PyPI: el feed RSS adelanta la revisión cuando hay una release nueva, así que el sondeo base puede ser lento.
  return rank <= 1000 ? 3600 : 6 * 3600;
}
