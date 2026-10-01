// Prueba manual del analizador: tsx scripts/try-surface.ts <paquete> <versión> [símbolo]
import { extractTgz, fetchBuffer } from '../src/tarball.js';
import { analyzeSurface, typesEntries } from '../src/apisurface.js';

const [name, version, symbol] = process.argv.slice(2);
const meta = await (await fetch(`https://registry.npmjs.org/${name!.replace('/', '%2f')}/${version}`)).json();
const t0 = Date.now();
const files = extractTgz(await fetchBuffer(meta.dist.tarball));
const entries = typesEntries(files);
console.log(`${name}@${version}: ${files.size} archivos, módulos=${entries.map(([m]) => m).join(' ')} (${Date.now() - t0} ms)`);
if (!entries.length) process.exit(0);
const t1 = Date.now();
const s = analyzeSurface(files, entries);
const counts = Object.entries(s.modules).map(([m, e]) => `${m}:${Object.keys(e).length}`);
console.log(`exports por módulo: ${counts.join(' ')} · truncado=${s.truncated} · ${Date.now() - t1} ms · ${Math.round(process.memoryUsage().rss / 1e6)} MB`);
if (symbol) for (const [m, e] of Object.entries(s.modules)) if (e[symbol]) console.log(m, symbol, JSON.stringify(e[symbol]).slice(0, 400));
