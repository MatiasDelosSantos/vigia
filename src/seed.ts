import { npmTopDownloads } from 'npm-high-impact';
import { pool } from './db.js';
import { config } from './config.js';
import { intervalFor } from './connectors/index.js';
import { canonicalName, httpGet, type Ecosystem } from './util.js';

const TOP_PYPI_URL = 'https://hugovk.github.io/top-pypi-packages/top-pypi-packages.min.json';

async function insertPackages(eco: Ecosystem, names: string[]): Promise<number> {
  const rows = names
    .map((raw, i) => ({ name: canonicalName(eco, raw), rank: i + 1 }))
    .filter((r): r is { name: string; rank: number } => r.name !== null);
  if (rows.length === 0) return 0;
  // Los más populares quedan primeros en la cola (desfase de 50 ms por puesto).
  const r = await pool.query(
    `INSERT INTO entity (type, ecosystem, name, key, popularity_rank, origin, check_interval_s, next_check_at)
     SELECT 'package', $1, n, $1 || ':' || n, rk, 'seed', iv, now() + (rk * interval '50 milliseconds')
     FROM unnest($2::text[], $3::int[], $4::int[]) AS t(n, rk, iv)
     ON CONFLICT (key) DO UPDATE SET popularity_rank = EXCLUDED.popularity_rank, check_interval_s = EXCLUDED.check_interval_s,
       origin = CASE WHEN entity.origin = 'demand' THEN 'seed' ELSE entity.origin END, tracked = true`,
    [eco, rows.map((r) => r.name), rows.map((r) => r.rank), rows.map((r) => intervalFor(eco, r.rank, 'seed'))],
  );
  return r.rowCount ?? 0;
}

/** Idempotente: se ejecuta en cada arranque del worker y respeta los límites configurados. */
export async function seed(): Promise<void> {
  await pool.query(
    `INSERT INTO entity (type, ecosystem, name, key, origin, check_interval_s) VALUES
       ('feed', 'system', 'pypi-rss', 'feed:pypi-rss', 'feed', 60),
       ('feed', 'system', 'openrouter-models', 'feed:openrouter-models', 'feed', 900)
     ON CONFLICT (key) DO NOTHING`,
  );
  const npm = await insertPackages('npm', npmTopDownloads.slice(0, config.seedNpmLimit));
  console.log(`seed npm: ${npm} paquetes`);
  try {
    const r = await httpGet(TOP_PYPI_URL, { timeoutMs: 30_000 });
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    const rows: Array<{ project: string }> = JSON.parse(r.body).rows ?? [];
    const pypi = await insertPackages('pypi', rows.slice(0, config.seedPypiLimit).map((x) => x.project));
    console.log(`seed pypi: ${pypi} paquetes`);
  } catch (err) {
    console.error('seed pypi falló (se reintenta en el próximo arranque):', err);
  }
}
