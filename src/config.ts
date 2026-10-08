const env = process.env;

export const config = {
  databaseUrl: env.DATABASE_URL ?? 'postgres://vigia:vigia@localhost:5432/vigia',
  port: Number(env.PORT ?? 3005),
  publicUrl: (env.PUBLIC_URL ?? 'http://localhost:3005').replace(/\/$/, ''),
  userAgent: env.USER_AGENT ?? 'VigiaBot/0.1 (+https://vigia.coredls.cloud/bot)',
  /** Tamaño de las listas semilla (se pueden ampliar sin redeploy cambiando la variable). */
  seedNpmLimit: Number(env.SEED_NPM_LIMIT ?? 5000),
  seedPypiLimit: Number(env.SEED_PYPI_LIMIT ?? 5000),
  seedCratesLimit: Number(env.SEED_CRATES_LIMIT ?? 3000),
  seedPackagistLimit: Number(env.SEED_PACKAGIST_LIMIT ?? 3000),
  /** Requests concurrentes por host externo: somos huéspedes de registries públicos. */
  hostConcurrency: { 'registry.npmjs.org': 4, 'pypi.org': 2, 'api.deps.dev': 2, 'openrouter.ai': 1, 'crates.io': 1, 'repo.packagist.org': 3, 'packagist.org': 1 } as Record<string, number>,
  /** Milisegundos mínimos entre requests por host. */
  hostGapMs: { 'crates.io': 1100, 'packagist.org': 600 } as Record<string, number>,
  /** Clave de IndexNow (32 hex). Vacía = desactivado. */
  indexNowKey: /^[a-f0-9]{32}$/.test(env.INDEXNOW_KEY ?? '') ? env.INDEXNOW_KEY! : '',
  /** Máximo de paquetes desconocidos a resolver en vivo por request de /v1/check. */
  liveResolveLimit: Number(env.LIVE_RESOLVE_LIMIT ?? 40),
};
