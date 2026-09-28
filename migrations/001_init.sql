-- Vigía: esquema inicial (MVP).
-- Hechos bitemporales simplificados:
--   valid_from      = desde cuándo es verdad en el mundo (p. ej. fecha de publicación de la versión)
--   recorded_from/to = durante qué intervalo Vigía afirmó ese valor (permite consultas as_of)

CREATE TABLE entity (
  id               bigserial PRIMARY KEY,
  type             text NOT NULL,              -- package | model | feed
  ecosystem        text NOT NULL,              -- npm | pypi | ai | system
  name             text NOT NULL,
  key              text NOT NULL UNIQUE,       -- 'npm:next', 'pypi:requests', 'model:openai/gpt-x', 'feed:pypi-rss'
  attrs            jsonb NOT NULL DEFAULT '{}',-- datos descriptivos no versionados (descripción, repo, etags)
  popularity_rank  integer,                    -- 1 = más popular (según la lista semilla)
  tracked          boolean NOT NULL DEFAULT true,
  origin           text NOT NULL DEFAULT 'seed', -- seed | demand | feed
  check_interval_s integer NOT NULL DEFAULT 3600,
  next_check_at    timestamptz NOT NULL DEFAULT now(),
  last_checked_at  timestamptz,
  last_changed_at  timestamptz,
  error_count      integer NOT NULL DEFAULT 0,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entity_due ON entity (next_check_at) WHERE tracked;
CREATE INDEX entity_eco_name ON entity (ecosystem, name);
CREATE INDEX entity_name_prefix ON entity (lower(name) text_pattern_ops);

CREATE TABLE fact (
  id               bigserial PRIMARY KEY,
  hash             text NOT NULL UNIQUE,       -- permalink estable: /v1/facts/{hash}
  entity_id        bigint NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  predicate        text NOT NULL,
  value            jsonb NOT NULL,
  valid_from       timestamptz,
  recorded_from    timestamptz NOT NULL DEFAULT now(),
  recorded_to      timestamptz,
  method           text NOT NULL,              -- registry | registry+depsdev | aggregator
  confidence       real NOT NULL,
  source_url       text NOT NULL,
  source_sha256    text,                       -- hash del cuerpo de la respuesta de la fuente
  last_verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX fact_current ON fact (entity_id, predicate) WHERE recorded_to IS NULL;
CREATE INDEX fact_history ON fact (entity_id, predicate, recorded_from);

CREATE TABLE change_event (
  seq                 bigserial PRIMARY KEY,   -- cursor del changefeed
  entity_id           bigint NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  predicate           text NOT NULL,
  kind                text NOT NULL,
  old_value           jsonb,
  new_value           jsonb,
  detected_at         timestamptz NOT NULL DEFAULT now(),
  source_published_at timestamptz              -- para medir el lag de detección
);
CREATE INDEX change_event_entity ON change_event (entity_id, seq DESC);

CREATE TABLE demand_signal (
  key          text PRIMARY KEY,
  hits         integer NOT NULL DEFAULT 1,
  found        boolean NOT NULL,
  first_hit_at timestamptz NOT NULL DEFAULT now(),
  last_hit_at  timestamptz NOT NULL DEFAULT now()
);
