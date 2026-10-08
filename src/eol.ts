import { pool } from './db.js';
import { factsOf, type EntityRow } from './facts.js';
import { DATA_LICENSE } from './service.js';
import type { EolCycle } from './connectors/eol.js';

export type CycleStatus = 'upcoming' | 'supported' | 'security_only' | 'end_of_life';

export const STATUS_TEXT: Record<CycleStatus, string> = {
  upcoming: 'Not released yet',
  supported: 'Supported',
  security_only: 'Security fixes only',
  end_of_life: 'End of life',
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** Estado a una fecha dada (por defecto hoy): lo calculamos al leer, así nunca queda desactualizado. */
export function cycleStatus(c: EolCycle, today = todayIso()): CycleStatus {
  if (c.release_date && c.release_date > today) return 'upcoming';
  if (c.eol_from ? c.eol_from <= today : c.eol_flag) return 'end_of_life';
  if (c.support_until && c.support_until <= today) return 'security_only';
  return 'supported';
}

export function decorate(c: EolCycle, today = todayIso()) {
  const status = cycleStatus(c, today);
  return {
    ...c,
    status,
    status_text: STATUS_TEXT[status],
    days_until_eol: c.eol_from && status !== 'end_of_life' ? daysBetween(today, c.eol_from) : null,
    days_since_eol: c.eol_from && status === 'end_of_life' ? daysBetween(c.eol_from, today) : null,
  };
}
export type DecoratedCycle = ReturnType<typeof decorate>;

/**
 * Encuentra el ciclo de una versión: "3.9.7" → ciclo "3.9"; "18.17.1" → "18"; "22.04.3" → "22.04".
 * Gana el ciclo más específico (el de nombre más largo) que sea prefijo de la versión.
 */
export function matchCycle<T extends { cycle: string }>(cycles: T[], version: string): T | null {
  const v = version.trim().replace(/^v/i, '').toLowerCase();
  const exact = cycles.find((c) => c.cycle.toLowerCase() === v);
  if (exact) return exact;
  let best: T | null = null;
  for (const c of cycles) {
    const name = c.cycle.toLowerCase();
    if ((v.startsWith(name + '.') || v.startsWith(name + '-')) && (!best || name.length > best.cycle.length)) best = c;
  }
  return best;
}

export interface ProductSummary {
  product: string;
  label: string;
  category: string | null;
  tags: string[];
  aliases: string[];
}

export async function listProducts(category?: string): Promise<ProductSummary[]> {
  const r = await pool.query<{ name: string; attrs: any }>(
    `SELECT e.name, e.attrs FROM entity e
     JOIN fact f ON f.entity_id = e.id AND f.predicate = 'exists' AND f.recorded_to IS NULL AND f.value = 'true'::jsonb
     WHERE e.ecosystem = 'eol' AND ($1::text IS NULL OR e.attrs->>'category' = $1) ORDER BY e.name`,
    [category ?? null],
  );
  return r.rows.map((x) => ({ product: x.name, label: x.attrs?.display_name ?? x.name, category: x.attrs?.category ?? null, tags: x.attrs?.tags ?? [], aliases: x.attrs?.aliases ?? [] }));
}

/** Producto por su identificador (python, nodejs) o por un alias (node, adonis). */
export async function findProduct(slug: string): Promise<EntityRow | null> {
  const s = slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,80}$/.test(s)) return null;
  const r = await pool.query<EntityRow>(
    `SELECT * FROM entity WHERE ecosystem = 'eol' AND (name = $1 OR jsonb_exists(attrs->'aliases', $1)) ORDER BY (name = $1) DESC LIMIT 1`,
    [s],
  );
  return r.rows[0] ?? null;
}

export async function productView(entity: EntityRow) {
  const f = await factsOf(pool, entity.id);
  const cycles: EolCycle[] = f.get('eol_cycles')?.value ?? [];
  const today = todayIso();
  const decorated = cycles.map((c) => decorate(c, today));
  const supported = decorated.filter((c) => c.status === 'supported' || c.status === 'security_only');
  return {
    data: {
      product: entity.name,
      label: entity.attrs?.display_name ?? entity.name,
      category: entity.attrs?.category ?? null,
      aliases: entity.attrs?.aliases ?? [],
      release_policy: entity.attrs?.release_policy ?? null,
      page: `https://vigia.coredls.cloud/eol/${entity.name}`,
      newest_cycle: decorated[0]?.cycle ?? null,
      supported_cycles: supported.map((c) => c.cycle),
      cycles: decorated,
    },
    meta: {
      as_of: new Date().toISOString(),
      last_verified_at: f.get('eol_cycles')?.last_verified_at.toISOString() ?? null,
      source: `https://endoflife.date/${entity.name}`,
      note: 'Dates are published by the project (via endoflife.date). status is computed on every request from today\'s date; "security_only" means active support ended but security fixes continue until end of life.',
      license: DATA_LICENSE,
    },
  };
}

export async function cycleView(entity: EntityRow, version: string) {
  const view = await productView(entity);
  const c = matchCycle(view.data.cycles, version);
  if (!c) return null;
  const newer = view.data.cycles.filter((x) => x.status === 'supported').map((x) => x.cycle);
  return {
    data: {
      product: view.data.product,
      label: view.data.label,
      queried_version: version,
      cycle: c,
      recommendation:
        c.status === 'end_of_life'
          ? `Upgrade: ${view.data.label} ${c.cycle} no longer receives fixes. Supported cycles: ${view.data.supported_cycles.join(', ') || 'none listed'}.`
          : c.status === 'security_only'
            ? `${view.data.label} ${c.cycle} only receives security fixes${c.eol_from ? ` until ${c.eol_from}` : ''}; plan an upgrade to ${newer[0] ?? 'a newer cycle'}.`
            : null,
    },
    meta: view.meta,
  };
}
