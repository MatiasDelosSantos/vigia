import { pool } from './db.js';
import { config } from './config.js';
import { LOCALES } from './i18n/index.js';
import { localeUrl } from './api/pages.js';

const ENDPOINT = 'https://api.indexnow.org/indexnow';
// Cambiar la versión fuerza una notificación completa (p. ej. al agregar idiomas).
const STATE_KEY = 'indexnow_last_submit_v4_check';
const BATCH = 10_000; // límite de IndexNow por request
const STATIC_PATHS = ['/', '/check', '/upgrade', '/weekly', '/docs', '/models', '/changes', '/status', '/npm', '/pypi'];

async function post(urls: string[]): Promise<void> {
  const base = config.publicUrl;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8', 'user-agent': config.userAgent },
    body: JSON.stringify({ host: new URL(base).host, key: config.indexNowKey, keyLocation: `${base}/${config.indexNowKey}.txt`, urlList: urls }),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status !== 200 && res.status !== 202) throw new Error(`indexnow ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/**
 * Avisa a los buscadores que soportan IndexNow (Bing, Yandex, Seznam, Naver…) qué páginas cambiaron, en todos los idiomas.
 * Primera vez: todas las páginas de paquetes verificados. Después: sólo las que cambiaron o se agregaron.
 */
export async function submitIndexNow(): Promise<number> {
  if (!config.indexNowKey) return 0;
  const state = await pool.query<{ v: string }>(`SELECT v FROM kv WHERE k = $1`, [STATE_KEY]);
  const since = state.rows[0]?.v ?? null;
  const startedAt = new Date().toISOString();
  const r = await pool.query<{ ecosystem: string; name: string; rank: number | null }>(
    `SELECT ecosystem, name, popularity_rank AS rank FROM entity
     WHERE type = 'package' AND tracked AND last_checked_at IS NOT NULL
       AND ($1::timestamptz IS NULL OR last_changed_at > $1 OR created_at > $1)
     ORDER BY popularity_rank NULLS LAST LIMIT 50000`,
    [since],
  );
  if (r.rows.length === 0) return 0;
  // Misma política que los sitemaps: inglés completo; traducciones sólo para los paquetes más populares.
  const localizedTop = Number(process.env.SITEMAP_LOCALIZED_TOP ?? 300);
  const staticPaths = since ? ['/changes'] : STATIC_PATHS;
  const urls = LOCALES.flatMap((L) => [
    ...staticPaths.map((p) => localeUrl(L, p)),
    ...r.rows.filter((x) => L.code === 'en' || (x.rank !== null && x.rank <= localizedTop)).map((x) => localeUrl(L, `/${x.ecosystem}/${x.name}`)),
  ]);

  for (let i = 0; i < urls.length; i += BATCH) {
    await post(urls.slice(i, i + BATCH));
    if (i + BATCH < urls.length) await new Promise((res) => setTimeout(res, 2000)); // sin ráfagas
  }
  await pool.query(
    `INSERT INTO kv (k, v) VALUES ($1, to_jsonb($2::text)) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now()`,
    [STATE_KEY, startedAt],
  );
  return urls.length;
}
