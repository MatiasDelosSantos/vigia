# Vigía (MVP)

Hechos verificados y fechados sobre el estado del software (npm, PyPI) y de los modelos de IA, para agentes.
Producción: https://vigia.coredls.cloud · MCP: `https://vigia.coredls.cloud/mcp`

## Qué hace sola
- **Worker**: revisa ~10.000 paquetes semilla según popularidad (npm cada 15 min–2 h con ETag; PyPI con feed RSS + sondeo), el catálogo de modelos de OpenRouter cada 15 min, y registra cada cambio (hechos bitemporales + changefeed).
- **Cobertura por demanda**: un paquete consultado por la API o el MCP que no estaba en seguimiento se resuelve en vivo y queda seguido.

## Desarrollo
```bash
npm install
npm test            # tests unitarios
npm run typecheck
```

## Despliegue (VPS, /opt/vigia)
```bash
git archive --format=tar HEAD | ssh root@76.13.235.122 'tar xf - -C /opt/vigia && cd /opt/vigia && docker compose build -q && docker compose up -d'
```
- `.env` vive sólo en el VPS (contraseña de la base generada al instalar). Plantilla: `.env.example`.
- Nginx: `deploy/nginx-vigia.conf` → `/etc/nginx/sites-available/vigia` (rate limit por IP + micro-caché). Certificado Let's Encrypt propio con renovación automática.
- Contenedores: `vigia-db` (127.0.0.1:5435), `vigia-api` (127.0.0.1:3005), `vigia-worker`, con límites de memoria/CPU.

## Idiomas
Páginas HTML y documentación en 18 idiomas: en (raíz, canónico/x-default), es, pt, fr, de, it, nl, pl, ru, uk, tr, ar (RTL), hi, id, vi, ja, ko, zh (zh-Hans), bajo `/{código}/...`.
Diccionarios en `src/i18n/*.ts` (TypeScript exige todas las claves; `test/i18n.test.ts` verifica los marcadores `{var}`).
Cada página declara `hreflang` para todas las versiones; `sitemap.xml` es un índice con un sitemap por idioma.
Las respuestas para máquinas (JSON, MCP, `.md` de paquetes) quedan en inglés: son independientes del idioma.
Para agregar un idioma: crear `src/i18n/xx.ts` y sumarlo en `src/i18n/index.ts` (e incrementar la clave de estado en `src/indexnow.ts` para renotificar).

## Descubrimiento
- **Registro oficial MCP**: publicado como `cloud.coredls.vigia/vigia` (autenticación por dominio vía HTTP).
  La clave privada y el binario `mcp-publisher` están en el VPS en `/opt/vigia-registry` (permisos 700); la pública se sirve en
  `/.well-known/mcp-registry-auth` desde `/var/www/vigia-wellknown/`. Para publicar una versión nueva: subir `version` en
  `server.json`, copiarlo a `/opt/vigia-registry/` y correr allí `login http` + `publish` (ver historial del proyecto).
- **IndexNow**: el worker notifica cada 30 min las páginas nuevas o cambiadas (clave en `INDEXNOW_KEY` del `.env` del VPS).
- **Server card**: `/.well-known/mcp/server-card.json` · **llms.txt**, **sitemap.xml**, **openapi.json**.

## Operación
```bash
ssh root@76.13.235.122 'docker logs --tail 50 vigia-worker'
curl https://vigia.coredls.cloud/v1/stats
```
Para ampliar cobertura: subir `SEED_NPM_LIMIT` / `SEED_PYPI_LIMIT` en `/opt/vigia/.env` y `docker compose up -d`.
