-- Historial completo de versiones por paquete (base de las señales de mantenimiento y de la consulta por versión).
CREATE TABLE package_version (
  entity_id    bigint NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  version      text NOT NULL,
  published_at timestamptz,
  prerelease   boolean NOT NULL DEFAULT false,
  withdrawn    boolean NOT NULL DEFAULT false,  -- npm: deprecated · PyPI: yanked
  PRIMARY KEY (entity_id, version)
);
CREATE INDEX package_version_recent ON package_version (entity_id, published_at DESC);

-- Caché de consultas a OSV (vulnerabilidades por versión exacta).
CREATE TABLE osv_cache (
  k          text PRIMARY KEY,
  v          jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
