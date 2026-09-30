-- Métricas de uso agregadas por día (sin datos personales).
CREATE TABLE usage_daily (
  day  date   NOT NULL,
  dim  text   NOT NULL,   -- client | bot | page | referrer | api | mcp | mcp_client | checker | badge
  key  text   NOT NULL,
  n    bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (day, dim, key)
);

-- Visitantes humanos únicos por día: hash salado de IP + user agent + día (no reversible; no se guarda la IP).
CREATE TABLE visitor_daily (
  day date NOT NULL,
  h   text NOT NULL,
  PRIMARY KEY (day, h)
);
