# Jarvis — Standalone Deployment Readiness Audit

> **Audit date:** 2026-05-27  
> **Audited branch:** main (commit e05585c)  
> **Scope:** Railway, VPS/Coolify, Docker — read-only analysis, no changes made

---

## Executive Summary

| Platform | Status | Verdict |
|---|---|---|
| Docker (local / compose) | ✅ Ready | All volumes, healthchecks, startup commands in place |
| VPS + Coolify | ✅ Ready (with 2 manual steps) | Best path for 24/7 hosting |
| Railway | ⚠️ Conditional | Needs `JARVIS_TMP_DIR` implemented first |

**Top 3 blockers before any public deployment:**

1. **No authentication** — every `/api` route is publicly accessible
2. **CORS wildcard** — `cors()` with no options allows any origin
3. **`/tmp` PersistentStore not redirectable** — `JARVIS_TMP_DIR` unimplemented (data loss on Railway/Kubernetes)

---

## 1. Docker Readiness

### Status: ✅ Ready

Two production-quality multi-stage Dockerfiles exist:

| File | Image | Description |
|---|---|---|
| `Dockerfile` | `node:24-alpine` → `node:24-alpine` | API server — 4-stage: base → deps → build → production |
| `Dockerfile.frontend` | `node:24-alpine` → `nginx:1.27-alpine` | Frontend — 4-stage: base → deps → build → nginx static |

**What works:**

- `git` installed in the API container (required by dev-agent git routes)
- `corepack` + `pnpm@9` installed via `corepack enable` — exact lockfile reproduced
- `pnpm install --frozen-lockfile` prevents dependency drift
- `devDependencies` deliberately kept in the production API image — required for `GET /api/dev/health` which runs `tsc --noEmit` live
- Source tree copied into production image — required by dev-agent file-read/write routes and the patch system
- `HEALTHCHECK` wired to `GET /api/healthz` with 30s intervals, 15s start period
- `restart: unless-stopped` on all three Compose services
- `@replit/vite-plugin-runtime-error-modal` — **already removed** from `vite.config.ts`. The MIGRATION_PLAN.md warning is outdated; no action needed.
- Remaining Replit plugins (`cartographer`, `devBanner`) are **already guarded** by `process.env.REPL_ID !== undefined` in `vite.config.ts` — they are no-ops outside Replit automatically.

**Minor notes:**

- `Dockerfile` uses `corepack prepare pnpm@9 --activate` — no exact version pin. Harmless for now; pin to `pnpm@9.x.x` for fully reproducible builds.
- Image size: API image ~2 GB uncompressed (includes full `node_modules` + `devDependencies`). Acceptable for a singleton deployment; could be reduced if `tsc` is moved to a separate health binary.

---

## 2. Docker Compose Readiness

### Status: ✅ Ready

`docker-compose.yml` defines 3 services with correct dependency ordering and network isolation:

```
postgres  (internal only)
    ↓ depends_on (healthy)
api       (internal only, port 8080)
    ↓ depends_on (healthy)
web       (nginx, internal + external, port 80 → host)
```

### Named volumes (all storage layers covered)

| Volume | Mounted at | Contents |
|---|---|---|
| `postgres_data` | `/var/lib/postgresql/data` | PostgreSQL WAL + tables |
| `jarvis_tmp` | `/tmp` | `jarvis_*.json` PersistentStore files (11 stores) |
| `jarvis_workspace` | `/workspace/.jarvis` | Pending patches (patch persistence) |
| `jarvis_jarvasdata` | `/workspace/.jarvas-data` | Sessions, KB, LTM, tasks, agents, checkpoints, autonomy queue |

All four storage layers are covered. No data will be lost across container restarts when volumes are mounted correctly.

### nginx configuration (inside `Dockerfile.frontend`)

- `proxy_buffering off` + `X-Accel-Buffering: no` on `/api/` — SSE tokens stream immediately ✅
- `proxy_read_timeout 600s` — handles 10-minute AI completions ✅
- SPA fallback (`try_files $uri $uri/ /index.html`) ✅
- Gzip enabled for `js`, `css`, `woff2`, `json`, `svg` ✅
- Hashed static assets cached `max-age=31536000, immutable` ✅
- `index.html` served `no-store, no-cache` ✅

---

## 3. Required Environment Variables

### API Server — **required** (server crashes without these)

