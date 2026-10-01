// Hilo aislado para el análisis de tipos: si un paquete enorme o malformado lo traba o agota memoria,
// el hilo se descarta sin afectar al worker principal.
import { parentPort, workerData } from 'node:worker_threads';
import { analyzeSurface } from './apisurface.js';

const { files, entries } = workerData as { files: Array<[string, string]>; entries: Array<[string, string]> };
try {
  parentPort!.postMessage({ ok: true, surface: analyzeSurface(new Map(files), entries) });
} catch (err) {
  parentPort!.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
}
