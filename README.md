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

## Operación
```bash
ssh root@76.13.235.122 'docker logs --tail 50 vigia-worker'
curl https://vigia.coredls.cloud/v1/stats
```
Para ampliar cobertura: subir `SEED_NPM_LIMIT` / `SEED_PYPI_LIMIT` en `/opt/vigia/.env` y `docker compose up -d`.
