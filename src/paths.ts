/**
 * Separa "/v1/packages/npm/@scope/name/versions/1.2.3" en ecosistema, nombre, sufijo y versión.
 * Un segmento sólo cuenta como sufijo si lo que queda antes sigue siendo un nombre completo
 * (existen paquetes npm llamados literalmente "history" o "versions").
 */
export function splitPackagePath(rest: string): { eco: string; name: string; suffix: '' | 'history' | 'versions' | 'version'; version?: string } {
  const parts = rest.split('/').filter(Boolean).map(decodeURIComponent);
  const eco = parts.shift() ?? '';
  const complete = (p: string[]) => p.length > 0 && !(p.length === 1 && p[0]!.startsWith('@'));
  const last = parts.at(-1);
  if ((last === 'history' || last === 'versions') && complete(parts.slice(0, -1))) {
    return { eco, name: parts.slice(0, -1).join('/'), suffix: last };
  }
  if (parts.at(-2) === 'versions' && complete(parts.slice(0, -2))) {
    return { eco, name: parts.slice(0, -2).join('/'), suffix: 'version', version: last };
  }
  return { eco, name: parts.join('/'), suffix: '' };
}
