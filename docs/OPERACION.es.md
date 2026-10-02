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
git archive --format=tar HEAD | ssh root@<IP_DEL_VPS> 'tar xf - -C /opt/vigia && cd /opt/vigia && docker compose build -q && docker compose up -d'
```
- `.env` vive sólo en el VPS (contraseña de la base generada al instalar). Plantilla: `.env.example`.
- Nginx: `deploy/nginx-vigia.conf` → `/etc/nginx/sites-available/vigia` (rate limit por IP + micro-caché). Certificado Let's Encrypt propio con renovación automática.
- Contenedores: `vigia-db` (127.0.0.1:5435), `vigia-api` (127.0.0.1:3005), `vigia-worker`, con límites de memoria/CPU.

## Datos por versión
- `package_version`: historial completo (npm desde deps.dev, PyPI desde su API JSON); base de las señales de mantenimiento (heurística por fechas de versiones estables).
- Vulnerabilidades por versión exacta desde OSV (`osv_cache`, 6 h) con la menor versión que corrige todas (`nearest_fixed_version`).
- `/v1/check` informa además las vulnerabilidades de la versión mínima que admite cada rango.

## SEO
- Páginas índice por popularidad (`/{idioma}/npm`, `/{idioma}/pypi`), migas de pan, FAQ con `FAQPage`, paquetes relacionados, favicon, Open Graph, `/status`, `/terms`, `/privacy`.
- Indexación por etapas: el sitemap en inglés lleva todos los paquetes; cada traducción, sólo el top `SITEMAP_LOCALIZED_TOP` (300) por ecosistema. Subirlo en el `.env` cuando Google indexe bien.
- Google Search Console verificado (cuenta dlsantos.matias@gmail.com) con el archivo servido por Nginx; sitemap enviado.

## Inteligencia de actualización (lo diferencial)
- **Qué se rompe entre dos versiones** (`GET /v1/packages/npm/{name}/upgrade?from=14&to=15`, MCP `upgrade_impact`):
  exports y rutas de importación eliminados, firmas y miembros de clases/interfaces cambiados, nuevas deprecaciones
  (`@deprecated` en los tipos), cambios de `engines`/`peerDependencies` y secciones del CHANGELOG entre versiones.
- **¿Existe esta API en esta versión?** (`GET /v1/packages/npm/{name}/symbols/{símbolo}?version=`, MCP `symbol_status`):
  firma exacta, desde dónde importarla, si está deprecada; sugiere nombres parecidos si no existe.
- **Versión compatible más nueva** (`GET /v1/packages/{eco}/{name}/compatible?with=node@18,react@18|python@3.8`,
  MCP `find_compatible_version`), usando los requisitos declarados por **cada** versión (`package_version.engines/peer/requires_python`).
- **Cómo funciona**: el worker descarga el tarball (nunca ejecuta nada), extrae sólo `.d.ts`, `package.json` y changelog
  (`src/tarball.ts`), y analiza los exports con la API de TypeScript 5.9 (`ts-api`, alias de npm; TS 7 no expone API)
  en un hilo aislado con límite de 640 MB y 120 s (`src/apisurface.ts`, `src/surface-worker.ts`). Si el paquete no trae
  tipos, usa `@types/<nombre>` de la misma versión mayor. Las "fotos" quedan en `api_snapshot`; la cola es `analysis_job`
  (prioridad 10 para pedidos de usuarios, 200 para pregeneración del top 300 cada 6 h).
- **Guías públicas**: `/upgrade/npm/{name}/{a}-to-{b}` en 18 idiomas, índice en `/upgrade`, en sitemaps.
- Prueba manual del analizador: `npx tsx scripts/try-surface.ts next 15.0.0 cookies`.

## Revisor web, badges y GitHub Action
- **Revisor web**: `/check` (y `/{idioma}/check`): pegar un package.json o requirements.txt; nada se guarda.
- **Badges**: `/badge/{npm|pypi}/{nombre}/{version|maintained|status}.svg`; cada página de paquete muestra el Markdown para copiar.
- **GitHub Action** (`action.yml` + `action/check.mjs`, sin dependencias). Uso, cuando el repositorio sea público:

```yaml
permissions:
  contents: read
  pull-requests: write
steps:
  - uses: actions/checkout@v4
  - uses: MatiasDelosSantos/vigia@v1
    with:
      fail-on: vulnerable        # opcional: vulnerable, deprecated, major, outdated
      github-token: ${{ secrets.GITHUB_TOKEN }}   # opcional: comenta en el PR
```

## Medición de uso
- Cada request se clasifica (personas, buscadores, crawlers de IA, agentes de IA, monitores, scripts); también se registran
  métodos/herramientas/clientes MCP, rutas de la API, usos del revisor y de los badges. Agregado por día en `usage_daily`;
  visitantes únicos con hash salado (`visitor_daily`), sin guardar IPs.
- Panel privado: `https://vigia.coredls.cloud/admin/stats` (usuario `admin`). La contraseña está en el `.env` del VPS:
  `ssh root@<IP_DEL_VPS> "grep ADMIN_PASSWORD /opt/vigia/.env"`.

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
ssh root@<IP_DEL_VPS> 'docker logs --tail 50 vigia-worker'
curl https://vigia.coredls.cloud/v1/stats
```
Para ampliar cobertura: subir `SEED_NPM_LIMIT` / `SEED_PYPI_LIMIT` en `/opt/vigia/.env` y `docker compose up -d`.
