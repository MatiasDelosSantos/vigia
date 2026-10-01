import semver from 'semver';
import * as pep440 from '@renovatebot/pep440';
import type { Queryable } from './db.js';
import type { Ecosystem } from './util.js';

export interface VersionRow {
  version: string;
  published_at: string | null;
  prerelease: boolean;
  withdrawn: boolean;
  // Requisitos declarados por esa versión (undefined = no los conocemos; no pisa lo ya guardado).
  engines?: Record<string, string> | null;
  peer?: Record<string, string> | null;
  requires_python?: string | null;
  deprecated_msg?: string | null;
}

export function isPrerelease(eco: Ecosystem, v: string): boolean {
  if (eco === 'npm') return (semver.prerelease(v)?.length ?? 0) > 0;
  const x = pep440.explain(v);
  return x ? x.is_prerelease || x.is_devrelease : false;
}

/** Orden de versiones del ecosistema (null si alguna no es parseable). */
export function compareVersions(eco: Ecosystem, a: string, b: string): number | null {
  if (eco === 'npm') return semver.valid(a) && semver.valid(b) ? semver.compare(a, b) : null;
  return pep440.valid(a) && pep440.valid(b) ? pep440.compare(a, b) : null;
}

export function majorOf(eco: Ecosystem, v: string): number | null {
  if (eco === 'npm') return semver.valid(v) ? semver.major(v) : null;
  return pep440.valid(v) ? pep440.major(v) : null;
}

/** Reemplaza el historial de versiones de una entidad (upsert; las versiones nunca se borran). */
export async function upsertVersions(db: Queryable, entityId: number, rows: VersionRow[]): Promise<void> {
  if (rows.length === 0) return;
  const CHUNK = 2000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    // Las versiones publicadas son inmutables: si una fila no trae requisitos, se conservan los ya guardados.
    await db.query(
      `INSERT INTO package_version (entity_id, version, published_at, prerelease, withdrawn, engines, peer, requires_python, deprecated_msg)
       SELECT $1, v, p, pr, w, e::jsonb, pe::jsonb, rp, dm
       FROM unnest($2::text[], $3::timestamptz[], $4::bool[], $5::bool[], $6::text[], $7::text[], $8::text[], $9::text[]) AS t(v, p, pr, w, e, pe, rp, dm)
       ON CONFLICT (entity_id, version) DO UPDATE SET published_at = COALESCE(EXCLUDED.published_at, package_version.published_at),
         prerelease = EXCLUDED.prerelease, withdrawn = EXCLUDED.withdrawn,
         engines = COALESCE(EXCLUDED.engines, package_version.engines),
         peer = COALESCE(EXCLUDED.peer, package_version.peer),
         requires_python = COALESCE(EXCLUDED.requires_python, package_version.requires_python),
         deprecated_msg = COALESCE(EXCLUDED.deprecated_msg, package_version.deprecated_msg)`,
      [
        entityId,
        part.map((r) => r.version),
        part.map((r) => r.published_at),
        part.map((r) => r.prerelease),
        part.map((r) => r.withdrawn),
        part.map((r) => (r.engines ? JSON.stringify(r.engines) : null)),
        part.map((r) => (r.peer ? JSON.stringify(r.peer) : null)),
        part.map((r) => r.requires_python ?? null),
        part.map((r) => r.deprecated_msg ?? null),
      ],
    );
  }
}

export async function versionCount(db: Queryable, entityId: number): Promise<number> {
  const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM package_version WHERE entity_id = $1`, [entityId]);
  return r.rows[0]?.n ?? 0;
}

export async function recentVersions(db: Queryable, entityId: number, limit: number, stableOnly = false) {
  const r = await db.query<{ version: string; published_at: Date | null; prerelease: boolean; withdrawn: boolean }>(
    `SELECT version, published_at, prerelease, withdrawn FROM package_version WHERE entity_id = $1 AND (NOT $3 OR NOT prerelease)
     ORDER BY published_at DESC NULLS LAST, version DESC LIMIT $2`,
    [entityId, limit, stableOnly],
  );
  return r.rows;
}

export type Activity = 'active' | 'slowing' | 'dormant' | 'unknown';

export interface Maintenance {
  last_release_at: string | null;
  days_since_last_release: number | null;
  releases_last_12m: number;
  stable_versions: number;
  total_versions: number;
  activity: Activity;
  method: string;
}

/**
 * Heurística de mantenimiento basada sólo en fechas de publicación de versiones estables:
 * active ≤ 180 días desde la última, slowing ≤ 540, dormant > 540. No mide respuesta a issues ni a vulnerabilidades.
 */
export async function maintenanceOf(db: Queryable, entityId: number): Promise<Maintenance> {
  const r = await db.query<{ last: Date | null; n12: number; stable: number; total: number }>(
    `SELECT max(published_at) FILTER (WHERE NOT prerelease) AS last,
            count(*) FILTER (WHERE NOT prerelease AND published_at > now() - interval '365 days')::int AS n12,
            count(*) FILTER (WHERE NOT prerelease)::int AS stable,
            count(*)::int AS total
     FROM package_version WHERE entity_id = $1`,
    [entityId],
  );
  const row = r.rows[0]!;
  const days = row.last ? Math.floor((Date.now() - row.last.getTime()) / 86_400_000) : null;
  const activity: Activity = days === null ? 'unknown' : days <= 180 ? 'active' : days <= 540 ? 'slowing' : 'dormant';
  return {
    last_release_at: row.last ? row.last.toISOString() : null,
    days_since_last_release: days,
    releases_last_12m: row.n12,
    stable_versions: row.stable,
    total_versions: row.total,
    activity: row.total === 0 ? 'unknown' : activity,
    method: 'heuristic: days since last stable release (active ≤180, slowing ≤540, dormant >540)',
  };
}