| Variable | Where consumed | Notes |
|---|---|---|
| `PORT` | `artifacts/api-server/src/index.ts` | Hard crash: `"PORT environment variable is required"` |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | `lib/integrations-anthropic-ai/` | Required for all AI routes |
| `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | `lib/integrations-anthropic-ai/` | Set to `https://api.anthropic.com` |
| `DATABASE_URL` | `lib/db/src/index.ts` | Hard crash: `"DATABASE_URL must be set"` |
| `NODE_ENV` | `artifacts/api-server/src/app.ts` | Set to `production` |

### API Server — **optional** (safe defaults exist)

| Variable | Default | Notes |
|---|---|---|
| `SEARCH_API_KEY` | `""` | Brave Search; falls back to Claude training knowledge |
| `LOG_LEVEL` | `info` | Set to `warn` or `error` in production |

### Frontend — **required at BUILD TIME only** (baked into static bundle)

| Variable | Default | Notes |
|---|---|---|
| `PORT` | — | Vite dev server port; hard crash if unset during build |
| `BASE_PATH` | `"/"` | URL prefix baked into bundle; requires rebuild to change |

`BASE_PATH` and `PORT` are **not read at runtime** by the nginx container. They are only consumed by Vite during `pnpm run build`. Changing them after the build requires a full frontend rebuild and re-deploy.

---

## 4. Ports and Startup Commands

### Ports

| Service | Port | Controlled by | Production note |
|---|---|---|---|
| API server (Express) | `8080` | `PORT` env var | Internal only; nginx proxies `/api/*` to it |
| Frontend (nginx) | `80` | Docker host binding (`HTTP_PORT`) | External; TLS terminated upstream |
| Frontend (Vite dev) | Configurable | `PORT` env var | Dev only; not used in production |
| PostgreSQL | `5432` | Docker internal | Never exposed externally |
| Mockup Sandbox | `8081` | `PORT` env var | Dev/design tool — **not required in production** |

### Startup commands

**Full stack (Docker Compose):**
```bash
cp .env.example .env        # fill in real values
docker compose build
docker compose up -d
# One-time only — run DB migrations:
docker compose exec api pnpm --filter @workspace/db run drizzle-kit migrate
```

**API server (bare metal / Railway):**
```bash
pnpm install --frozen-lockfile
pnpm --filter @workspace/api-server run build   # esbuild → dist/index.mjs
PORT=8080 node --enable-source-maps artifacts/api-server/dist/index.mjs
```

**Frontend (bare metal, pre-build static):**
```bash
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/jarvas run build
# Serve artifacts/jarvas/dist/public/ with any static server / nginx
```

**Health verification:**
```bash
curl http://localhost:8080/api/healthz
# → { "status": "ok" }
curl http://localhost:8080/api/dev/server-status
# → { "ok": true, "startedAt": <ms>, "recoveredPatchCount": 0 }
```

---

## 5. Persistent Folders That Must Survive Restarts

All paths are relative to the monorepo root (`/workspace` in Docker).

### Must persist

| Path | Storage type | Content | Loss consequence |
|---|---|---|---|
| `.jarvas-data/sessions/` | File JSON | All conversation sessions (80+ files live) | All chat history lost |
| `.jarvas-data/kb/` | File JSON | Knowledge base notes per session | All KB notes lost |
| `.jarvas-data/ltm/` | File JSON | Long-term memory per session | LTM lost |
| `.jarvas-data/tasks/` | File JSON | Productivity tasks per session | Task history lost |
| `.jarvas-data/agents/` | File JSON | Agent profiles, work orders, executions, outputs | Entire agent history lost |
| `.jarvas-data/checkpoints/` | File JSON | Checkpoint registry | Checkpoint index lost |
| `.jarvas-data/autonomy/` | File JSON | Suggestions, queue items, analysis meta | Improvement queue lost |
| `.jarvas-data/plans/` | File JSON | Multi-agent execution plans | Plan history lost |
| `.jarvas-data/executions/` | File JSON | Execution history | Execution log lost |
| `.jarvas-data/reports/` | Markdown | Generated reports | Reports lost |
| `.jarvas-data/workspace/` | File JSON | Workspace map + last reasoning | Rebuilt on next use |
| `.jarvis/pending_patches.json` | File JSON | Pending code patches awaiting approval | Patches lost on restart |
| `/tmp/jarvis_arch_nodes.json` | File JSON | Architecture graph nodes | Rebuilt over time |
| `/tmp/jarvis_arch_edges.json` | File JSON | Architecture graph edges | Rebuilt over time |
| `/tmp/jarvis_project_memory.json` | File JSON | Project memory | Rebuilt over time |
| `/tmp/jarvis_decision_log.json` | File JSON | Agent decision log | Log lost |
| `/tmp/jarvis_snapshots.json` | File JSON | File snapshot index (pre-patch backups) | Rollback history lost |
| `/tmp/jarvis_exec_state.json` | File JSON | Agent execution state | Lost between restarts |
| `/tmp/jarvis_task_graph.json` | File JSON | Multi-agent task graph | Lost between restarts |
| PostgreSQL | Relational | Conversation messages | All messages lost |

