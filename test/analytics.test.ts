import { describe, expect, it } from 'vitest';
import { botName, classify, routeGroup } from '../src/analytics.js';

describe('classify (user agents reales de los logs)', () => {
  const cases: Array<[string, string]> = [
    ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', 'ai_crawler'],
    ['Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)', 'ai_crawler'],
    ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ChatGPT-User/1.0; +https://openai.com/bot)', 'ai_user'],
    ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'search_bot'],
    ['Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)', 'search_bot'],
    ['mcpbeat/0.1 (+https://mcpbeat.com/bot/; liveness check)', 'other_bot'],
    ['SentinelOracle/0.1 (+https://glimind.com/opt-out; liveness-oracle)', 'other_bot'],
    ['python-requests/2.33.0', 'script'],
    ['node', 'script'],
    ['curl/8.4.0', 'script'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', 'human'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'human'],
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36', 'other_bot'],
  ];
  for (const [ua, expected] of cases) {
    it(`${expected}: ${ua.slice(0, 50)}`, () => expect(classify(ua)).toBe(expected));
  }
  it('sin user agent', () => expect(classify(undefined)).toBe('unknown'));
});

describe('botName', () => {
  it('extrae el nombre del bot', () => {
    expect(botName('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)')).toBe('ClaudeBot');
    expect(botName('Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)')).toBe('YandexBot');
  });
});

describe('routeGroup', () => {
  it('agrupa rutas en todos los idiomas', () => {
    expect(routeGroup('/')).toBe('home');
    expect(routeGroup('/es/')).toBe('home');
    expect(routeGroup('/ja/npm/@types/node')).toBe('page:package');
    expect(routeGroup('/npm')).toBe('page:browse');
    expect(routeGroup('/v1/packages/npm/express/versions/4.17.1')).toBe('api:version');
    expect(routeGroup('/v1/packages/npm/@types/node')).toBe('api:package');
    expect(routeGroup('/v1/check')).toBe('api:check');
    expect(routeGroup('/mcp')).toBe('mcp');
    expect(routeGroup('/es/check')).toBe('page:check');
    expect(routeGroup('/badge/npm/react/version.svg')).toBe('badge');
  });
});
