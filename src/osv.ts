import { pool } from './db.js';
import { config } from './config.js';
import { compareVersions } from './versions.js';
import type { Ecosystem } from './util.js';

const OSV = 'https://api.osv.dev/v1';
const CACHE_MS = 6 * 3600_000;
const osvEco = (eco: Ecosystem) => (eco === 'npm' ? 'npm' : eco === 'crates' ? 'crates.io' : 'PyPI');

export interface Vulnerability {
  id: string;
  aliases: string[];
  summary: string | null;
  severity: string | null;
  published: string | null;
  /** Versión que corrige esta vulnerabilidad para la versión consultada (null = sin corrección publicada). */
  fixed_in: string | null;
  url: string;
}

export interface VersionVulns {
  vulnerabilities: Vulnerability[];
  /** Menor versión que corrige todas las vulnerabilidades conocidas (si todas tienen corrección). */
  nearest_fixed_version: string | null;
  unfixed_count: number;
  source: string;
  fetched_at: string;
}

async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${OSV}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': config.userAgent },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`osv ${res.status}`);
  return res.json();
}

/** Busca, dentro de los rangos afectados, el "fixed" del tramo que contiene la versión consultada. */
function fixedFor(eco: Ecosystem, name: string, version: string, vuln: any): string | null {
  for (const aff of vuln.affected ?? []) {
    if (aff.package?.name?.toLowerCase() !== name.toLowerCase()) continue;
    for (const range of aff.ranges ?? []) {
      if (range.type !== 'SEMVER' && range.type !== 'ECOSYSTEM') continue;
      let introduced: string | null = null;
      for (const ev of range.events ?? []) {
        if (ev.introduced !== undefined) introduced = ev.introduced;
        if (ev.fixed !== undefined && introduced !== null) {
          const afterIntro = introduced === '0' || (compareVersions(eco, version, introduced) ?? -1) >= 0;
          const beforeFix = (compareVersions(eco, version, ev.fixed) ?? 1) < 0;
          if (afterIntro && beforeFix) return ev.fixed;
          introduced = null;
        }
      }
    }
  }
  return null;
}

function severityOf(v: any): string | null {
  const s = v.database_specific?.severity;
  return typeof s === 'string' ? s.toUpperCase() : null;
}

/** Vulnerabilidades conocidas de una versión exacta, con caché. */
export async function vulnsForVersion(eco: Ecosystem, name: string, version: string): Promise<VersionVulns> {
  const key = `${eco}:${name}@${version}`;
  const cached = await pool.query<{ v: VersionVulns; fetched_at: Date }>(`SELECT v, fetched_at FROM osv_cache WHERE k = $1`, [key]);
  if (cached.rows[0] && Date.now() - cached.rows[0].fetched_at.getTime() < CACHE_MS) return cached.rows[0].v;

  const data = await post('/query', { version, package: { name, ecosystem: osvEco(eco) } });
  const vulnerabilities: Vulnerability[] = (data.vulns ?? []).map((v: any) => ({
    id: String(v.id),
    aliases: Array.isArray(v.aliases) ? v.aliases.slice(0, 10) : [],
    summary: typeof v.summary === 'string' ? v.summary.slice(0, 300) : null,
    severity: severityOf(v),
    published: v.published ?? null,
    fixed_in: fixedFor(eco, name, version, v),
    url: `https://osv.dev/vulnerability/${encodeURIComponent(v.id)}`,
  }));
  const fixes = vulnerabilities.map((v) => v.fixed_in);
  const unfixed = fixes.filter((f) => f === null).length;
  let nearest: string | null = null;
  if (vulnerabilities.length > 0 && unfixed === 0) {
    for (const f of fixes as string[]) if (!nearest || (compareVersions(eco, f, nearest) ?? 0) > 0) nearest = f;
  }
  const result: VersionVulns = {
    vulnerabilities,
    nearest_fixed_version: nearest,
    unfixed_count: unfixed,
    source: 'https://osv.dev',
    fetched_at: new Date().toISOString(),
  };
  await pool.query(
    `INSERT INTO osv_cache (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, fetched_at = now()`,
    [key, JSON.stringify(result)],
  );
  return result;
}

/** Consulta en lote (sólo IDs): usada por /v1/check para las versiones mínimas de cada rango. */
export async function vulnIdsBatch(eco: Ecosystem, items: Array<{ name: string; version: string }>): Promise<string[][]> {
  if (items.length === 0) return [];
  const data = await post('/querybatch', { queries: items.map((i) => ({ version: i.version, package: { name: i.name, ecosystem: osvEco(eco) } })) });
  return (data.results ?? []).map((r: any) => (r.vulns ?? []).map((v: any) => String(v.id)));
}
