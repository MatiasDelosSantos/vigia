import { Hono, type Context } from 'hono';
import { serve } from '@hono/node-server';
import { config } from './config.js';
import { pool } from './db.js';
import { getEntity } from './facts.js';
import { checkDependencies, parsePackageJson, parseRequirements, type Dependency } from './check.js';
import { changes, factByHash, listModels, modelView, packageHistory, packageView, recentChanges, resolvePackage, search, stats } from './service.js';
import { canonicalName, isEcosystem, type Ecosystem } from './util.js';
import { handleMcp } from './api/mcp.js';
import { migrate } from './migrate.js';
import { openapi } from './api/openapi.js';
import { docsMarkdown, esc, homeHtml, layout, listPage, llmsTxt, modelHtml, packageHtml, packageMarkdown } from './api/pages.js';

const app = new Hono();

// Cache en el proxy/CDN: los hechos cambian por evento, un TTL corto con stale-while-revalidate alcanza.
const CACHE_SHORT = 'public, max-age=60, stale-while-revalidate=600';
const CACHE_LONG = 'public, max-age=3600, stale-while-revalidate=86400';

app.use('*', async (c, next) => {
  const t0 = performance.now();
  await next();
  c.header('x-content-type-options', 'nosniff');
  if (c.req.path.startsWith('/v1/') || c.req.path === '/openapi.json') c.header('access-control-allow-origin', '*');
  const ua = c.req.header('user-agent') ?? '-';
  console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Math.round(performance.now() - t0)}ms "${ua.slice(0, 120)}"`);
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal_error', message: 'Error interno; reintentá en unos segundos.' }, 500);
});

function parseAsOf(c: Context): Date | undefined | 'invalid' {
  const raw = c.req.query('as_of');
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? 'invalid' : d;
}

/** Separa "/v1/packages/npm/@scope/name/history" en ecosistema, nombre y sufijo. */
function splitPackagePath(rest: string): { eco: string; name: string; suffix: string } {
  const parts = rest.split('/').filter(Boolean).map(decodeURIComponent);
  const eco = parts.shift() ?? '';
  let suffix = '';
  if (parts.at(-1) === 'history') suffix = parts.pop()!;
  return { eco, name: parts.join('/'), suffix };
}

async function notFound(c: Context, eco: Ecosystem, name: string) {
  // Prefijos cada vez más cortos hasta encontrar candidatos (paquetes seguidos, ordenados por popularidad).
  let suggestions: string[] = [];
  for (let len = Math.max(3, name.length - 2); len >= 3 && suggestions.length === 0; len = len > 6 ? Math.floor(len / 2) : len - 1) {
    suggestions = (await search(name.slice(0, len), eco, 5)).map((s) => s.name).filter((n) => n !== name);
  }
  return c.json({ error: 'not_found', message: `El paquete ${eco}:${name} no existe en el registry.`, did_you_mean: suggestions }, 404);
}

// ----------------------------------------------------------------------------------------- API REST

app.get('/v1/packages/*', async (c) => {
  const { eco, name: raw, suffix } = splitPackagePath(c.req.path.slice('/v1/packages/'.length));
  if (!isEcosystem(eco)) return c.json({ error: 'invalid_ecosystem', message: 'Ecosistemas soportados: npm, pypi' }, 400);
  const name = canonicalName(eco, raw);
  if (!name) return c.json({ error: 'invalid_name', message: `Nombre de paquete inválido para ${eco}.` }, 400);
  const asOf = parseAsOf(c);
  if (asOf === 'invalid') return c.json({ error: 'invalid_as_of', message: 'as_of debe ser una fecha ISO-8601.' }, 400);

  const entity = await resolvePackage(eco, name, !asOf);
  if (!entity) return c.json({ error: 'no_data', message: 'Vigía no tenía datos de este paquete en esa fecha.' }, 404);
  if (suffix === 'history') {
    c.header('cache-control', CACHE_SHORT);
    return c.json(await packageHistory(entity));
  }
  const view = await packageView(entity, asOf);
  if (view.data.status === 'not_found_in_registry' && !asOf) return notFound(c, eco, name);
  c.header('cache-control', asOf ? CACHE_LONG : CACHE_SHORT);
  return c.json(view);
});

app.post('/v1/check', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !isEcosystem(body.ecosystem)) return c.json({ error: 'invalid_body', message: 'Se requiere {"ecosystem":"npm"|"pypi", "manifest": "..."} o "dependencies".' }, 400);
  const eco: Ecosystem = body.ecosystem;
  let deps: Dependency[];
  try {
    if (typeof body.manifest === 'string') deps = eco === 'npm' ? parsePackageJson(body.manifest) : parseRequirements(body.manifest);
    else if (body.dependencies && typeof body.dependencies === 'object')
      deps = Object.entries(body.dependencies).filter(([, v]) => typeof v === 'string').map(([name, spec]) => ({ name, spec: spec as string }));
    else return c.json({ error: 'invalid_body', message: 'Falta "manifest" o "dependencies".' }, 400);
  } catch {
    return c.json({ error: 'invalid_manifest', message: 'No se pudo parsear el manifest.' }, 400);
  }
  return c.json(await checkDependencies(eco, deps));
});

app.get('/v1/models', async (c) => {
  c.header('cache-control', CACHE_SHORT);
  const data = await listModels({
    provider: c.req.query('provider'),
    q: c.req.query('q'),
    includeRemoved: c.req.query('include_removed') === 'true',
    limit: Math.min(Number(c.req.query('limit') ?? 500) || 500, 1000),
  });
  return c.json({ data, meta: { count: data.length, source: 'https://openrouter.ai/api/v1/models', as_of: new Date().toISOString() } });
});

app.get('/v1/models/*', async (c) => {
  const id = decodeURIComponent(c.req.path.slice('/v1/models/'.length));
  const asOf = parseAsOf(c);
  if (asOf === 'invalid') return c.json({ error: 'invalid_as_of' }, 400);
  const e = await getEntity(pool, `model:${id}`);
  if (!e) {
    const similar = await listModels({ q: id.split('/').pop(), limit: 10 });
    return c.json({ error: 'not_found', message: `No existe el modelo ${id} en el catálogo.`, did_you_mean: similar.map((m: any) => m.id) }, 404);
  }
  c.header('cache-control', CACHE_SHORT);
  return c.json(await modelView(e, asOf));
});

app.get('/v1/changes', async (c) => {
  c.header('cache-control', 'public, max-age=10');
  return c.json(
    await changes({
      since: Number(c.req.query('since') ?? 0) || 0,
      ecosystem: c.req.query('ecosystem'),
      kind: c.req.query('kind'),
      limit: Math.min(Number(c.req.query('limit') ?? 100) || 100, 500),
    }),
  );
});

app.get('/v1/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 1 || q.length > 100) return c.json({ error: 'invalid_query' }, 400);
  c.header('cache-control', CACHE_LONG);
  return c.json({ data: await search(q, c.req.query('ecosystem'), 20) });
});

app.get('/v1/facts/:hash', async (c) => {
  const f = await factByHash(c.req.param('hash'));
  if (!f) return c.json({ error: 'not_found' }, 404);
  c.header('cache-control', 'public, max-age=86400, immutable');
  return c.json({ data: f });
});

app.get('/v1/stats', async (c) => {
  c.header('cache-control', 'public, max-age=60');
  return c.json({ data: await stats() });
});

// ----------------------------------------------------------------------------------------- MCP

app.all('/mcp', async (c) => {
  if (c.req.method === 'GET') {
    // Sin sesiones ni streaming del lado del servidor: indicamos cómo conectarse.
    return c.json({ name: 'vigia', transport: 'streamable-http (stateless)', usage: `claude mcp add --transport http vigia ${config.publicUrl}/mcp` }, 405, { allow: 'POST' });
  }
  return handleMcp(c.req.raw);
});

// ----------------------------------------------------------------------------------------- descubrimiento y páginas

app.get('/openapi.json', (c) => {
  c.header('cache-control', CACHE_LONG);
  return c.json(openapi());
});

app.get('/llms.txt', (c) => c.text(llmsTxt(), 200, { 'cache-control': CACHE_LONG }));
app.get('/docs.md', (c) => c.text(docsMarkdown(), 200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': CACHE_LONG }));
app.get('/docs', (c) =>
  c.html(
    layout({
      title: 'Documentación — Vigía',
      description: 'Cómo usar la API REST y el servidor MCP de Vigía.',
      path: '/docs',
      mdPath: '/docs.md',
      body: `<pre style="white-space:pre-wrap">${esc(docsMarkdown())}</pre>`,
    }),
    200,
    { 'cache-control': CACHE_LONG },
  ),
);

app.get('/robots.txt', (c) =>
  c.text(
    // Abierto a buscadores y agentes, incluidos los crawlers de IA: queremos ser la fuente citada.
    `User-agent: *\nAllow: /\nDisallow: /mcp\n\nSitemap: ${config.publicUrl}/sitemap.xml\n`,
    200,
    { 'cache-control': CACHE_LONG },
  ),
);

app.get('/sitemap.xml', async (c) => {
  // Sólo paquetes ya verificados (páginas con datos reales); máximo 50.000 URLs por sitemap.
  const r = await pool.query<{ ecosystem: string; name: string; lm: Date }>(
    `SELECT ecosystem, name, COALESCE(last_changed_at, last_checked_at) AS lm FROM entity
     WHERE type = 'package' AND tracked AND last_checked_at IS NOT NULL ORDER BY popularity_rank NULLS LAST LIMIT 49000`,
  );
  const urls = [`${config.publicUrl}/`, `${config.publicUrl}/docs`, `${config.publicUrl}/models`, `${config.publicUrl}/changes`]
    .map((u) => `<url><loc>${esc(u)}</loc></url>`)
    .concat(r.rows.map((x) => `<url><loc>${esc(`${config.publicUrl}/${x.ecosystem}/${x.name}`)}</loc><lastmod>${x.lm.toISOString()}</lastmod></url>`));
  return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`, 200, {
    'content-type': 'application/xml; charset=utf-8',
    'cache-control': 'public, max-age=3600',
  });
});

