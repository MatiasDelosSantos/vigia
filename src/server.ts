import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { serve } from '@hono/node-server';
import { config } from './config.js';
import { pool } from './db.js';
import { getEntity } from './facts.js';
import { checkDependencies, parsePackageJson, parseRequirements, type Dependency } from './check.js';
import { browse, changes, factByHash, listModels, modelView, packageHistory, packageView, recentChanges, relatedPackages, resolvePackage, search, stats, versionList, versionStatus } from './service.js';
import { canonicalName, isEcosystem, type Ecosystem } from './util.js';
import { handleMcp } from './api/mcp.js';
import { migrate } from './migrate.js';
import { splitPackagePath } from './paths.js';
import { availableGuides, compatibilityTable, compatibleVersion, guidesFor, symbolStatus, upgradeReport } from './intel.js';
import { parseConstraints } from './upgrade.js';
import { openapi } from './api/openapi.js';
import { modelPage, modelsIndexPage, providerPage, upgradeHtml, upgradesIndexHtml, weeklyHtml } from './api/pages.js';
import { readFileSync } from 'node:fs';
import { BROWSE_PAGE_SIZE, CHECKER_EXAMPLES, FAVICON_SVG, adminStatsHtml, browseHtml, checkerHtml, docsHtml, docsMarkdown, esc, homeHtml, legalHtml, listPage, llmsTxt, localeUrl, packageHtml, packageMarkdown, statusHtml } from './api/pages.js';
import { recentVersions } from './versions.js';
import semver from 'semver';
import { atom, describeChange, majorReleases, recentChangeRows } from './feeds.js';
import { basicAuth } from 'hono/basic-auth';
import { botName, classify, routeGroup, startAnalytics, stopAnalytics, track, trackVisitor, type ClientClass } from './analytics.js';
import { BADGE_TYPES, badgeFor, badgeSvg, type BadgeType } from './api/badge.js';
import { LOCALES, t, type Locale } from './i18n/index.js';

const app = new Hono();

// Cache en el proxy/CDN: los hechos cambian por evento, un TTL corto con stale-while-revalidate alcanza.
const CACHE_SHORT = 'public, max-age=60, stale-while-revalidate=600';
const CACHE_LONG = 'public, max-age=3600, stale-while-revalidate=86400';
/** Skill para agentes (también publicada en el repo como plugin de Claude Code). */
const SKILL_MD = (() => {
  try {
    return readFileSync(new URL('../skills/vigia/SKILL.md', import.meta.url), 'utf8');
  } catch {
    return '# Vigia\n\nhttps://github.com/MatiasDelosSantos/vigia/blob/master/skills/vigia/SKILL.md\n';
  }
})();

