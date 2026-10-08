import { createHash } from 'node:crypto';
import { pool } from './db.js';

export type ClientClass = 'human' | 'search_bot' | 'ai_crawler' | 'ai_user' | 'seo_bot' | 'other_bot' | 'script' | 'unknown';

const AI_USER = /ChatGPT-User|Claude-User|Perplexity-User|MistralAI-User|DuckAssistBot|Gemini-User/i;
const AI_CRAWLER = /GPTBot|ClaudeBot|Claude-SearchBot|anthropic-ai|OAI-SearchBot|PerplexityBot|Google-Extended|CCBot|Bytespider|Amazonbot|meta-externalagent|Applebot-Extended|cohere-ai|Diffbot|YouBot|ImagesiftBot|Timpibot/i;
const SEARCH_BOT = /Googlebot|bingbot|YandexBot|YandexRenderResourcesBot|DuckDuckBot|Baiduspider|Applebot|Yeti|Sogou|SeznamBot|Qwantbot|Google-InspectionTool|GoogleOther/i;
const SEO_BOT = /AhrefsBot|SemrushBot|MJ12bot|DotBot|PetalBot|DataForSeoBot|BLEXBot|serpstatbot|Barkrowler|SeekportBot/i;
const OTHER_BOT = /bot|crawl|spider|probe|scanner|monitor|liveness|collector|headless|lighthouse|checker|preview|fetcher|validator/i;
const SCRIPT = /^(curl|wget|python|node|undici|go-http-client|axios|okhttp|java|ruby|php|libwww|httpie|postmanruntime|deno|bun)|aiohttp|httpx|python-requests/i;
const BROWSER = /Mozilla\/5\.0.*(Chrome|Safari|Firefox|Edg|OPR)\//;

export function classify(ua: string | undefined): ClientClass {
  if (!ua || ua === '-') return 'unknown';
  if (AI_USER.test(ua)) return 'ai_user';
  if (AI_CRAWLER.test(ua)) return 'ai_crawler';
  if (SEARCH_BOT.test(ua)) return 'search_bot';
  if (SEO_BOT.test(ua)) return 'seo_bot';
  if (OTHER_BOT.test(ua)) return 'other_bot';
  if (SCRIPT.test(ua.trim())) return 'script';
  if (BROWSER.test(ua)) return 'human';
  return 'unknown';
}

/** Nombre corto del bot (primer "producto/versión" que parece bot), para el ranking de bots. */
export function botName(ua: string): string {
  const m = /([A-Za-z][\w.-]*(?:bot|Bot|BOT|spider|crawler|Crawler|probe|Probe|scanner|Scanner|monitor|User|agent|Agent|collector))[/ ;)]/.exec(ua);
  if (m) return m[1]!.slice(0, 60);
  return ua.split(/[\s(]/)[0]!.slice(0, 60) || 'unknown';
}

// ---------------------------------------------------------------------------------- acumulación en memoria

const counters = new Map<string, number>();
const visitors = new Set<string>();
const salt = process.env.ANALYTICS_SALT ?? 'vigia-default-salt';

const today = () => new Date().toISOString().slice(0, 10);

export function track(dim: string, key: string, n = 1): void {
  const k = `${today()}\u0000${dim}\u0000${key.slice(0, 200)}`;
  counters.set(k, (counters.get(k) ?? 0) + n);
}

/** Visitante humano único del día: hash no reversible de IP + UA + día + sal. */
export function trackVisitor(ip: string | undefined, ua: string | undefined): void {
  if (!ip) return;
  const day = today();
  visitors.add(`${day}\u0000${createHash('sha256').update(`${salt}|${day}|${ip}|${ua ?? ''}`).digest('hex').slice(0, 20)}`);
}

async function flush(): Promise<void> {
  if (counters.size > 0) {
    const rows = [...counters.entries()];
    counters.clear();
    const parts = rows.map(([k, n]) => [...k.split('\u0000'), n] as [string, string, string, number]);
    try {
      await pool.query(
        `INSERT INTO usage_daily (day, dim, key, n)
         SELECT d::date, m, k, c FROM unnest($1::text[], $2::text[], $3::text[], $4::bigint[]) AS t(d, m, k, c)
         ON CONFLICT (day, dim, key) DO UPDATE SET n = usage_daily.n + EXCLUDED.n`,
        [parts.map((p) => p[0]), parts.map((p) => p[1]), parts.map((p) => p[2]), parts.map((p) => p[3])],
      );
    } catch (err) {
      // Si falla, devolvemos los contadores para el próximo intento.
      for (const [k, n] of rows) counters.set(k, (counters.get(k) ?? 0) + n);
      console.error('analytics flush falló:', err instanceof Error ? err.message : err);
    }
  }
  if (visitors.size > 0) {
    const v = [...visitors].map((x) => x.split('\u0000') as [string, string]);
    visitors.clear();
    await pool
      .query(`INSERT INTO visitor_daily (day, h) SELECT d::date, h FROM unnest($1::text[], $2::text[]) AS t(d, h) ON CONFLICT DO NOTHING`, [
        v.map((x) => x[0]),
        v.map((x) => x[1]),
      ])
      .catch((err) => console.error('analytics visitors falló:', err instanceof Error ? err.message : err));
  }
}

let timer: NodeJS.Timeout | null = null;
export function startAnalytics(): void {
  timer = setInterval(() => void flush(), 30_000);
  timer.unref();
}
export async function stopAnalytics(): Promise<void> {
  if (timer) clearInterval(timer);
  await flush();
}

// ---------------------------------------------------------------------------------- clasificación de rutas

/** Agrupa rutas para el ranking de páginas (sin explotar cardinalidad por paquete para bots). */
export function routeGroup(path: string): string {
  const p = path.replace(/^\/(es|pt|fr|de|it|nl|pl|ru|uk|tr|ar|hi|id|vi|ja|ko|zh)(?=\/|$)/, '');
  if (p === '' || p === '/') return 'home';
  if (/^\/v1\/packages\/[^/]+\/.+\/versions\/[^/]+$/.test(p)) return 'api:version';
  if (/^\/v1\/packages\/[^/]+\/.+\/versions$/.test(p)) return 'api:versions';
  if (/^\/v1\/packages\/[^/]+\/.+\/history$/.test(p)) return 'api:history';
  if (p.startsWith('/v1/packages/')) return 'api:package';
  if (p.startsWith('/v1/')) return `api:${p.split('/')[2]}`;
  if (p === '/mcp') return 'mcp';
  if (/^\/(npm|pypi|crates)$/.test(p)) return 'page:browse';
  if (/^\/(npm|pypi|crates)\/.+/.test(p)) return 'page:package';
  if (p.startsWith('/models')) return 'page:models';
  if (p.startsWith('/badge/')) return 'badge';
  if (/^\/(docs|changes|status|check|terms|privacy)/.test(p)) return `page:${p.split('/')[1]!.replace('.md', '')}`;
  if (/^\/(sitemap|sitemaps|robots\.txt|llms\.txt|openapi\.json|favicon|\.well-known)/.test(p)) return 'meta';
  return 'other';
}