app.get('/', async (c) => c.html(homeHtml(await stats()), 200, { 'cache-control': CACHE_SHORT }));

app.get('/changes', async (c) => {
  const rows = await recentChanges(100, ['released', 'deprecated', 'undeprecated', 'removed', 'yanked', 'retirement_announced', 'price_changed', 'runtime_requirement_changed']);
  const items = `<div class="card"><table>${rows
    .map((r) => {
      const href = r.ecosystem === 'ai' ? `/models/${r.name}` : `/${r.ecosystem}/${r.name}`;
      const detail = r.kind === 'released' ? `${esc(r.old_value?.version)} → <strong>${esc(r.new_value?.version)}</strong>` : '';
      return `<tr><td>${esc(r.detected_at.toISOString().slice(0, 16).replace('T', ' '))}</td><td><a href="${esc(href)}">${esc(r.entity)}</a></td><td>${esc(r.kind)} ${detail}</td></tr>`;
    })
    .join('')}</table></div>`;
  return c.html(listPage('Cambios recientes', 'Releases, deprecaciones y cambios de modelos de IA detectados por Vigía.', '/changes', items), 200, { 'cache-control': CACHE_SHORT });
});

app.get('/models', async (c) => {
  const models = await listModels({ limit: 1000 });
  const items = `<div class="card"><table><tr><th>Modelo</th><th>Entrada / salida (US$ por M tokens)</th><th>Contexto</th></tr>${models
    .map((m: any) => {
      const p = m.pricing ?? {};
      return `<tr><td><a href="/models/${esc(m.id)}">${esc(m.id)}</a>${m.expiration_date ? ` <span class="badge retiring">retiro ${esc(m.expiration_date)}</span>` : ''}</td><td>${p.variable ? 'variable' : `${esc(p.input ?? '—')} / ${esc(p.output ?? '—')}`}</td><td>${esc(m.context_length ?? '—')}</td></tr>`;
    })
    .join('')}</table></div>`;
  return c.html(listPage('Modelos de IA', 'Precios, contexto y fechas de retiro (fuente: catálogo de OpenRouter).', '/models', items), 200, { 'cache-control': CACHE_SHORT });
});

