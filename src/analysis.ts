import { Worker } from 'node:worker_threads';
import semver from 'semver';
import { pool } from './db.js';
import { httpGet } from './util.js';
import { extractTgz, fetchBuffer, TooLargeError } from './tarball.js';
import { typesEntries, type Surface } from './apisurface.js';
import { parseChangelog, type ChangelogSection } from './upgrade.js';
import type { EntityRow } from './facts.js';

const REGISTRY = 'https://registry.npmjs.org';
const encodeNpm = (name: string) => name.replace('/', '%2f');
const ANALYSIS_TIMEOUT_MS = 120_000;

export interface Snapshot {
  status: 'ok' | 'no_types' | 'too_large' | 'error';
  source: string | null;
  entry: string | null;
  surface: Surface | null;
  changelog: ChangelogSection[] | null;
  error: string | null;
  computed_at: Date;
}

export async function getSnapshot(entityId: number, version: string): Promise<Snapshot | null> {
  const r = await pool.query<Snapshot>(`SELECT status, source, entry, surface, changelog, error, computed_at FROM api_snapshot WHERE entity_id = $1 AND version = $2`, [entityId, version]);
  return r.rows[0] ?? null;
}

/** Corre el análisis en un hilo aparte con límite de memoria y de tiempo. */
function analyzeInWorker(files: Map<string, string>, entries: Array<[string, string]>): Promise<Surface> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./surface-worker.js', import.meta.url), {
      workerData: { files: [...files.entries()], entries },
      resourceLimits: { maxOldGenerationSizeMb: 640 },
    });
    const timer = setTimeout(() => {
      void w.terminate();
      reject(new Error('análisis de tipos excedió el tiempo límite'));
    }, ANALYSIS_TIMEOUT_MS);
    w.once('message', (m: { ok: boolean; surface?: Surface; error?: string }) => {
      clearTimeout(timer);
      void w.terminate();
      if (m.ok) resolve(m.surface!);
      else reject(new Error(m.error));
    });
    w.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function manifest(name: string, version: string): Promise<any> {
  const r = await httpGet(`${REGISTRY}/${encodeNpm(name)}/${encodeURIComponent(version)}`, { timeoutMs: 30_000 });
  if (r.status !== 200) throw new Error(`manifest ${name}@${version}: ${r.status}`);
  return JSON.parse(r.body);
}

/** Si el paquete no trae tipos, usamos @types/<nombre> de la misma versión mayor (o la más nueva). */
async function definitelyTyped(name: string, version: string): Promise<{ pkg: string; version: string } | null> {
  const typesPkg = name.startsWith('@') ? `@types/${name.slice(1).replace('/', '__')}` : `@types/${name}`;
  const r = await httpGet(`${REGISTRY}/${encodeNpm(typesPkg)}`, { accept: 'application/vnd.npm.install-v1+json', timeoutMs: 30_000 });
  if (r.status !== 200) return null;
  const versions = Object.keys(JSON.parse(r.body).versions ?? {}).filter((v) => semver.valid(v) && !semver.prerelease(v));
  if (versions.length === 0) return null;
  const major = semver.valid(version) ? semver.major(version) : null;
  const same = versions.filter((v) => semver.major(v) === major).sort(semver.rcompare);
  return { pkg: typesPkg, version: (same[0] ?? versions.sort(semver.rcompare)[0])! };
}

const CHANGELOG_FILE = /^(changelog|changes|history|releases?)(\.md|\.markdown|\.txt)?$/i;

/** Descarga el paquete (nunca lo ejecuta), analiza sus tipos públicos y guarda la "foto" de la versión. */
export async function computeSnapshot(entity: EntityRow, version: string): Promise<Snapshot['status']> {
  const save = async (s: Partial<Snapshot> & { status: Snapshot['status'] }) => {
    await pool.query(
      `INSERT INTO api_snapshot (entity_id, version, status, source, entry, surface, changelog, error, computed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (entity_id, version) DO UPDATE SET status = EXCLUDED.status, source = EXCLUDED.source, entry = EXCLUDED.entry,
         surface = EXCLUDED.surface, changelog = EXCLUDED.changelog, error = EXCLUDED.error, computed_at = now()`,
      [entity.id, version, s.status, s.source ?? null, s.entry ?? null, s.surface ? JSON.stringify(s.surface) : null, s.changelog ? JSON.stringify(s.changelog) : null, s.error ?? null],
    );
    return s.status;
  };
  try {
    const m = await manifest(entity.name, version);
    const files = extractTgz(await fetchBuffer(m.dist.tarball));
    const clFile = [...files.keys()].find((k) => CHANGELOG_FILE.test(k));
    const changelog = clFile ? parseChangelog(files.get(clFile)!) : null;

    let analysisFiles = files;
    let entries = typesEntries(files);
    let source = 'package';
    if (entries.length === 0) {
      const dt = await definitelyTyped(entity.name, version);
      if (!dt) return save({ status: 'no_types', changelog });
      const tm = await manifest(dt.pkg, dt.version);
      analysisFiles = extractTgz(await fetchBuffer(tm.dist.tarball));
      entries = typesEntries(analysisFiles);
      source = `${dt.pkg}@${dt.version}`;
      if (entries.length === 0) return save({ status: 'no_types', changelog, source });
    }
    const surface = await analyzeInWorker(analysisFiles, entries);
    return save({ status: 'ok', source, entry: entries.map(([k, f]) => `${k}=${f}`).join(' ').slice(0, 2000), surface, changelog });
  } catch (err) {
    if (err instanceof TooLargeError) return save({ status: 'too_large', error: err.message });
    throw err;
  }
}

