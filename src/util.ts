import { createHash } from 'node:crypto';
import { config } from './config.js';

/** JSON con claves ordenadas: dos valores iguales producen siempre el mismo string (y el mismo hash). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export type Ecosystem = 'npm' | 'pypi' | 'crates' | 'packagist';

export function isEcosystem(v: string): v is Ecosystem {
  return v === 'npm' || v === 'pypi' || v === 'crates' || v === 'packagist';
}

/** PEP 503: minúsculas y cualquier secuencia de "-", "_" o "." se reduce a "-". */
export function normalizePypiName(name: string): string {
  return name.trim().toLowerCase().replace(/[-_.]+/g, '-');
}

const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const PYPI_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const CRATES_NAME = /^[a-z0-9][a-z0-9_-]*$/;
const PACKAGIST_NAME = /^[a-z0-9](?:[_.-]?[a-z0-9]+)*\/[a-z0-9](?:(?:[_.]|-{1,2})?[a-z0-9]+)*$/;

/** Devuelve el nombre canónico o null si no es un nombre válido del ecosistema. */
export function canonicalName(eco: Ecosystem, raw: string): string | null {
  const name = eco === 'pypi' ? normalizePypiName(raw) : raw.trim().toLowerCase();
  if (name.length === 0 || name.length > (eco === 'crates' ? 64 : 214)) return null;
  return (eco === 'npm' ? NPM_NAME : eco === 'crates' ? CRATES_NAME : eco === 'packagist' ? PACKAGIST_NAME : PYPI_NAME).test(name) ? name : null;
}

export function entityKey(eco: string, name: string): string {
  return `${eco}:${name}`;
}

// ---------------------------------------------------------------------------------------------
// HTTP saliente: timeout, User-Agent identificable y límite de concurrencia por host.

const inFlight = new Map<string, number>();
const waiters = new Map<string, Array<() => void>>();

async function acquire(host: string): Promise<void> {
  const limit = config.hostConcurrency[host] ?? 2;
  if ((inFlight.get(host) ?? 0) < limit) {
    inFlight.set(host, (inFlight.get(host) ?? 0) + 1);
    return;
  }
  await new Promise<void>((resolve) => {
    const q = waiters.get(host) ?? [];
    q.push(resolve);
    waiters.set(host, q);
  });
}

function release(host: string): void {
  const next = waiters.get(host)?.shift();
  if (next) next();
  else inFlight.set(host, (inFlight.get(host) ?? 1) - 1);
}

export interface FetchResult {
  status: number;
  body: string;
  etag: string | null;
}

const nextSlot = new Map<string, number>();

/** Separación mínima entre requests a un mismo host (crates.io pide como máximo 1 por segundo). */
async function pace(host: string): Promise<void> {
  const gap = config.hostGapMs[host];
  if (!gap) return;
  const at = Math.max(Date.now(), nextSlot.get(host) ?? 0);
  nextSlot.set(host, at + gap);
  if (at > Date.now()) await new Promise((r) => setTimeout(r, at - Date.now()));
}

export async function httpGet(url: string, opts: { etag?: string | null; accept?: string; timeoutMs?: number } = {}): Promise<FetchResult> {
  const host = new URL(url).host;
  await acquire(host);
  try {
    await pace(host);
    const headers: Record<string, string> = { 'user-agent': config.userAgent, accept: opts.accept ?? 'application/json' };
    if (opts.etag) headers['if-none-match'] = opts.etag;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000), redirect: 'follow' });
    const body = res.status === 304 ? '' : await res.text();
    return { status: res.status, body, etag: res.headers.get('etag') };
  } finally {
    release(host);
  }
}

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
