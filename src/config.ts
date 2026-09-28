const env = process.env;

export const config = {
  databaseUrl: env.DATABASE_URL ?? 'postgres://vigia:vigia@localhost:5432/vigia',
  port: Number(env.PORT ?? 3005),
  publicUrl: (env.PUBLIC_URL ?? 'http://localhost:3005').replace(/\/$/, ''),
  userAgent: env.USER_AGENT ?? 'VigiaBot/0.1 (+https://vigia.coredls.cloud/bot)',
  /** Tamaño de las listas semilla (se pueden ampliar sin redeploy cambiando la variable). */
  seedNpmLimit: Number(env.SEED_NPM_LIMIT ?? 5000),
  seedPypiLimit: Number(env.SEED_PYPI_LIMIT ?? 5000),
  /** Requests concurrentes por host externo: somos huéspedes de registries públicos. */
  hostConcurrency: { 'registry.npmjs.org': 4, 'pypi.org': 2, 'api.deps.dev': 2, 'openrouter.ai': 1 } as Record<string, number>,
  /** Máximo de paquetes desconocidos a resolver en vivo por request de /v1/check. */
  liveResolveLimit: Number(env.LIVE_RESOLVE_LIMIT ?? 40),
};