// ------------------------------------------------------------------------------------ cola de trabajos

export async function enqueueSnapshot(entity: Pick<EntityRow, 'id' | 'key' | 'ecosystem'>, version: string, priority: number): Promise<void> {
  if (entity.ecosystem !== 'npm') return;
  await pool.query(
    `INSERT INTO analysis_job (key, kind, payload, priority) VALUES ($1, 'snapshot', $2, $3)
     ON CONFLICT (key) DO UPDATE SET priority = LEAST(analysis_job.priority, EXCLUDED.priority),
       status = CASE WHEN analysis_job.status = 'failed' AND analysis_job.attempts < 3 THEN 'queued' ELSE analysis_job.status END,
       updated_at = now()`,
    [`snapshot:${entity.key}@${version}`, JSON.stringify({ entityId: entity.id, version }), priority],
  );
}

export async function jobState(entity: Pick<EntityRow, 'key'>, version: string): Promise<{ status: string; error: string | null } | null> {
  const r = await pool.query<{ status: string; error: string | null }>(`SELECT status, error FROM analysis_job WHERE key = $1`, [`snapshot:${entity.key}@${version}`]);
  return r.rows[0] ?? null;
}

export async function queuePosition(entity: Pick<EntityRow, 'key'>, version: string): Promise<number | null> {
  const r = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM analysis_job j, (SELECT priority, created_at FROM analysis_job WHERE key = $1) me
     WHERE j.status = 'queued' AND (j.priority, j.created_at) < (me.priority, me.created_at)`,
    [`snapshot:${entity.key}@${version}`],
  );
  return r.rows[0]?.n ?? null;
}

/** Bucle de análisis del worker: de a un trabajo por vez (es intensivo en CPU y memoria). */
export async function runNextJob(): Promise<boolean> {
  const r = await pool.query<{ key: string; payload: { entityId: number; version: string }; attempts: number }>(
    `UPDATE analysis_job SET status = 'running', attempts = attempts + 1, updated_at = now()
     WHERE key = (SELECT key FROM analysis_job WHERE status = 'queued' ORDER BY priority, created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING key, payload, attempts`,
  );
  const job = r.rows[0];
  if (!job) return false;
  try {
    const e = await pool.query<EntityRow>(`SELECT * FROM entity WHERE id = $1`, [job.payload.entityId]);
    if (!e.rows[0]) throw new Error('entidad inexistente');
    const status = await computeSnapshot(e.rows[0], job.payload.version);
    await pool.query(`UPDATE analysis_job SET status = 'done', error = NULL, updated_at = now() WHERE key = $1`, [job.key]);
    console.log(`análisis ${job.key}: ${status}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const final = job.attempts >= 3;
    await pool.query(`UPDATE analysis_job SET status = $2, error = $3, updated_at = now() WHERE key = $1`, [job.key, final ? 'failed' : 'queued', msg.slice(0, 500)]);
    if (final) {
      await pool.query(
        `INSERT INTO api_snapshot (entity_id, version, status, error) VALUES ($1, $2, 'error', $3)
         ON CONFLICT (entity_id, version) DO UPDATE SET status = 'error', error = EXCLUDED.error, computed_at = now()`,
        [job.payload.entityId, job.payload.version, msg.slice(0, 500)],
      );
    }
    console.error(`análisis ${job.key} falló (intento ${job.attempts}): ${msg}`);
  }
  return true;
}

/** Al arrancar: los trabajos que quedaron "running" por un reinicio vuelven a la cola. */
export async function recoverJobs(): Promise<void> {
  await pool.query(`UPDATE analysis_job SET status = 'queued' WHERE status = 'running'`);
}

/** Pregeneración: para los paquetes npm más populares, foto de la última estable y de la última de la mayor anterior. */
export async function scheduleTopUpgrades(limit = 300): Promise<number> {
  const r = await pool.query<{ id: number; key: string; ecosystem: string; latest: string | null }>(
    `SELECT e.id, e.key, e.ecosystem, f.value->>'version' AS latest FROM entity e
     JOIN fact f ON f.entity_id = e.id AND f.predicate = 'latest_version' AND f.recorded_to IS NULL
     WHERE e.type = 'package' AND e.ecosystem = 'npm' AND e.tracked AND e.popularity_rank <= $1
     ORDER BY e.popularity_rank`,
    [limit],
  );
  let n = 0;
  for (const e of r.rows) {
    if (!e.latest || !semver.valid(e.latest)) continue;
    const prev = await pool.query<{ version: string }>(
      `SELECT version FROM package_version WHERE entity_id = $1 AND NOT prerelease AND NOT withdrawn`,
      [e.id],
    );
    const major = semver.major(e.latest);
    const candidates = prev.rows.map((x) => x.version).filter((v) => semver.valid(v) && semver.major(v) < major);
    const prevMajor = candidates.length ? semver.major(candidates.sort(semver.rcompare)[0]!) : null;
    const prevLatest = prevMajor === null ? null : candidates.filter((v) => semver.major(v) === prevMajor).sort(semver.rcompare)[0]!;
    for (const v of [e.latest, prevLatest]) {
      if (!v) continue;
      const exists = await pool.query(`SELECT 1 FROM api_snapshot WHERE entity_id = $1 AND version = $2`, [e.id, v]);
      if (exists.rowCount === 0) {
        await enqueueSnapshot(e, v, 200);
        n++;
      }
    }
  }
  return n;
}