app.use('*', async (c, next) => {
  const t0 = performance.now();
  await next();
  c.header('x-content-type-options', 'nosniff');
  if (c.req.path.startsWith('/v1/') || c.req.path === '/openapi.json') c.header('access-control-allow-origin', '*');
  const ua = c.req.header('user-agent') ?? '-';
  console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Math.round(performance.now() - t0)}ms "${ua.slice(0, 120)}"`);
  try {
    measure(c, ua);
  } catch {
    // la medición nunca debe romper una respuesta
  }
});

function measure(c: Context, ua: string): void {
  const path = c.req.path;
  if (path.startsWith('/admin') || path === '/health') return;
  const cls = classify(ua);
  const group = routeGroup(path);
  c.set('clientClass' as never, cls as never);
  track('client', cls);
  track('route', `${cls} ${group}`);
  if (cls !== 'human' && cls !== 'script' && cls !== 'unknown') track('bot', botName(ua));
  if (group.startsWith('api:')) track('api', `${group} · ${cls}`);
  const isPage = c.req.method === 'GET' && c.res.status === 200 && (group === 'home' || group.startsWith('page:'));
  if (cls === 'human' && isPage) {
    track('page', path.slice(0, 120));
    trackVisitor(c.req.header('x-real-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim(), ua);
    const ref = c.req.header('referer');
    if (ref) {
      try {
        const host = new URL(ref).host;
        if (host && !host.endsWith('vigia.coredls.cloud')) track('referrer', host);
      } catch {
        /* referer inválido */
      }
    }
  }
}

// Archivo de verificación de IndexNow: /{clave}.txt
app.use('*', async (c, next) => {
  if (config.indexNowKey && c.req.path === `/${config.indexNowKey}.txt`) return c.text(config.indexNowKey);
  await next();
});

app.onError((err, c) => {
  // Errores HTTP intencionales (p. ej. 401 de la autenticación del panel) se devuelven tal cual.
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ error: 'internal_error', message: 'Internal error; retry in a few seconds.' }, 500);
});

function parseAsOf(c: Context): Date | undefined | 'invalid' {
  const raw = c.req.query('as_of');
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? 'invalid' : d;
}


async function notFound(c: Context, eco: Ecosystem, name: string) {
  // Prefijos cada vez más cortos hasta encontrar candidatos (paquetes seguidos, ordenados por popularidad).
  let suggestions: string[] = [];
  for (let len = Math.max(3, name.length - 2); len >= 3 && suggestions.length === 0; len = len > 6 ? Math.floor(len / 2) : len - 1) {
    suggestions = (await search(name.slice(0, len), eco, 5)).map((s) => s.name).filter((n) => n !== name);
  }
  return c.json({ error: 'not_found', message: `Package ${eco}:${name} does not exist in the registry.`, did_you_mean: suggestions }, 404);
}

// ----------------------------------------------------------------------------------------- API REST

app.get('/v1/packages/*', async (c) => {
  const { eco, name: raw, suffix, version, symbol } = splitPackagePath(c.req.path.slice('/v1/packages/'.length));
  if (!isEcosystem(eco)) return c.json({ error: 'invalid_ecosystem', message: 'Supported ecosystems: npm, pypi' }, 400);
  const name = canonicalName(eco, raw);
  if (!name) return c.json({ error: 'invalid_name', message: `Invalid package name for ${eco}.` }, 400);
  const asOf = parseAsOf(c);
  if (asOf === 'invalid') return c.json({ error: 'invalid_as_of', message: 'as_of must be an ISO-8601 timestamp.' }, 400);

  const entity = await resolvePackage(eco, name, !asOf);
  if (!entity) return c.json({ error: 'no_data', message: 'Vigia had no data for this package at that time.' }, 404);
  if (suffix === 'history') {
    c.header('cache-control', CACHE_SHORT);
    return c.json(await packageHistory(entity));
  }
  if (suffix === 'versions') {
    c.header('cache-control', CACHE_SHORT);
    const limit = c.req.query('all') === 'true' ? 5000 : Math.min(Number(c.req.query('limit') ?? 100) || 100, 1000);
    return c.json(await versionList(entity, limit, c.req.query('stable') === 'true'));
  }
  if (suffix === 'version') {
    if (!version || version.length > 100 || !/^[0-9A-Za-z.+_!-]+$/.test(version)) return c.json({ error: 'invalid_version' }, 400);
    c.header('cache-control', CACHE_SHORT);
    return c.json(await versionStatus(entity, version));
  }
  if (suffix === 'compatible') {
    const constraints = parseConstraints(c.req.query('with') ?? '');
    if (constraints.length === 0) return c.json({ error: 'invalid_constraints', message: 'Use ?with=node@18,react@18 (npm) or ?with=python@3.8 (pypi).' }, 400);
    c.header('cache-control', CACHE_SHORT);
    return c.json(await compatibleVersion(entity, constraints));
  }
  if (suffix === 'upgrade') {
    const r = await upgradeReport(entity, c.req.query('from'), c.req.query('to'));
    if (r.status === 'pending') {
      c.header('retry-after', String(r.retry_after_s));
      return c.json({ status: 'pending', message: 'Analysis queued; retry after retry_after_s seconds.', ...r.data, retry_after_s: r.retry_after_s }, 202);
    }
    if (r.status !== 'ok') return c.json({ error: r.status, message: r.message }, r.status === 'unsupported' ? 422 : 400);
    c.header('cache-control', CACHE_SHORT);
    return c.json({ data: r.data, meta: r.meta });
  }
  if (suffix === 'symbol') {
    if (!symbol || symbol.length > 200 || !/^[A-Za-z_$][\w$]*(\.[A-Za-z_$#][\w$]*)?$/.test(symbol)) return c.json({ error: 'invalid_symbol', message: 'Use an exported name, optionally Class.member.' }, 400);
    const r = await symbolStatus(entity, symbol, c.req.query('version'), c.req.query('module'));
    if (r.status === 'pending') {
      c.header('retry-after', String(r.retry_after_s));
      return c.json({ status: 'pending', message: 'Analysis queued; retry after retry_after_s seconds.', ...r.data, retry_after_s: r.retry_after_s }, 202);
    }
    if (r.status === 'ok') {
      c.header('cache-control', CACHE_SHORT);
      return c.json({ data: r.data, meta: r.meta });
    }
    if (r.status === 'no_types') return c.json({ error: 'no_types', message: 'No TypeScript types could be analyzed for this version.', ...r.data }, 404);
    return c.json({ error: r.status, message: r.message }, r.status === 'unsupported' ? 422 : 400);
  }
  const view = await packageView(entity, asOf);
  if (view.data.status === 'not_found_in_registry' && !asOf) return notFound(c, eco, name);
  c.header('cache-control', asOf ? CACHE_LONG : CACHE_SHORT);
  return c.json(view);
});

app.post('/v1/check', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !isEcosystem(body.ecosystem)) return c.json({ error: 'invalid_body', message: 'Expected {"ecosystem":"npm"|"pypi", "manifest": "..."} or "dependencies".' }, 400);
  const eco: Ecosystem = body.ecosystem;
  let deps: Dependency[];
  try {
    if (typeof body.manifest === 'string') deps = eco === 'npm' ? parsePackageJson(body.manifest) : parseRequirements(body.manifest);
    else if (body.dependencies && typeof body.dependencies === 'object')
      deps = Object.entries(body.dependencies).filter(([, v]) => typeof v === 'string').map(([name, spec]) => ({ name, spec: spec as string }));
    else return c.json({ error: 'invalid_body', message: 'Missing "manifest" or "dependencies".' }, 400);
  } catch {
    return c.json({ error: 'invalid_manifest', message: 'Could not parse the manifest.' }, 400);
  }
  track('checker', `api ${eco}`);
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
    return c.json({ error: 'not_found', message: `Model ${id} is not in the catalog.`, did_you_mean: similar.map((m: any) => m.id) }, 404);
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
  try {
    const body = await c.req.raw.clone().json();
    const msgs = Array.isArray(body) ? body : [body];
    const cls = classify(c.req.header('user-agent'));
    for (const m of msgs) {
      if (!m || typeof m.method !== 'string') continue;
      if (m.method === 'tools/call') {
        const tool = String(m.params?.name ?? '?').slice(0, 60);
        track('mcp', `tools/call:${tool}`);
        track('mcp_caller', `${tool} · ${cls}`);
      } else {
        track('mcp', m.method.slice(0, 60));
      }
      if (m.method === 'initialize') {
        const ci = m.params?.clientInfo;
        track('mcp_client', `${String(ci?.name ?? 'unknown').slice(0, 60)} ${String(ci?.version ?? '').slice(0, 20)}`.trim());
      }
    }
  } catch {
    /* cuerpo no JSON: lo rechaza el transporte */
  }
  // Tolerancia: algunos clientes MCP piden sólo application/json (sin text/event-stream) y el SDK los rechaza con 406.
  // Como siempre respondemos JSON, completamos el Accept en lugar de expulsarlos.
  const accept = c.req.header('accept') ?? '';
  if (c.req.method === 'POST' && !(accept.includes('application/json') && accept.includes('text/event-stream'))) {
    const headers = new Headers(c.req.raw.headers);
    headers.set('accept', 'application/json, text/event-stream');
    return handleMcp(new Request(c.req.raw, { headers }));
  }
  return handleMcp(c.req.raw);
});

// ----------------------------------------------------------------------------------------- descubrimiento y páginas

// MCP Server Card (propuesta SEP-1649/2127, todavía no estándar): barato de servir y útil para descubrimiento.
app.get('/.well-known/mcp/server-card.json', (c) =>
  c.json(
    {
      name: 'cloud.coredls.vigia/vigia',
      title: 'Vigia',
      description: 'What breaks between versions, per-version vulnerabilities, compatible versions: npm/PyPI facts.',
      version: '0.3.0',
      websiteUrl: config.publicUrl,
      documentationUrl: `${config.publicUrl}/docs`,
      remotes: [{ type: 'streamable-http', url: `${config.publicUrl}/mcp` }],
      authentication: { required: false },
      tools: ['package_status', 'version_status', 'upgrade_impact', 'symbol_status', 'find_compatible_version', 'check_dependencies', 'recent_changes', 'model_info', 'find_package'],
    },
    200,
    { 'cache-control': CACHE_LONG, 'access-control-allow-origin': '*' },
  ),
);

app.get('/openapi.json', (c) => {
  c.header('cache-control', CACHE_LONG);
  return c.json(openapi());
});

app.get('/skill.md', (c) => c.text(SKILL_MD, 200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': CACHE_LONG }));
app.get('/llms.txt', (c) => c.text(llmsTxt(), 200, { 'cache-control': CACHE_LONG }));

app.get('/favicon.svg', (c) => c.body(FAVICON_SVG, 200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=604800' }));
app.get('/favicon.ico', (c) => c.body(FAVICON_SVG, 200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=604800' }));
// Badges SVG para READMEs: /badge/{npm|pypi}/{name}/{version|maintained|status}.svg
app.get('/badge/*', async (c) => {
  const rest = c.req.path.slice('/badge/'.length);
  const m = /^(npm|pypi)\/(.+)\/(version|maintained|status)\.svg$/.exec(decodeURIComponent(rest));
  if (!m) return c.text('Usage: /badge/{npm|pypi}/{name}/{version|maintained|status}.svg', 400);
  const eco = m[1] as Ecosystem;
  const type = m[3] as BadgeType;
  const name = canonicalName(eco, m[2]!);
  const svgHeaders = { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=3600, s-maxage=3600' };
  if (!name) return c.body(badgeSvg(eco, 'invalid name', '#6b675f'), 200, svgHeaders);
  const entity = await resolvePackage(eco, name, true).catch(() => null);
  track('badge', `${type} ${eco}`);
  const ref = c.req.header('referer');
  const ua = c.req.header('user-agent') ?? '';
  track('badge_ref', ua.includes('github-camo') ? 'github.com (camo)' : ref ? (() => { try { return new URL(ref).host; } catch { return 'invalid'; } })() : 'direct');
  if (!entity) return c.body(badgeSvg(eco, 'not found', '#6b675f'), 200, svgHeaders);
  const view = await packageView(entity);
  const b = badgeFor(type, eco, view.data);
  return c.body(badgeSvg(b.label, b.value, b.color), 200, svgHeaders);
});

// Panel privado de uso (usuario "admin", contraseña ADMIN_PASSWORD del .env; sin contraseña, no existe).
if (process.env.ADMIN_PASSWORD) {
  app.use('/admin/*', basicAuth({ username: 'admin', password: process.env.ADMIN_PASSWORD }));
  app.get('/admin/stats', async (c) => {
    const days = Math.min(Math.max(Number(c.req.query('days') ?? 14) || 14, 1), 90);
    const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const clients = await pool.query<{ day: string; key: string; n: number }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, key, n::int AS n FROM usage_daily WHERE dim = 'client' AND day >= $1 ORDER BY day DESC`,
      [since],
    );
    const vis = await pool.query<{ day: string; n: number }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, count(*)::int AS n FROM visitor_daily WHERE day >= $1 GROUP BY 1`,
      [since],
    );
    const tops = await pool.query<{ dim: string; key: string; n: number }>(
      `SELECT dim, key, n FROM (SELECT dim, key, sum(n)::int AS n, row_number() OVER (PARTITION BY dim ORDER BY sum(n) DESC) AS rk
         FROM usage_daily WHERE day >= $1 AND dim <> 'client' AND dim <> 'route' GROUP BY dim, key) x WHERE rk <= 25 ORDER BY dim, n DESC`,
      [since],
    );
    const dayList = Array.from({ length: days }, (_, i) => new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
    const byDay: Record<string, Record<string, number>> = {};
    for (const r of clients.rows) (byDay[r.day] ??= {})[r.key] = r.n;
    const top: Record<string, Array<{ key: string; n: number }>> = {};
    for (const r of tops.rows) (top[r.dim] ??= []).push({ key: r.key, n: r.n });
    return c.html(adminStatsHtml({ days: dayList, byDay, visitors: Object.fromEntries(vis.rows.map((r) => [r.day, r.n])), top }), 200, {
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    });
  });
}

// Feeds Atom: cambios detectados y guías de actualización nuevas (suscripción para lectores, agregadores y bots).
app.get('/feed/changes.atom', async (c) => {
  const rows = await recentChangeRows(14, ['released', 'deprecated', 'retirement_announced', 'removed'], 200);
  const entries = rows.map((r) => ({ id: `${config.publicUrl}/v1/changes#${r.seq}`, updated: r.detected_at.toISOString(), ...describeChange(r) }));
  const xml = atom({
    id: `${config.publicUrl}/feed/changes.atom`,
    title: 'Vigia — package and AI model changes',
    subtitle: 'New releases, deprecations and AI model retirements, detected automatically.',
    self: `${config.publicUrl}/feed/changes.atom`,
    alternate: `${config.publicUrl}/changes`,
    entries,
  });
  return c.body(xml, 200, { 'content-type': 'application/atom+xml; charset=utf-8', 'cache-control': 'public, max-age=600' });
});

