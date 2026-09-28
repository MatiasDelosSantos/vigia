import { en, type MessageKey, type Messages } from './en.js';
import { es } from './es.js';
import { pt } from './pt.js';
import { fr } from './fr.js';
import { de } from './de.js';
import { it } from './it.js';
import { nl } from './nl.js';
import { pl } from './pl.js';
import { ru } from './ru.js';
import { uk } from './uk.js';
import { tr } from './tr.js';
import { ar } from './ar.js';
import { hi } from './hi.js';
import { id } from './id.js';
import { vi } from './vi.js';
import { ja } from './ja.js';
import { ko } from './ko.js';
import { zh } from './zh.js';

export interface Locale {
  /** Segmento de URL ('' para inglés, que vive en la raíz y es el canónico x-default). */
  code: string;
  /** Código BCP 47 para <html lang> y hreflang. */
  lang: string;
  /** Nombre del idioma en su propio idioma, para el selector. */
  name: string;
  dir: 'ltr' | 'rtl';
  /** Prefijo de ruta: '' o '/es'. */
  prefix: string;
  m: Messages;
}

const defs: Array<[code: string, lang: string, name: string, m: Messages, dir?: 'rtl']> = [
  ['en', 'en', 'English', en],
  ['es', 'es', 'Español', es],
  ['pt', 'pt', 'Português', pt],
  ['fr', 'fr', 'Français', fr],
  ['de', 'de', 'Deutsch', de],
  ['it', 'it', 'Italiano', it],
  ['nl', 'nl', 'Nederlands', nl],
  ['pl', 'pl', 'Polski', pl],
  ['ru', 'ru', 'Русский', ru],
  ['uk', 'uk', 'Українська', uk],
  ['tr', 'tr', 'Türkçe', tr],
  ['ar', 'ar', 'العربية', ar, 'rtl'],
  ['hi', 'hi', 'हिन्दी', hi],
  ['id', 'id', 'Bahasa Indonesia', id],
  ['vi', 'vi', 'Tiếng Việt', vi],
  ['ja', 'ja', '日本語', ja],
  ['ko', 'ko', '한국어', ko],
  ['zh', 'zh-Hans', '简体中文', zh],
];

export const LOCALES: Locale[] = defs.map(([code, lang, name, m, dir]) => ({
  code,
  lang,
  name,
  dir: dir ?? 'ltr',
  prefix: code === 'en' ? '' : `/${code}`,
  m,
}));

export const DEFAULT_LOCALE = LOCALES[0]!;

/** Traduce una clave e interpola {variables}. Los valores NO se escapan: escapar al insertar en HTML. */
export function t(L: Locale, key: MessageKey, vars: Record<string, string | number> = {}): string {
  const s = L.m[key] ?? en[key] ?? String(key);
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export type { MessageKey };
