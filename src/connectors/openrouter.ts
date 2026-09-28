import { tx, type Queryable } from '../db.js';
import { setFact, upsertEntity } from '../facts.js';
import { httpGet, sha256, UpstreamError } from '../util.js';

const URL_MODELS = 'https://openrouter.ai/api/v1/models';

/** OpenRouter publica precios en USD por token como string; "-1" = precio variable (routers). */
function perMillion(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1e6 * 1e6) / 1e6;
}

/** Sincroniza el catálogo de modelos de IA. Detecta altas, bajas, cambios de precio/contexto y fechas de retiro. */
export async function syncOpenRouter(db: Queryable): Promise<{ models: number; changed: number }> {
  const res = await httpGet(URL_MODELS, { timeoutMs: 30_000 });
  if (res.status !== 200) throw new UpstreamError(`openrouter ${res.status}`, res.status);
  const models: any[] = JSON.parse(res.body).data ?? [];
  const src = { sourceUrl: URL_MODELS, sourceSha256: sha256(res.body), method: 'aggregator', confidence: 0.9 };
  let changed = 0;
  const seen: string[] = [];

  for (const m of models) {
    if (typeof m.id !== 'string') continue;
    const key = `model:${m.id}`;
    seen.push(key);
    await tx(async (c) => {
      const e = await upsertEntity(c, { type: 'model', ecosystem: 'ai', name: m.id, key, origin: 'feed', intervalS: 0, tracked: false });
      const facts: Array<[string, unknown]> = [
        ['exists', true],
        [
          'pricing',
          {
            currency: 'USD',
            unit: 'per_million_tokens',
            input: perMillion(m.pricing?.prompt),
            output: perMillion(m.pricing?.completion),
            cache_read: perMillion(m.pricing?.input_cache_read),
            variable: Number(m.pricing?.prompt) < 0,
          },
        ],
        ['context_length', m.context_length ?? null],
        ['max_output_tokens', m.top_provider?.max_completion_tokens ?? null],
        ['expiration_date', m.expiration_date ?? null],
        ['knowledge_cutoff', m.knowledge_cutoff ?? null],
      ];
      for (const [predicate, value] of facts) {
        if (await setFact(c, e, { predicate, value, ...src })) changed++;
      }
      const attrs = {
        display_name: typeof m.name === 'string' ? m.name.slice(0, 200) : m.id,
        description: typeof m.description === 'string' ? m.description.slice(0, 500) : null,
        provider: m.id.split('/')[0],
        created: typeof m.created === 'number' ? new Date(m.created * 1000).toISOString() : null,
        input_modalities: m.architecture?.input_modalities ?? null,
        output_modalities: m.architecture?.output_modalities ?? null,
        hugging_face_id: m.hugging_face_id ?? null,
      };
      await c.query(`UPDATE entity SET attrs = $2, last_checked_at = now() WHERE id = $1`, [e.id, attrs]);
    });
  }

  // Modelos que antes estaban y ya no figuran: se registran como retirados del catálogo (no se borran).
  const gone = await db.query<{ id: number; key: string }>(
    `SELECT e.id, e.key FROM entity e JOIN fact f ON f.entity_id = e.id AND f.predicate = 'exists' AND f.recorded_to IS NULL
     WHERE e.ecosystem = 'ai' AND f.value = 'true'::jsonb AND NOT (e.key = ANY($1))`,
    [seen],
  );
  for (const e of gone.rows) {
    await tx((c) => setFact(c, e, { predicate: 'exists', value: false, ...src }));
    changed++;
  }
  return { models: seen.length, changed };
}