app.get('/feed/upgrades.atom', async (c) => {
  const r = await pool.query<{ name: string; ts: Date }>(
    `SELECT e.name, max(s.computed_at) AS ts FROM api_snapshot s JOIN entity e ON e.id = s.entity_id WHERE s.status = 'ok' AND e.ecosystem = 'npm' GROUP BY e.name`,
  );
  const ts = new Map(r.rows.map((x) => [x.name, x.ts]));
  const guides = (await availableGuides(5000))
    .map((g) => ({ ...g, ts: ts.get(g.name) ?? new Date() }))
    .sort((a, b) => b.ts.getTime() - a.ts.getTime())
    .slice(0, 100);
  const entries = guides.map((g) => ({
    id: `${config.publicUrl}/upgrade/npm/${g.name}/${g.from}-to-${g.to}`,
    title: `${g.name} ${g.from} → ${g.to}: what breaks`,
    link: `${config.publicUrl}/upgrade/npm/${g.name}/${g.from}-to-${g.to}`,
    updated: g.ts.toISOString(),
    summary: `Automatic breaking-change report for ${g.name} ${g.fromVersion} → ${g.toVersion}, computed from its TypeScript types.`,
  }));
  const xml = atom({
    id: `${config.publicUrl}/feed/upgrades.atom`,
    title: 'Vigia — upgrade guides',
    subtitle: 'Automatic breaking-change reports between major versions of npm packages.',
    self: `${config.publicUrl}/feed/upgrades.atom`,
    alternate: `${config.publicUrl}/upgrade`,
    entries,
  });
  return c.body(xml, 200, { 'content-type': 'application/atom+xml; charset=utf-8', 'cache-control': 'public, max-age=600' });
});