### Docker Compose coverage

All paths above are covered by the four named volumes in `docker-compose.yml`. ✅

### ⚠️ `/tmp` portability warning

The PersistentStore files in `/tmp/jarvis_*.json` are persistent in Docker Compose (via the `jarvis_tmp` volume), but:

- **Railway** — does not support mounting named volumes to `/tmp`; these files will be lost on every deploy or restart
- **Kubernetes** — requires `emptyDir` or `PVC` mounted at `/tmp`; `emptyDir` is ephemeral
- **Bare metal / PM2** — `/tmp` survives process restarts but is cleared on OS reboot

**Mitigation needed:** Implement a `JARVIS_TMP_DIR` environment variable in `lib/dev/tools.ts` (and all other `PersistentStore` instantiation sites) to allow redirecting these files to a configurable persistent path.

---

## 6. Database and Storage Needs

### PostgreSQL

- **Version required:** PostgreSQL ≥ 14 (tested on 16)
- **Schema managed by:** Drizzle ORM — `lib/db/src/schema/`
- **Tables:** `conversations`, `messages` (at minimum)
- **Connection:** `DATABASE_URL=postgresql://user:pass@host:5432/dbname`
- **Migration command:** `pnpm --filter @workspace/db run drizzle-kit migrate`
- **⚠️ Migrations are NOT run automatically on startup** — must be run manually after each schema change

**Managed PostgreSQL options:**

| Platform | Service | Notes |
|---|---|---|
| VPS + Coolify | Coolify-managed PostgreSQL service | One-click setup, volumes auto-configured |
| Railway | Railway PostgreSQL add-on | Provides `DATABASE_URL` automatically |
| VPS self-managed | `postgres:16-alpine` via docker-compose | Requires manual backup setup |
| External managed | Supabase, Neon, Render Postgres | Set `DATABASE_URL` directly |

### File storage

No S3, no object storage, no Redis. The project is fully self-contained using the file system and PostgreSQL. The file-based stores scale to a single instance only (not horizontally scalable without migrating to a shared database).

---

## 7. Railway Readiness

### Status: ⚠️ Conditional — one blocker must be resolved first

**What works on Railway out of the box:**

- `Dockerfile` is Railway-compatible (single service, reads `PORT`, exposes via `EXPOSE 8080`)
- `Dockerfile.frontend` produces a self-contained nginx image; can be deployed as a second Railway service
- Railway's managed PostgreSQL add-on injects `DATABASE_URL` automatically
- Railway supports SSE streaming (no proxy buffering issues)
- `HEALTHCHECK` in Dockerfile is honoured by Railway

**Blockers:**

| Blocker | Severity | Notes |
|---|---|---|
| `/tmp` is ephemeral on Railway | **HIGH** | Named volumes cannot be mounted at `/tmp`; all `jarvis_*.json` PersistentStore files will be wiped on every deploy. Requires `JARVIS_TMP_DIR` to be implemented and set to a Railway persistent volume mount point (e.g. `/data`). |
| Docker Compose not supported | Low | Railway runs single-service containers; deploy `Dockerfile` and `Dockerfile.frontend` as two separate Railway services. API service needs `PORT=8080`; frontend service needs the API's internal URL as an nginx upstream. |
| SSE timeout on Hobby tier | Low | Railway Hobby has a 100 s response timeout. AI completions can exceed this. Use Pro tier or ensure streaming keeps the connection alive. |

**Railway quick-start (once `JARVIS_TMP_DIR` is implemented):**

```
1. Create Railway project
2. Add Railway PostgreSQL add-on → DATABASE_URL auto-injected
3. Add Railway Volume at /data → set JARVIS_TMP_DIR=/data
4. Deploy API service from Dockerfile
   - Set: AI_INTEGRATIONS_ANTHROPIC_API_KEY, AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
            NODE_ENV=production, LOG_LEVEL=warn, JARVIS_TMP_DIR=/data
5. Deploy Frontend service from Dockerfile.frontend
   - Build arg: BASE_PATH=/
6. After first deploy: run drizzle migrations via Railway shell
   → pnpm --filter @workspace/db run drizzle-kit migrate
```

