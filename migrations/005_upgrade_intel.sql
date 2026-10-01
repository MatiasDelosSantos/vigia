-- Requisitos declarados por cada versión (base de "¿qué versión es compatible con Node 18 / React 18 / Python 3.8?").
ALTER TABLE package_version
  ADD COLUMN engines         jsonb,   -- npm: engines (p. ej. {"node": ">=18"})
  ADD COLUMN peer            jsonb,   -- npm: peerDependencies
  ADD COLUMN requires_python text,    -- PyPI: Requires-Python
  ADD COLUMN deprecated_msg  text;    -- npm: mensaje de deprecación de esa versión

-- Superficie de API pública de una versión (exports de sus tipos TypeScript) + changelog que trae el paquete.
CREATE TABLE api_snapshot (
  entity_id   bigint NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  version     text NOT NULL,
  status      text NOT NULL,          -- ok | no_types | too_large | error
  source      text,                   -- 'package' o '@types/x@1.2.3'
  entry       text,                   -- archivo de tipos analizado
  surface     jsonb,                  -- { exports: { name: { kind, sig, dep?, members? } } }
  changelog   jsonb,                  -- [{ version, text }] (texto de terceros, no confiable)
  error       text,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_id, version)
);

-- Cola de análisis pesados (descarga de tarballs + análisis de tipos), procesada por el worker de a uno.
CREATE TABLE analysis_job (
  key        text PRIMARY KEY,         -- 'snapshot:npm:next@15.0.0'
  kind       text NOT NULL,
  payload    jsonb NOT NULL,
  status     text NOT NULL DEFAULT 'queued',  -- queued | running | done | failed
  priority   integer NOT NULL DEFAULT 100,    -- menor = antes (pedidos de usuarios < pregeneración)
  attempts   integer NOT NULL DEFAULT 0,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analysis_job_queue ON analysis_job (priority, created_at) WHERE status = 'queued';
