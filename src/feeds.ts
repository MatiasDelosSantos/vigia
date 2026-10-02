import semver from 'semver';
import { pool } from './db.js';
import { config } from './config.js';
import { enqueueSnapshot } from './analysis.js';
import type { EntityRow } from './facts.js';

const x = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

export interface FeedEntry {
  id: string;
  title: string;
  link: string;
  updated: string;
  summary: string;
}

/** Feed Atom 1.0 mínimo y válido. */
export function atom(opts: { id: string; title: string; subtitle: string; self: string; alternate: string; entries: FeedEntry[] }): string {
  const updated = opts.entries[0]?.updated ?? new Date().toISOString();
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<id>${x(opts.id)}</id><title>${x(opts.title)}</title><subtitle>${x(opts.subtitle)}</subtitle><updated>${x(updated)}</updated>
<link rel="self" type="application/atom+xml" href="${x(opts.self)}"/><link rel="alternate" type="text/html" href="${x(opts.alternate)}"/>
<author><name>Vigia</name><uri>${x(config.publicUrl)}</uri></author>
${opts.entries
  .map(
    (e) => `<entry><id>${x(e.id)}</id><title>${x(e.title)}</title><link rel="alternate" type="text/html" href="${x(e.link)}"/><updated>${x(e.updated)}</updated><summary>${x(e.summary)}</summary></entry>`,
  )
  .join('\n')}
</feed>`;
}

interface ChangeRow {
  seq: number;
  ecosystem: string;
  name: string;
  kind: string;
  old_value: any;
  new_value: any;
  detected_at: Date;
}

export async function recentChangeRows(days: number, kinds: string[], limit: number): Promise<ChangeRow[]> {
  const r = await pool.query<ChangeRow>(
    `SELECT c.seq, e.ecosystem, e.name, c.kind, c.old_value, c.new_value, c.detected_at
     FROM change_event c JOIN entity e ON e.id = c.entity_id
     WHERE c.detected_at > now() - make_interval(days => $1) AND c.kind = ANY($2)
     ORDER BY c.seq DESC LIMIT $3`,
    [days, kinds, limit],
  );
  return r.rows;
}

const isMajorJump = (eco: string, a?: string, b?: string) => {
  if (!a || !b) return false;
  if (eco === 'npm' || eco === 'pypi') {
    const ca = semver.coerce(a);
    const cb = semver.coerce(b);
    return Boolean(ca && cb && semver.major(cb) > semver.major(ca));
  }
  return false;
};

export function describeChange(r: ChangeRow): { title: string; link: string; summary: string } {
  const link = r.ecosystem === 'ai' ? `${config.publicUrl}/models/${r.name}` : `${config.publicUrl}/${r.ecosystem}/${r.name}`;
  const from = r.old_value?.version;
  const to = r.new_value?.version;
  switch (r.kind) {
    case 'released':
      return {
        title: `${r.name} ${to} released${isMajorJump(r.ecosystem, from, to) ? ' (new major version)' : ''}`,
        link,
        summary: `${r.ecosystem}: ${r.name} ${from ?? '?'} → ${to ?? '?'}.`,
      };
    case 'deprecated':
      return { title: `${r.name} was deprecated`, link, summary: `${r.ecosystem}: ${r.name} is now marked as deprecated in the registry.` };
    case 'retirement_announced':
      return { title: `AI model ${r.name} retirement announced`, link, summary: `Retirement date: ${r.new_value ?? '?'}.` };
    case 'price_changed':
      return { title: `AI model ${r.name} price changed`, link, summary: 'Pricing changed in the OpenRouter catalog.' };
    case 'removed':
      return { title: `${r.name} removed`, link, summary: `${r.name} is no longer available.` };
    default:
      return { title: `${r.name}: ${r.kind}`, link, summary: r.kind };
  }
}

/** Releases mayores de la semana (npm/PyPI), lo más interesante para personas y buscadores. */
export async function majorReleases(days = 7, limit = 100) {
  const rows = await recentChangeRows(days, ['released'], 5000);
  return rows.filter((r) => isMajorJump(r.ecosystem, r.old_value?.version, r.new_value?.version)).slice(0, limit);
}

/**
 * Detector de versiones mayores: cuando un paquete npm seguido publica una mayor nueva, encola el análisis de
 * la última versión de la mayor anterior y de la nueva → la guía de actualización aparece sola.
 */
export async function scheduleNewMajorGuides(): Promise<number> {
  const rows = (await majorReleases(2, 200)).filter((r) => r.ecosystem === 'npm');
  let n = 0;
  for (const r of rows) {
    const e = await pool.query<EntityRow>(`SELECT * FROM entity WHERE key = $1`, [`npm:${r.name}`]);
    const entity = e.rows[0];
    const to: string | undefined = r.new_value?.version;
    if (!entity || !to || !semver.valid(to)) continue;
    const prev = await pool.query<{ version: string }>(`SELECT version FROM package_version WHERE entity_id = $1 AND NOT prerelease AND NOT withdrawn`, [entity.id]);
    const older = prev.rows.map((p) => p.version).filter((v) => semver.valid(v) && semver.major(v) < semver.major(to)).sort(semver.rcompare);
    const from = older[0];
    for (const v of [from, to]) {
      if (!v) continue;
      const exists = await pool.query(`SELECT 1 FROM api_snapshot WHERE entity_id = $1 AND version = $2`, [entity.id, v]);
      if (exists.rowCount === 0) {
        await enqueueSnapshot(entity, v, 50);
        n++;
      }
    }
  }
  return n;
}