---

## 8. VPS / Coolify Readiness

### Status: ✅ Ready (2 manual steps required)

Coolify supports `docker-compose.yml` deployments directly. No adapter or conversion needed.

**What works:**

- Full `docker-compose.yml` deploys all three services in one command
- Coolify provisions named volumes automatically
- Coolify can manage a PostgreSQL service and inject `DATABASE_URL`
- Coolify supports Let's Encrypt TLS termination
- All healthchecks and restart policies are honoured

**Required manual steps:**

1. **Before first deploy** — copy `.env.example` to `.env` and fill in:
   - `POSTGRES_PASSWORD` (random strong string)
   - `AI_INTEGRATIONS_ANTHROPIC_API_KEY`
   - `AI_INTEGRATIONS_ANTHROPIC_BASE_URL=https://api.anthropic.com`
   - `LOG_LEVEL=warn`
   - `HTTP_PORT=80` (or `443` if TLS is terminated at nginx)

2. **After first deploy** — run database migrations once:
   ```bash
   docker compose exec api pnpm --filter @workspace/db run drizzle-kit migrate
   ```

**Coolify-specific notes:**

- Set "Build command" to `docker compose build`
- Set "Start command" to `docker compose up -d`
- Add the four named volumes in Coolify's volume configuration UI
- Coolify's reverse proxy (Traefik) will handle TLS; set `HTTP_PORT=80` and let Traefik do SSL termination upstream
- The nginx `proxy_pass http://api:8080` relies on Docker's internal DNS — works as-is in Compose networking

---

## 9. Current Blockers Preventing 24/7 Hosting

Ordered by severity:

### 🔴 CRITICAL — Must fix before any public deployment

**1. No authentication on any `/api` endpoint**

```typescript
// artifacts/api-server/src/app.ts — line 53
app.use(cors());  // no auth middleware anywhere
```

Every route — chat, dev agent, file writes, patch application, autonomy cycles, work orders — is publicly accessible to anyone who can reach the server. A single unauthenticated `POST /api/dev/apply` can write arbitrary code to the filesystem.

**Mitigation:** Add an API key middleware (`Authorization: Bearer <key>`) as a minimum before deployment. A proper auth layer (JWT, session, Clerk, etc.) is the correct long-term solution.

---

**2. CORS wildcard**

```typescript
// artifacts/api-server/src/app.ts
app.use(cors());  // no origin restriction
```

`cors()` with no options defaults to `Access-Control-Allow-Origin: *`, allowing any website to make requests to the API from a visitor's browser. In combination with the lack of authentication, this is a significant risk surface.

**Mitigation:** Lock origins to the production domain before deploy:
```typescript
app.use(cors({ origin: "https://your-domain.com" }));
```

---

### 🟠 HIGH — Fix before going live

**3. `/tmp` PersistentStore files cannot be redirected (Railway + Kubernetes)**

`JARVIS_TMP_DIR` is documented in `MIGRATION_PLAN.md` as a future improvement but is not yet implemented. All `new PersistentStore(...)` calls in the codebase write to `/tmp/jarvis_*.json` with no path override.

Live `/tmp` stores on this instance: `jarvis_arch_edges.json`, `jarvis_arch_nodes.json`, `jarvis_project_memory.json` (and others created at runtime).

On VPS + Docker Compose this is handled by the `jarvis_tmp` named volume. On Railway or bare-metal restarts it is not.

---

**4. drizzle-kit migrations not automated**

Migrations must be run manually after every schema change. If a deploy happens without running migrations, the API server will crash with a `column does not exist` error.

**Mitigation:** Add a startup script that runs `drizzle-kit migrate` before `node ./dist/index.mjs`:
```bash
# startup.sh
pnpm --filter @workspace/db run drizzle-kit migrate && node --enable-source-maps ./dist/index.mjs
```

---

### 🟡 MEDIUM — Fix before scaling or production hardening

**5. Rate limiting absent on `/api/chat/stream`**

The SSE chat endpoint makes an Anthropic API call for every request. No rate limiting, no per-IP throttling, no token budget enforcement at the HTTP layer. A single unauthenticated client can exhaust the Anthropic API budget in minutes.

**Mitigation:** Add `express-rate-limit` on `/api/chat/*` and `/api/dev/stream`.

---

**6. Log volume unbounded**

