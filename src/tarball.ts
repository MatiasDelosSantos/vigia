import { gunzipSync } from 'node:zlib';
import { config } from './config.js';

const MAX_COMPRESSED = 40 * 1024 * 1024; // 40 MB
const MAX_EXTRACTED = 60 * 1024 * 1024; // sólo cuenta lo que extraemos (tipos + changelog)

export class TooLargeError extends Error {}

export async function fetchBuffer(url: string, max = MAX_COMPRESSED): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'user-agent': config.userAgent }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`descarga ${res.status}: ${url}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > max) throw new TooLargeError(`tarball de ${len} bytes`);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > max) throw new TooLargeError(`tarball supera ${max} bytes`);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** ¿Nos interesa este archivo? Tipos TypeScript, package.json y changelogs (nunca se ejecuta nada). */
export function wanted(path: string): boolean {
  const p = path.toLowerCase();
  return (
    p.endsWith('.d.ts') ||
    p.endsWith('.d.mts') ||
    p.endsWith('.d.cts') ||
    p === 'package.json' ||
    /^(changelog|changes|history|releases?)(\.md|\.markdown|\.txt)?$/.test(p)
  );
}

const readStr = (b: Buffer, off: number, len: number) => {
  const s = b.subarray(off, off + len);
  const z = s.indexOf(0);
  return (z === -1 ? s : s.subarray(0, z)).toString('utf8');
};

/**
 * Extrae un .tgz de npm a un mapa ruta → texto. Quita el primer segmento ("package/").
 * Soporta ustar, nombres largos GNU (L) y encabezados PAX (x) con "path=".
 */
export function extractTgz(tgz: Buffer, filter: (path: string) => boolean = wanted): Map<string, string> {
  const tar = gunzipSync(tgz, { maxOutputLength: 400 * 1024 * 1024 });
  const files = new Map<string, string>();
  let off = 0;
  let longName: string | null = null;
  let extracted = 0;
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512);
    if (header.every((x) => x === 0)) break;
    const size = parseInt(readStr(header, 124, 12).trim() || '0', 8) || 0;
    const type = String.fromCharCode(header[156] || 48);
    const prefix = readStr(header, 345, 155);
    let name = readStr(header, 0, 100);
    if (prefix) name = `${prefix}/${name}`;
    const dataStart = off + 512;
    const data = tar.subarray(dataStart, dataStart + size);
    off = dataStart + Math.ceil(size / 512) * 512;

    if (type === 'L') {
      longName = readStr(data, 0, data.length);
      continue;
    }
    if (type === 'x' || type === 'g') {
      const m = /\d+ path=([^\n]+)\n/.exec(data.toString('utf8'));
      if (m && type === 'x') longName = m[1]!;
      continue;
    }
    if (longName) {
      name = longName;
      longName = null;
    }
    if (type !== '0' && type !== '\0' && type !== '7') continue; // sólo archivos regulares
    const rel = name.replace(/^\.?\/?[^/]+\//, ''); // "package/lib/x.d.ts" → "lib/x.d.ts"
    if (!rel || rel.includes('..') || !filter(rel)) continue;
    extracted += size;
    if (extracted > MAX_EXTRACTED) throw new TooLargeError('contenido de tipos demasiado grande');
    files.set(rel, data.toString('utf8'));
  }
  return files;
}