app.get('/weekly', async (c) => {
  const majors = await majorReleases(7, 150);
  const guides = new Map((await availableGuides(5000)).map((g) => [`${g.name}@${g.to}`, g]));
  const total = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM change_event WHERE kind = 'released' AND detected_at > now() - interval '7 days'`);
  const dep = await recentChangeRows(7, ['deprecated'], 100);
  const models = await recentChangeRows(7, ['retirement_announced', 'price_changed', 'removed'], 200);
  const now = new Date();
  const html = weeklyHtml({
    from: new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
    totalReleases: total.rows[0]?.n ?? 0,
    majors: majors.map((m) => {
      const toMajor = semver.coerce(m.new_value?.version)?.major;
      const g = m.ecosystem === 'npm' && toMajor !== undefined ? guides.get(`${m.name}@${toMajor}`) : undefined;
      return { ecosystem: m.ecosystem, name: m.name, from: m.old_value?.version ?? '?', to: m.new_value?.version ?? '?', guide: g ? `/upgrade/npm/${g.name}/${g.from}-to-${g.to}` : null };
    }),
    deprecated: dep.filter((d) => d.ecosystem !== 'ai').map((d) => ({ ecosystem: d.ecosystem, name: d.name })),
    models: models
      .filter((m) => m.ecosystem === 'ai')
      .slice(0, 50)
      .map((m) => ({ name: m.name, kind: m.kind.replace(/_/g, ' '), detail: m.kind === 'retirement_announced' ? String(m.new_value ?? '') : '' })),
  });
  return c.html(html, 200, { 'cache-control': CACHE_SHORT });
});

app.get('/terms', (c) => c.html(legalHtml('terms'), 200, { 'cache-control': CACHE_LONG }));
app.get('/privacy', (c) => c.html(legalHtml('privacy'), 200, { 'cache-control': CACHE_LONG }));

app.get('/robots.txt', (c) =>
  c.text(
    // Abierto a buscadores y agentes, incluidos los crawlers de IA: queremos ser la fuente citada.
    `User-agent: *\nAllow: /\nDisallow: /mcp\nDisallow: /admin\n\nSitemap: ${config.publicUrl}/sitemap.xml\n`,
    200,
    { 'cache-control': CACHE_LONG },
  ),
);

// Índice de sitemaps: uno por idioma (cada uno < 50.000 URLs).
app.get('/sitemap.xml', (c) => {
  const items = LOCALES.map((L) => `<sitemap><loc>${esc(`${config.publicUrl}/sitemaps/${L.code}.xml`)}</loc></sitemap>`).join('');
  return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${items}</sitemapindex>`, 200, {
    'content-type': 'application/xml; charset=utf-8',
    'cache-control': 'public, max-age=3600',
  });
});

