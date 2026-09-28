-- Estado interno pequeño (p. ej. última notificación a IndexNow).
CREATE TABLE kv (
  k          text PRIMARY KEY,
  v          jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
