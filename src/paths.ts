export type PackageSuffix = '' | 'history' | 'versions' | 'version' | 'upgrade' | 'compatible' | 'symbol';

/**
 * Separa "/v1/packages/npm/@scope/name/versions/1.2.3" en ecosistema, nombre, sufijo y argumento.
 * Un segmento sólo cuenta como sufijo si lo que queda antes sigue siendo un nombre completo
 * (existen paquetes npm llamados literalmente "history", "versions" o "upgrade").
 */
export function splitPackagePath(rest: string): { eco: string; name: string; suffix: PackageSuffix; version?: string; symbol?: string } {
  const parts = rest.split('/').filter(Boolean).map(decodeURIComponent);
  const eco = parts.shift() ?? '';
  const complete = (p: string[]) => p.length > 0 && !(p.length === 1 && p[0]!.startsWith('@'));
  const last = parts.at(-1);
  if ((last === 'history' || last === 'versions' || last === 'upgrade' || last === 'compatible') && complete(parts.slice(0, -1))) {
    return { eco, name: parts.slice(0, -1).join('/'), suffix: last };
  }
  if (parts.at(-2) === 'versions' && complete(parts.slice(0, -2))) {
    return { eco, name: parts.slice(0, -2).join('/'), suffix: 'version', version: last };
  }
  if (parts.at(-2) === 'symbols' && complete(parts.slice(0, -2))) {
    return { eco, name: parts.slice(0, -2).join('/'), suffix: 'symbol', symbol: last };
  }
  return { eco, name: parts.join('/'), suffix: '' };
}
