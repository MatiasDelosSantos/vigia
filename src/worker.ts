import { hostname } from 'node:os';
import { pool } from './db.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';
import { refreshEntity } from './connectors/index.js';
import type { EntityRow } from './facts.js';
import { submitEolIndexNow, submitIndexNow } from './indexnow.js';
import { recoverJobs, runNextJob, scheduleTopUpgrades } from './analysis.js';
import { scheduleNewMajorGuides } from './feeds.js';

/**
 * Carriles de verificación: cada ecosistema avanza a su propio ritmo. Antes había un único lote de 24 y, si caían varios
 * crates (1 request por segundo), todo el lote esperaba a ese registry y el resto se frenaba.
 */
const LANES: Array<{ name: string; ecosystems: string[]; batch: number }> = [
  { name: 'npm', ecosystems: ['npm'], batch: 8 },
  { name: 'pypi', ecosystems: ['pypi'], batch: 6 },
  { name: 'crates', ecosystems: ['crates'], batch: 1 },
  { name: 'packagist', ecosystems: ['packagist'], batch: 4 },
  { name: 'eol', ecosystems: ['eol'], batch: 2 },
];
const LANE_ECOSYSTEMS = LANES.flatMap((l) => l.ecosystems);
const LEASE = "interval '10 minutes'"; // si el worker muere a mitad de camino, la entidad vuelve a la cola
const MAX_BACKOFF_S = 24 * 3600;
let stopping = false;

/** Reclama entidades vencidas de los ecosistemas de un carril (ecosystems = null: lo que ningún carril cubre, p. ej. los feeds). */
async function claim(ecosystems: string[] | null, batch: number): Promise<EntityRow[]> {
  const r = await pool.query<EntityRow>(
    `UPDATE entity SET next_check_at = now() + ${LEASE}
     WHERE id IN (SELECT id FROM entity WHERE tracked AND next_check_at <= now()
                  AND (CASE WHEN $3::text[] IS NULL THEN NOT (ecosystem = ANY($2::text[])) ELSE ecosystem = ANY($3::text[]) END)
                  ORDER BY next_check_at LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING *`,
    [batch, LANE_ECOSYSTEMS, ecosystems],
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

const processedBy = new Map<string, number>();

/** Un carril: reclama y procesa lotes de sus ecosistemas, sin esperar a los demás. */
async function lane(name: string, ecosystems: string[] | null, batchSize: number): Promise<void> {
  while (!stopping) {
    const batch = await claim(ecosystems, batchSize);
    if (batch.length === 0) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    // La concurrencia real hacia cada registry la limita httpGet por host.
    await Promise.all(batch.map(processEntity));
    processedBy.set(name, (processedBy.get(name) ?? 0) + batch.length);
  }
}

async function loop(): Promise<void> {
  let lastLog = Date.now();
  // La primera notificación espera 20 min para que la verificación inicial haya avanzado.
  let lastIndexNow = Date.now() - INDEXNOW_EVERY_MS + 20 * 60_000;
  const lanes = [...LANES.map((l) => lane(l.name, l.ecosystems, l.batch)), lane('other', null, 4)];
  while (!stopping) {
    if (Date.now() - lastIndexNow > INDEXNOW_EVERY_MS) {
      lastIndexNow = Date.now();
      submitIndexNow()
        .then((n) => n && console.log(`indexnow: ${n} URLs notificadas`))
        .catch((err) => console.error('indexnow falló:', err instanceof Error ? err.message : err));
      submitEolIndexNow()
        .then((n) => n && console.log(`indexnow (fin de vida): ${n} URLs notificadas`))
        .catch((err) => console.error('indexnow (fin de vida) falló:', err instanceof Error ? err.message : err));
    }
    await new Promise((r) => setTimeout(r, 2000));
    if (Date.now() - lastLog > 60_000) {
      const parts = [...processedBy.entries()].map(([k, v]) => `${k} ${v}`).join(', ');
      console.log(`[worker ${hostname()}] entidades procesadas en el último minuto: ${parts || 'ninguna'}`);
      processedBy.clear();
      lastLog = Date.now();
    }
  }
  await Promise.all(lanes);
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
  await recoverJobs();
  await Promise.all([loop(), analysisLoop()]);
  await pool.end();
}

const PREGEN_EVERY_MS = 6 * 3600_000;

/** Análisis pesados (tipos de paquetes) de a uno, en paralelo con la verificación normal. */
async function analysisLoop(): Promise<void> {
  // La primera pregeneración espera 5 min para no competir con el arranque.
  let lastPregen = Date.now() - PREGEN_EVERY_MS + 5 * 60_000;
  let lastMajorScan = 0;
  while (!stopping) {
    if (Date.now() - lastPregen > PREGEN_EVERY_MS) {
      lastPregen = Date.now();
      await scheduleTopUpgrades(300)
        .then((n) => n && console.log(`pregeneración: ${n} análisis encolados`))
        .catch((err) => console.error('pregeneración falló:', err instanceof Error ? err.message : err));
    }
    if (Date.now() - lastMajorScan > 30 * 60_000) {
      lastMajorScan = Date.now();
      await scheduleNewMajorGuides()
        .then((n) => n && console.log(`versiones mayores nuevas: ${n} análisis encolados`))
        .catch((err) => console.error('detector de mayores falló:', err instanceof Error ? err.message : err));
    }
    const worked = await runNextJob().catch((err) => {
      console.error('cola de análisis:', err instanceof Error ? err.message : err);
      return false;
    });
    if (!worked) await new Promise((r) => setTimeout(r, 3000));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