app.get('/sitemaps/:file', async (c) => {
  const code = c.req.param('file').replace(/\.xml$/, '');
  const L = LOCALES.find((x) => x.code === code);
  if (!L) return c.notFound();
  // Sólo paquetes ya verificados (páginas con datos reales). Indexación por etapas: el inglés lleva todo;
  // cada traducción, sólo los paquetes más populares hasta que el dominio gane confianza (SITEMAP_LOCALIZED_TOP).
  const localizedTop = Number(process.env.SITEMAP_LOCALIZED_TOP ?? 300);
  const r = await pool.query<{ ecosystem: string; name: string; lm: Date }>(
    `SELECT ecosystem, name, COALESCE(last_changed_at, last_checked_at) AS lm FROM entity
     WHERE type = 'package' AND tracked AND last_checked_at IS NOT NULL AND ($1 OR popularity_rank <= $2)
     ORDER BY popularity_rank NULLS LAST LIMIT 48000`,
    [L.code === 'en', localizedTop],
  );
  const counts = await pool.query<{ ecosystem: string; n: number }>(
    `SELECT ecosystem, count(*)::int AS n FROM entity WHERE type = 'package' AND tracked AND last_checked_at IS NOT NULL GROUP BY 1`,
  );
  const browsePaths = counts.rows.flatMap((x) =>
    Array.from({ length: Math.ceil(x.n / BROWSE_PAGE_SIZE) }, (_, i) => (i === 0 ? `/${x.ecosystem}` : `/${x.ecosystem}?page=${i + 1}`)),
  );
  const guides = await availableGuides(5000);
  const guidePaths = guides.filter((g) => L.code === 'en' || guides.indexOf(g) < 300).map((g) => `/upgrade/npm/${g.name}/${g.from}-to-${g.to}`);
  const models = await listModels({ limit: 2000 });
  const providerPaths = [...new Set(models.map((m: any) => m.provider).filter(Boolean))].map((x) => `/models/${x}`);
  const modelPaths = L.code === 'en' ? models.map((m: any) => `/models/${m.id}`) : [];
  const urls = ['/', '/check', '/upgrade', ...(L.code === 'en' ? ['/weekly'] : []), '/docs', '/models', '/changes', '/status', ...browsePaths, ...guidePaths, ...providerPaths, ...modelPaths]
    .map((p) => `<url><loc>${esc(localeUrl(L, p))}</loc></url>`)
    .concat(r.rows.map((x) => `<url><loc>${esc(localeUrl(L, `/${x.ecosystem}/${x.name}`))}</loc><lastmod>${x.lm.toISOString()}</lastmod></url>`));
  return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`, 200, {
    'content-type': 'application/xml; charset=utf-8',
    'cache-control': 'public, max-age=3600',
  });
});

/** Páginas para humanos y buscadores, en cada idioma. Inglés en la raíz; el resto bajo /{código}. */
function registerPages(L: Locale): void {
  const p = L.prefix;
  const html = (c: Context, body: string, status: 200 | 400 | 404 = 200) =>
    c.html(body, status, { 'cache-control': CACHE_SHORT, 'content-language': L.lang });

  const home = async (c: Context) => {
    const [npmTop, pypiTop] = await Promise.all([browse('npm', 0, 40), browse('pypi', 0, 40)]);
    return html(c, homeHtml(L, await stats(), { npm: npmTop.items.map((x) => x.name), pypi: pypiTop.items.map((x) => x.name) }));
  };
  if (p) {
    app.get(p, (c) => c.redirect(`${p}/`, 301));
    app.get(`${p}/`, home);
  } else {
    app.get('/', home);
  }

  app.get(`${p}/docs`, (c) => html(c, docsHtml(L)));
  app.get(`${p}/status`, async (c) => html(c, statusHtml(L, await stats())));

  app.get(`${p}/upgrade`, async (c) => html(c, upgradesIndexHtml(L, await availableGuides(1000))));
  app.get(`${p}/upgrade/npm/*`, async (c) => {
    const rest = decodeURIComponent(c.req.path.slice(`${p}/upgrade/npm/`.length));
    const m = /^(.+)\/(\d{1,4})-to-(\d{1,4})$/.exec(rest);
    const name = m ? canonicalName('npm', m[1]!) : null;
    if (!m || !name) return html(c, listPage(L, t(L, 'err.invalidName'), t(L, 'err.invalidNameText', { eco: 'npm' }), c.req.path, ''), 400);
    const a = Number(m[2]);
    const b = Number(m[3]);
    if (b <= a) return c.redirect(`${p}/upgrade/npm/${name}/${b}-to-${a}`, 301);
    const entity = await resolvePackage('npm', name, false);
    if (!entity) return html(c, listPage(L, t(L, 'err.notTracked'), t(L, 'err.notTrackedText', { pkg: `npm:${name}` }), c.req.path, ''), 404);
    // Preferimos las versiones ya analizadas de cada mayor (página estable para buscadores); si no hay, la última de la mayor.
    const ready = (await guidesFor(entity.id)).find((g) => g.from === a && g.to === b);
    const r = await upgradeReport(entity, ready?.fromVersion ?? String(a), ready?.toVersion ?? String(b));
    if (r.status === 'ok') return html(c, upgradeHtml(L, name, a, b, { status: 'ok', data: r.data, meta: r.meta }));
    if (r.status === 'pending') return html(c, upgradeHtml(L, name, a, b, { status: 'pending' }));
    return html(c, upgradeHtml(L, name, a, b, { status: 'error', message: r.message }), 404);
  });

  app.get(`${p}/check`, (c) => {
    const ex = c.req.query('example');
    const eco = ex === 'pypi' ? 'pypi' : 'npm';
    return html(c, checkerHtml(L, { eco, manifest: ex === 'npm' || ex === 'pypi' ? CHECKER_EXAMPLES[eco] : '' }));
  });
  app.post(`${p}/check`, async (c) => {
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const eco: Ecosystem = form.ecosystem === 'pypi' ? 'pypi' : 'npm';
    const manifest = typeof form.manifest === 'string' ? form.manifest.slice(0, 200_000) : '';
    let deps: Dependency[] | null = null;
    try {
      deps = eco === 'npm' ? parsePackageJson(manifest) : parseRequirements(manifest);
    } catch {
      deps = null;
    }
    track('checker', `web ${eco}`);
    if (!deps) return c.html(checkerHtml(L, { eco, manifest, error: t(L, 'checker.parseError') }), 200, { 'cache-control': 'no-store' });
    const result = await checkDependencies(eco, deps);
    return c.html(checkerHtml(L, { eco, manifest, result }), 200, { 'cache-control': 'no-store', 'content-language': L.lang });
  });

  // Páginas índice por popularidad: dan enlaces internos a cada paquete (antes sólo existían en el sitemap).
  for (const eco of ['npm', 'pypi'] as const) {
    app.get(`${p}/${eco}`, async (c) => {
      const page = Math.max(1, Math.floor(Number(c.req.query('page') ?? 1)) || 1);
      const data = await browse(eco, (page - 1) * BROWSE_PAGE_SIZE, BROWSE_PAGE_SIZE);
      if (data.items.length === 0 && page > 1) return c.notFound();
      return html(c, browseHtml(L, eco, page, data));
    });
  }
  app.get(`${p}/docs.md`, (c) => c.text(docsMarkdown(L), 200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': CACHE_LONG, 'content-language': L.lang }));

  app.get(`${p}/changes`, async (c) => {
    const rows = await recentChanges(100, ['released', 'deprecated', 'undeprecated', 'removed', 'yanked', 'retirement_announced', 'price_changed', 'runtime_requirement_changed']);
    const items = `<div class="card"><table>${rows
      .map((r) => {
        const href = `${p}${r.ecosystem === 'ai' ? `/models/${r.name}` : `/${r.ecosystem}/${r.name}`}`;
        const detail = r.kind === 'released' ? `<span dir="ltr">${esc(r.old_value?.version)} → <strong>${esc(r.new_value?.version)}</strong></span>` : '';
        return `<tr><td dir="ltr">${esc(r.detected_at.toISOString().slice(0, 16).replace('T', ' '))}</td><td><a href="${esc(href)}" dir="ltr">${esc(r.entity)}</a></td><td>${esc(r.kind)} ${detail}</td></tr>`;
      })
      .join('')}</table></div>`;
    return html(c, listPage(L, t(L, 'list.changesTitle'), t(L, 'list.changesIntro'), '/changes', items));
  });

  app.get(`${p}/models`, async (c) => html(c, modelsIndexPage(L, await listModels({ limit: 1000 }))));
  app.get(`${p}/models/*`, async (c) => {
    const id = decodeURIComponent(c.req.path.slice(`${p}/models/`.length));
    // Sin "/": es un proveedor (los ids de modelo siempre son "proveedor/modelo").
    if (!id.includes('/')) {
      const models = /^[a-z0-9][a-z0-9._-]{0,63}$/.test(id) ? await listModels({ provider: id, limit: 500 }) : [];
      if (!models.length) return html(c, listPage(L, t(L, 'err.modelNotFound'), t(L, 'err.modelNotFoundText'), `/models/${id}`, ''), 404);
      return html(c, providerPage(L, id, models));
    }
    const e = await getEntity(pool, `model:${id}`);
    if (!e) return html(c, listPage(L, t(L, 'err.modelNotFound'), t(L, 'err.modelNotFoundText'), `/models/${id}`, ''), 404);
    const view = await modelView(e);
    const provider = (view.data as any).provider as string | null;
    const siblings = provider ? await listModels({ provider, limit: 200 }) : [];
    return html(c, modelPage(L, view, siblings));
  });

  for (const eco of ['npm', 'pypi'] as const) {
    app.get(`${p}/${eco}/*`, async (c) => {
      let raw = decodeURIComponent(c.req.path.slice(`${p}/${eco}/`.length));
      const md = raw.endsWith('.md'); // sólo por sufijo: así la caché del proxy no mezcla HTML y Markdown
      if (md) raw = raw.slice(0, -3);
      const name = canonicalName(eco, raw);
      if (!name) return html(c, listPage(L, t(L, 'err.invalidName'), t(L, 'err.invalidNameText', { eco }), `/${eco}/${raw}`, ''), 400);
      // Las páginas HTML no disparan resolución en vivo: los crawlers no deben poder crear entidades.
      const entity = await resolvePackage(eco, name, false);
      if (!entity) {
        return html(
          c,
          listPage(L, t(L, 'err.notTracked'), t(L, 'err.notTrackedText', { pkg: `${eco}:${name}` }), `/${eco}/${name}`, `<pre>GET ${esc(config.publicUrl)}/v1/packages/${eco}/${esc(name)}</pre>`),
          404,
        );
      }
      const view = await packageView(entity);
      if (md) return c.text(packageMarkdown(view), 200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': CACHE_SHORT });
      const history = (await packageHistory(entity, 30)).data.changes;
      const peers = Object.keys((view.data as any).requires?.peer_dependencies ?? {});
      const [versions, related, compat, guides] = await Promise.all([
        recentVersions(pool, entity.id, 20, true),
        relatedPackages(entity, peers),
        compatibilityTable(entity),
        eco === 'npm' ? guidesFor(entity.id) : Promise.resolve([]),
      ]);
      return html(c, packageHtml(L, view, history, { versions, related, compat, guides }), view.data.status === 'not_found_in_registry' ? 404 : 200);
    });
  }
}

// Primero los idiomas con prefijo, para que /es/npm/... no lo capture la ruta /npm/* del inglés (no se solapan, pero es más claro).
for (const L of [...LOCALES.slice(1), LOCALES[0]!]) registerPages(L);

app.get('/health', async (c) => {
  await pool.query('SELECT 1');
  return c.json({ ok: true });
});

await migrate();
startAnalytics();
serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => console.log(`vigia api escuchando en :${info.port}`));

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, () => {
    void stopAnalytics()
      .catch(() => {})
      .finally(() => void pool.end().finally(() => process.exit(0)));
  });
}
