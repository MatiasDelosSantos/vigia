import { esc } from './pages.js';

// Ancho aproximado de caracteres en Verdana 11px (mismo criterio que shields.io, simplificado).
const NARROW = new Set([...'ijlrtf.,:;!|\'()[]1 ']);
const WIDE = new Set([...'mwMW@%']);
function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += NARROW.has(ch) ? 3.9 : WIDE.has(ch) ? 10 : /[A-Z0-9]/.test(ch) ? 7.4 : 6.6;
  return Math.ceil(w);
}

export const BADGE_COLORS = {
  blue: '#1f5f8b',
  green: '#2e7d4f',
  yellow: '#a15c00',
  red: '#b3261e',
  grey: '#6b675f',
} as const;

/** Badge "flat" de dos segmentos: etiqueta gris + valor coloreado, con título accesible. */
export function badgeSvg(label: string, value: string, color: string): string {
  const lw = textWidth(label) + 12;
  const vw = textWidth(value) + 12;
  const w = lw + vw;
  const title = `${label}: ${value}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/><rect width="${w}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${esc(label)}</text><text x="${lw / 2}" y="14">${esc(label)}</text>
<text x="${lw + vw / 2}" y="15" fill="#010101" fill-opacity=".3">${esc(value)}</text><text x="${lw + vw / 2}" y="14">${esc(value)}</text></g></svg>`;
}

export type BadgeType = 'version' | 'maintained' | 'status';
export const BADGE_TYPES: BadgeType[] = ['version', 'maintained', 'status'];

export function badgeFor(type: BadgeType, eco: string, data: any): { label: string; value: string; color: string } {
  if (type === 'version') {
    const v = data.latest?.version;
    return { label: eco, value: v ? `v${v}` : 'unknown', color: v ? BADGE_COLORS.blue : BADGE_COLORS.grey };
  }
  if (type === 'maintained') {
    const a = data.maintenance?.activity ?? 'unknown';
    const color = a === 'active' ? BADGE_COLORS.green : a === 'slowing' ? BADGE_COLORS.yellow : a === 'dormant' ? BADGE_COLORS.red : BADGE_COLORS.grey;
    return { label: 'maintained', value: a === 'slowing' ? 'slowing down' : a, color };
  }
  const s = data.status ?? 'unknown';
  const color = s === 'active' ? BADGE_COLORS.green : s === 'deprecated' ? BADGE_COLORS.yellow : BADGE_COLORS.red;
  return { label: 'status', value: s === 'not_found_in_registry' ? 'not found' : s, color };
}