Default `LOG_LEVEL` in `.env.example` is `warn`, but `pino-http` logs every request at `info` level by default. In production this can generate substantial log volume. Set `LOG_LEVEL=warn` and configure Docker's `json-file` driver with `max-size` and `max-file` limits.

---

### 🔵 INFO — Known, intentional, or low priority

**7. devDependencies in production API image**

The production API image includes TypeScript, type definitions, and vitest in `node_modules`. This is intentional: `GET /api/dev/health` runs `tsc --noEmit` against the source tree. The image is ~2 GB uncompressed as a result. For a singleton deploy this is acceptable; for a minimal image the health check would need to be reimplemented without `tsc`.

**8. Source tree in production image**

`artifacts/api-server/src/` is copied into the production image (also intentional). The dev agent reads and writes project source files by filesystem path. On production deployments where self-modification is not desired, this can be omitted — but it would disable all dev-agent routes.

**9. `pnpm@9` not pinned to a patch version**

`corepack prepare pnpm@9 --activate` installs the latest `9.x.x`. Pin to a specific patch (e.g. `pnpm@9.15.4`) for reproducible builds.

**10. `@replit/vite-plugin-runtime-error-modal` — already removed**

`MIGRATION_PLAN.md` lists this as a required action, but it was already removed from `vite.config.ts`. No action needed. The remaining Replit plugins (`cartographer`, `devBanner`) are guarded by `REPL_ID` and are no-ops in production.

---

## 10. Safest Recommended Deployment Path

### Recommendation: VPS + Coolify + Docker Compose

This is the path that requires the fewest changes, has the best data-safety story, and can be operational in under an hour.

**Why:**
- `docker-compose.yml` is already production-quality — all volumes, healthchecks, networks, and restart policies configured
- All four persistent storage layers (PostgreSQL, `/tmp`, `.jarvis/`, `.jarvas-data/`) are mounted as named volumes
- Coolify provides TLS, reverse proxy, domain binding, and deployment webhooks with no additional configuration
- Railway is viable but requires `JARVIS_TMP_DIR` to be implemented first to avoid silent data loss

**Suggested order of operations:**

```
[ ] 1. Provision a VPS (≥ 2 GB RAM, ≥ 20 GB disk) + install Docker + Coolify
[ ] 2. Point DNS A record at VPS IP; configure domain in Coolify
[ ] 3. Clone repo: git clone <repo> /srv/jarvis
[ ] 4. cp .env.example .env && fill in all required values
[ ] 5. Lock CORS to production domain in artifacts/api-server/src/app.ts
[ ] 6. Add an API key middleware (minimum auth before go-live)
[ ] 7. docker compose build
[ ] 8. docker compose up -d
[ ] 9. docker compose exec api pnpm --filter @workspace/db run drizzle-kit migrate
[  ] 10. curl https://your-domain.com/api/healthz  →  { "status": "ok" }
[ ] 11. Set up daily backup cron (see MIGRATION_PLAN.md §13)
[ ] 12. Configure Uptime Robot or Grafana alerting on /api/healthz
```

**Minimum viable server spec:**

| Resource | Minimum | Recommended |
|---|---|---|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 2 GB | 4 GB |
| Disk | 20 GB | 40 GB |
| OS | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |
| Docker | 24+ | 26+ |

---

## 11. Pre-Deployment Checklist

```
Security
[ ] API key / auth middleware added to app.ts
[ ] cors() options locked to production domain
[ ] .env added to .gitignore (never committed)
[ ] NODE_ENV=production
[ ] LOG_LEVEL=warn
[ ] PostgreSQL not exposed on public port

Data integrity
[ ] All four named volumes mounted in docker-compose.yml  ← already done
[ ] drizzle-kit migrate run after first deploy
[ ] Daily backup cron scheduled (see MIGRATION_PLAN.md §13)

Reliability
[ ] restart: unless-stopped on all services  ← already done
[ ] /api/healthz wired into uptime monitor
[ ] Docker log rotation configured (json-file max-size: 100m, max-file: 3)

Performance
[ ] proxy_buffering off for SSE  ← already done in nginx config
[ ] proxy_read_timeout ≥ 300s  ← already 600s

Railway-specific (only if choosing Railway)
[ ] JARVIS_TMP_DIR implemented in all PersistentStore instantiation sites
[ ] JARVIS_TMP_DIR set to a Railway persistent volume mount path
[ ] Railway Pro tier (for >100s SSE connections)
```

---

*Report generated by audit scan of commit e05585c. No files were modified.*
