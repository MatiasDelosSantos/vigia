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
import { en2, type Message2Key, type Messages2 } from './extra/en.js';
import { es2 } from './extra/es.js';
import { pt2 } from './extra/pt.js';
import { fr2 } from './extra/fr.js';
import { de2 } from './extra/de.js';
import { it2 } from './extra/it.js';
import { nl2 } from './extra/nl.js';
import { pl2 } from './extra/pl.js';
import { ru2 } from './extra/ru.js';
import { uk2 } from './extra/uk.js';
import { tr2 } from './extra/tr.js';
import { ar2 } from './extra/ar.js';
import { hi2 } from './extra/hi.js';
import { id2 } from './extra/id.js';
import { vi2 } from './extra/vi.js';
import { ja2 } from './extra/ja.js';
import { ko2 } from './extra/ko.js';
import { zh2 } from './extra/zh.js';
import { en3, type Message3Key, type Messages3 } from './tools/en.js';
import { es3 } from './tools/es.js';
import { pt3 } from './tools/pt.js';
import { fr3 } from './tools/fr.js';
import { de3 } from './tools/de.js';
import { it3 } from './tools/it.js';
import { nl3 } from './tools/nl.js';
import { pl3 } from './tools/pl.js';
import { ru3 } from './tools/ru.js';
import { uk3 } from './tools/uk.js';
import { tr3 } from './tools/tr.js';
import { ar3 } from './tools/ar.js';
import { hi3 } from './tools/hi.js';
import { id3 } from './tools/id.js';
import { vi3 } from './tools/vi.js';
import { ja3 } from './tools/ja.js';
import { ko3 } from './tools/ko.js';
import { zh3 } from './tools/zh.js';
import { en4, type Message4Key, type Messages4 } from './upgrade/en.js';
import { es4 } from './upgrade/es.js';
import { pt4 } from './upgrade/pt.js';
import { fr4 } from './upgrade/fr.js';
import { de4 } from './upgrade/de.js';
import { it4 } from './upgrade/it.js';
import { nl4 } from './upgrade/nl.js';
import { pl4 } from './upgrade/pl.js';
import { ru4 } from './upgrade/ru.js';
import { uk4 } from './upgrade/uk.js';
import { tr4 } from './upgrade/tr.js';
import { ar4 } from './upgrade/ar.js';
import { hi4 } from './upgrade/hi.js';
import { id4 } from './upgrade/id.js';
import { vi4 } from './upgrade/vi.js';
import { ja4 } from './upgrade/ja.js';
import { ko4 } from './upgrade/ko.js';
import { zh4 } from './upgrade/zh.js';
import { en5, type Message5Key, type Messages5 } from './growth/en.js';
import { es5 } from './growth/es.js';
import { pt5 } from './growth/pt.js';
import { fr5 } from './growth/fr.js';
import { de5 } from './growth/de.js';
import { it5 } from './growth/it.js';
import { nl5 } from './growth/nl.js';
import { pl5 } from './growth/pl.js';
import { ru5 } from './growth/ru.js';
import { uk5 } from './growth/uk.js';
import { tr5 } from './growth/tr.js';
import { ar5 } from './growth/ar.js';
import { hi5 } from './growth/hi.js';
import { id5 } from './growth/id.js';
import { vi5 } from './growth/vi.js';
import { ja5 } from './growth/ja.js';
import { ko5 } from './growth/ko.js';
import { zh5 } from './growth/zh.js';

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
  m: Messages & Messages2 & Messages3 & Messages4 & Messages5;
}

const defs: Array<[code: string, lang: string, name: string, m: Messages & Messages2 & Messages3 & Messages4 & Messages5, dir?: 'rtl']> = [
  ['en', 'en', 'English', { ...en, ...en2, ...en3, ...en4, ...en5 }],
  ['es', 'es', 'Español', { ...es, ...es2, ...es3, ...es4, ...es5 }],
  ['pt', 'pt', 'Português', { ...pt, ...pt2, ...pt3, ...pt4, ...pt5 }],
  ['fr', 'fr', 'Français', { ...fr, ...fr2, ...fr3, ...fr4, ...fr5 }],
  ['de', 'de', 'Deutsch', { ...de, ...de2, ...de3, ...de4, ...de5 }],
  ['it', 'it', 'Italiano', { ...it, ...it2, ...it3, ...it4, ...it5 }],
  ['nl', 'nl', 'Nederlands', { ...nl, ...nl2, ...nl3, ...nl4, ...nl5 }],
  ['pl', 'pl', 'Polski', { ...pl, ...pl2, ...pl3, ...pl4, ...pl5 }],
  ['ru', 'ru', 'Русский', { ...ru, ...ru2, ...ru3, ...ru4, ...ru5 }],
  ['uk', 'uk', 'Українська', { ...uk, ...uk2, ...uk3, ...uk4, ...uk5 }],
  ['tr', 'tr', 'Türkçe', { ...tr, ...tr2, ...tr3, ...tr4, ...tr5 }],
  ['ar', 'ar', 'العربية', { ...ar, ...ar2, ...ar3, ...ar4, ...ar5 }, 'rtl'],
  ['hi', 'hi', 'हिन्दी', { ...hi, ...hi2, ...hi3, ...hi4, ...hi5 }],
  ['id', 'id', 'Bahasa Indonesia', { ...id, ...id2, ...id3, ...id4, ...id5 }],
  ['vi', 'vi', 'Tiếng Việt', { ...vi, ...vi2, ...vi3, ...vi4, ...vi5 }],
  ['ja', 'ja', '日本語', { ...ja, ...ja2, ...ja3, ...ja4, ...ja5 }],
  ['ko', 'ko', '한국어', { ...ko, ...ko2, ...ko3, ...ko4, ...ko5 }],
  ['zh', 'zh-Hans', '简体中文', { ...zh, ...zh2, ...zh3, ...zh4, ...zh5 }],
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
export function t(L: Locale, key: AnyKey, vars: Record<string, string | number> = {}): string {
  const base: Record<string, string> = { ...en, ...en2, ...en3, ...en4, ...en5 };
  const s = (L.m as Record<string, string>)[key] ?? base[key] ?? String(key);
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export type AnyKey = MessageKey | Message2Key | Message3Key | Message4Key | Message5Key;
export type { MessageKey, Message2Key };