app.get('/models/*', async (c) => {
  const e = await getEntity(pool, `model:${decodeURIComponent(c.req.path.slice('/models/'.length))}`);
  if (!e) return c.html(listPage('Modelo no encontrado', 'No existe ese modelo en el catálogo.', c.req.path, ''), 404);
  return c.html(modelHtml(await modelView(e)), 200, { 'cache-control': CACHE_SHORT });
});

for (const eco of ['npm', 'pypi'] as const) {
  app.get(`/${eco}/*`, async (c) => {
    let raw = decodeURIComponent(c.req.path.slice(eco.length + 2));
    const md = raw.endsWith('.md'); // sólo por sufijo: así la caché del proxy no mezcla HTML y Markdown
    if (raw.endsWith('.md')) raw = raw.slice(0, -3);
    const name = canonicalName(eco, raw);
    if (!name) return c.html(listPage('Nombre inválido', `No es un nombre válido de paquete ${eco}.`, c.req.path, ''), 400);
    // Las páginas HTML no disparan resolución en vivo: los crawlers no deben poder crear entidades.
    const entity = await resolvePackage(eco, name, false);
    if (!entity) {
      return c.html(
        listPage('Paquete no seguido todavía', `Vigía todavía no sigue ${eco}:${name}. Consultalo por la API y se agrega automáticamente.`, c.req.path, `<pre>GET ${esc(config.publicUrl)}/v1/packages/${eco}/${esc(name)}</pre>`),
        404,
      );
    }
    const view = await packageView(entity);
    if (md) return c.text(packageMarkdown(view), 200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': CACHE_SHORT });
    const history = (await packageHistory(entity, 30)).data.changes;
    return c.html(packageHtml(view, history), view.data.status === 'not_found_in_registry' ? 404 : 200, { 'cache-control': CACHE_SHORT });
  });
}

app.get('/health', async (c) => {
  await pool.query('SELECT 1');
  return c.json({ ok: true });
});

await migrate();
serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => console.log(`vigia api escuchando en :${info.port}`));

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, () => {
    void pool.end().finally(() => process.exit(0));
  });
}
