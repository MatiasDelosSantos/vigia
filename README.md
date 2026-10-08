# Vigia — what breaks when you upgrade, before your agent writes the code

**Vigia** is a free, open data service (REST API + MCP server) that gives AI coding agents and developers **verified, dated facts about the state of npm, PyPI and Rust (crates.io) packages** — the things language models get wrong because their training data is out of date.

🌐 **https://vigia.coredls.cloud** · MCP: `https://vigia.coredls.cloud/mcp` · Registry: `cloud.coredls.vigia/vigia`

```bash
claude mcp add --transport http vigia https://vigia.coredls.cloud/mcp
```

Or install it as a **Claude Code plugin**, which bundles the MCP server and a skill that tells the agent when to use it:

```text
/plugin marketplace add MatiasDelosSantos/vigia
/plugin install vigia@vigia
```

Other agents can use the skill directly: [`skills/vigia/SKILL.md`](skills/vigia/SKILL.md) (also served at https://vigia.coredls.cloud/skill.md).

**One-click install:** [Cursor](https://vigia.coredls.cloud/#agent) · [VS Code](https://vigia.coredls.cloud/#agent)

## Why

Models freeze at their training cutoff; ecosystems ship thousands of releases a day. Agents confidently write code against APIs that changed. Example — **Next.js 14 → 15**, detected automatically from the packages' TypeScript types:

```text
GET /v1/packages/npm/next/upgrade?from=14&to=15

next/headers · cookies   (): ReadonlyRequestCookies   →   (): Promise<ReadonlyRequestCookies>
next/headers · headers   (): ReadonlyHeaders          →   (): Promise<ReadonlyHeaders>
+ new module: next/form
summary: 4 removed exports · 10 changed signatures · 16 changed/removed members · 5 new deprecations
```

## What it answers (that nothing else does in one call)

| Question | REST | MCP tool |
|---|---|---|
| **What breaks if I upgrade X from A to B?** Removed exports and import paths, changed signatures and class members, new `@deprecated`, `engines`/`peerDependencies` changes, changelog in between | `GET /v1/packages/npm/{name}/upgrade?from=14&to=15` | `upgrade_impact` |
| **Does this API exist in this version?** Exact signature, import path, deprecation message, "did you mean" | `GET /v1/packages/npm/{name}/symbols/{symbol}?version=15` | `symbol_status` |
| **Newest version that works with Node 18 / React 18 / Python 3.8?** Uses the requirements declared by *each* version | `GET /v1/packages/{npm\|pypi}/{name}/compatible?with=node@18,react@18` | `find_compatible_version` |
| **Is my exact version vulnerable? Nearest fixed version?** (OSV) | `GET /v1/packages/{eco}/{name}/versions/{version}` | `version_status` |
| Latest version, deprecation, runtime requirements, peers, license | `GET /v1/packages/{eco}/{name}` | `package_status` |
| Check a whole `package.json` / `requirements.txt` | `POST /v1/check` | `check_dependencies` |
| **Is this Python / Node / PHP / Java / Django / Ubuntu... version still supported? When does it reach end of life?** (~480 products) | `GET /v1/eol/{product}/{version}` | `eol_status` |
| AI model prices, context windows, retirement dates | `GET /v1/models` | `model_info` |

Every response includes **when it was verified and where the data came from**. Full spec: [`/openapi.json`](https://vigia.coredls.cloud/openapi.json) · Docs in 18 languages: [`/docs`](https://vigia.coredls.cloud/docs).

## GitHub Action

Flags outdated, deprecated and vulnerable dependencies on every pull request:

```yaml
name: dependencies
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  vigia:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: MatiasDelosSantos/vigia@v1
        with:
          fail-on: vulnerable                        # optional: vulnerable, deprecated, major, outdated
          github-token: ${{ secrets.GITHUB_TOKEN }}  # optional: comment on the PR
```

## Badges

```markdown
[![version](https://vigia.coredls.cloud/badge/npm/react/version.svg)](https://vigia.coredls.cloud/npm/react)
[![maintained](https://vigia.coredls.cloud/badge/npm/react/maintained.svg)](https://vigia.coredls.cloud/npm/react)
```

## How it works

- **Registries are the source of truth.** npm, PyPI and crates.io metadata with ETags, publish dates and per-version requirements (engines, Requires-Python, rust-version); deps.dev for npm history; OSV for vulnerabilities; OpenRouter for AI models.
- **API surface analysis never executes package code.** Tarballs are downloaded, only `.d.ts`, `package.json` and changelogs are extracted, and the TypeScript compiler API reads the exported declarations in an isolated worker thread with memory and time limits. Packages without bundled types fall back to `@types/*`.
- **Facts are never overwritten.** Each change closes the previous value (bitemporal history), so `?as_of=` can answer "what did Vigia say on date X".
- **Self-updating.** A worker tracks ~34,000 popular packages (npm every 15 min–2 h; PyPI via its update feed; the top 3,000 Rust crates from crates.io), resolves unknown packages on first request, and pre-computes upgrade reports for the 300 most popular npm packages.

Stack: TypeScript, Node 22, Hono, PostgreSQL 17, MCP SDK, Docker.

## Run it yourself

```bash
cp .env.example .env          # set POSTGRES_PASSWORD and PUBLIC_URL
docker compose up -d          # vigia-db, vigia-api (:3005), vigia-worker
npm install && npm test       # 70 unit tests
```

## Data license & privacy

Vigia's compiled data is **CC-BY-4.0** (attribute "Vigia"); upstream data keeps each source's terms. Manifests sent to `/v1/check` are not stored; no cookies or trackers. See [terms](https://vigia.coredls.cloud/terms) and [privacy](https://vigia.coredls.cloud/privacy).

## License

Code: [AGPL-3.0](LICENSE). Operations notes (Spanish): [docs/OPERACION.es.md](docs/OPERACION.es.md).
