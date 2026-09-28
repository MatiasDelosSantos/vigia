import { hostname } from 'node:os';
import { pool } from './db.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';
import { refreshEntity } from './connectors/index.js';
import type { EntityRow } from './facts.js';
import { submitIndexNow } from './indexnow.js';

const BATCH = 24;
const LEASE = "interval '10 minutes'"; // si el worker muere a mitad de camino, la entidad vuelve a la cola
const MAX_BACKOFF_S = 24 * 3600;
let stopping = false;

async function claim(): Promise<EntityRow[]> {
  const r = await pool.query<EntityRow>(
    `UPDATE entity SET next_check_at = now() + ${LEASE}
     WHERE id IN (SELECT id FROM entity WHERE tracked AND next_check_at <= now()
                  ORDER BY next_check_at LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING *`,
    [BATCH],
  );
  return r.rows;
}

async function processEntity(entity: EntityRow): Promise<void> {
  try {
    const result = await refreshEntity(pool, entity);
    // Un paquete que ya no existe se revisa una vez por día, por si se republica.
    const interval = result.found ? entity.check_interval_s : Math.max(entity.check_interval_s, 24 * 3600);
    await pool.query(
      `UPDATE entity SET last_checked_at = now(), next_check_at = now() + make_interval(secs => $2), error_count = 0, last_error = NULL WHERE id = $1`,
      [entity.id, interval],
    );
  } catch (err) {
    const n = entity.error_count + 1;
    const backoff = Math.min(entity.check_interval_s * 2 ** Math.min(n, 8), MAX_BACKOFF_S);
    const msg = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE entity SET error_count = $2, last_error = $3, next_check_at = now() + make_interval(secs => $4) WHERE id = $1`,
      [entity.id, n, msg.slice(0, 500), backoff],
    );
    console.error(`error ${entity.key}: ${msg}`);
  }
}

const INDEXNOW_EVERY_MS = 30 * 60_000;

async function loop(): Promise<void> {
  let processed = 0;
  let lastLog = Date.now();
  // La primera notificación espera 20 min para que la verificación inicial haya avanzado.
  let lastIndexNow = Date.now() - INDEXNOW_EVERY_MS + 20 * 60_000;
  while (!stopping) {
    if (Date.now() - lastIndexNow > INDEXNOW_EVERY_MS) {
      lastIndexNow = Date.now();
      submitIndexNow()
        .then((n) => n && console.log(`indexnow: ${n} URLs notificadas`))
        .catch((err) => console.error('indexnow falló:', err instanceof Error ? err.message : err));
    }
    const batch = await claim();
    if (batch.length === 0) {
      await new Promise((r) => setTimeout(r, 2000));
    } else {
      // La concurrencia real hacia cada registry la limita httpGet por host.
      await Promise.all(batch.map(processEntity));
      processed += batch.length;
    }
    if (Date.now() - lastLog > 60_000) {
      console.log(`[worker ${hostname()}] ${processed} entidades procesadas en el último minuto`);
      processed = 0;
      lastLog = Date.now();
    }
  }
}

async function main(): Promise<void> {
  await migrate();
  await seed();
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sig, () => {
      console.log(`${sig}: terminando el lote actual`);
      stopping = true;
    });
  }
  await loop();
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
