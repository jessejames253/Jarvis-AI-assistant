# Jarvis — Migration Plan (Replit → Self-Hosted)

> **Phase 7A** | Created: 2026-05-26
> **Goal:** Move Jarvis off Replit onto any always-on Linux host (VPS, cloud VM, Kubernetes, etc.) without changing core runtime behaviour.

---

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [Replit-Specific Dependencies](#2-replit-specific-dependencies)
3. [Environment Variables](#3-environment-variables)
4. [Startup Commands](#4-startup-commands)
5. [Ports](#5-ports)
6. [Persistent Storage](#6-persistent-storage)
7. [API Routes](#7-api-routes)
8. [SSE / WebSocket Usage](#8-sse--websocket-usage)
9. [Patch Persistence](#9-patch-persistence)
10. [Agent & Runtime Assumptions](#10-agent--runtime-assumptions)
11. [Migration Steps](#11-migration-steps)
12. [Production Readiness Checklist](#12-production-readiness-checklist)
13. [Backup & Export Instructions](#13-backup--export-instructions)
14. [Known Post-Migration Work](#14-known-post-migration-work)

---

## 1. Project Structure

```
/workspace
├── artifacts/
│   ├── api-server/         # Express + Node.js backend
│   │   ├── src/            # TypeScript source
│   │   ├── dist/           # Compiled output (esbuild → ESM)
│   │   ├── build.mjs       # esbuild bundler script
│   │   └── package.json
│   ├── jarvas/             # React + Vite frontend
│   │   ├── src/
│   │   ├── dist/public/    # Static build output (served by nginx)
│   │   └── package.json
│   └── mockup-sandbox/     # Design tool (dev-only, not needed in prod)
├── lib/
│   ├── api-zod/            # Shared Zod schemas
│   ├── db/                 # Drizzle ORM + PostgreSQL schema
│   └── integrations-anthropic-ai/  # Anthropic API client
├── scripts/
│   └── post-merge.sh       # Replit-only post-merge hook (skip in prod)
├── Dockerfile              # API server image
├── Dockerfile.frontend     # Frontend image (nginx)
├── docker-compose.yml      # Full-stack orchestration
├── .env.example            # All required env vars (no real values)
└── pnpm-workspace.yaml
```

---

## 2. Replit-Specific Dependencies

### 2a. Vite Plugins (frontend only)

| Plugin | Used where | Behaviour outside Replit |
|---|---|---|
| `@replit/vite-plugin-runtime-error-modal` | `artifacts/jarvas/vite.config.ts` | Always loaded — safe to remove in prod |
| `@replit/vite-plugin-cartographer` | Same — **guarded** by `REPL_ID !== undefined` | Only activates on Replit; skipped automatically elsewhere |
| `@replit/vite-plugin-dev-banner` | Same — **guarded** by `REPL_ID !== undefined` | Same — skipped automatically elsewhere |

**Action required for production frontend builds:** Remove `@replit/vite-plugin-runtime-error-modal` from `artifacts/jarvas/vite.config.ts`. The Cartographer and DevBanner plugins are already auto-guarded and will not load when `REPL_ID` is unset.

### 2b. Configuration Files (Replit-only, do not copy)

| File | Purpose | Action |
|---|---|---|
| `.replit` | Port binding, workflow runner | **Ignore** |
| `replit.md` | Dev documentation | Keep as reference, do not deploy |
| `scripts/post-merge.sh` | Replit merge hook | **Ignore** |

### 2c. Runtime Environment

Replit sets `PORT` per service automatically. On self-hosted infrastructure you must set `PORT` yourself for each process (see §5).

---

## 3. Environment Variables

All variables are documented in `.env.example`. Summary:

### Required — API Server

| Variable | Description | Example |
|---|---|---|
| `PORT` | TCP port the API server listens on | `8080` |
| `NODE_ENV` | Runtime mode | `production` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@db:5432/jarvis` |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | Anthropic API key | `sk-ant-...` |
| `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | Anthropic API base URL | `https://api.anthropic.com` |

### Optional — API Server

| Variable | Description | Default |
|---|---|---|
| `SEARCH_API_KEY` | Brave Search API key (enables live web search) | `""` (falls back to Claude training knowledge) |
| `LOG_LEVEL` | Pino log level | `info` |
| `JARVIS_DATA_DIR` | (Future) override for data directory | See §6 |

### Required — Frontend Build

| Variable | Description | Example |
|---|---|---|
| `PORT` | Vite dev server port (dev only) | `3000` |
| `BASE_PATH` | URL base path prefix (must match nginx location) | `/` |

> **Note:** `BASE_PATH` and `PORT` are consumed at **build time** by Vite. The built static files encode the base path; changing it after the build requires a rebuild.

---

## 4. Startup Commands

### Full workspace (monorepo)

```bash
# Install all dependencies (run once, or after package changes)
pnpm install --frozen-lockfile

# Build all shared packages + all artifacts
pnpm run build

# Run database migrations (required before first start and after schema changes)
cd lib/db && pnpm drizzle-kit migrate
```

### API Server (production)

```bash
cd artifacts/api-server
pnpm run build        # compile TypeScript → dist/index.mjs
pnpm run start        # node --enable-source-maps ./dist/index.mjs
```

### API Server (development, auto-rebuilds on changes)

```bash
cd artifacts/api-server
pnpm run dev          # export NODE_ENV=development && pnpm run build && pnpm run start
```

### Frontend (production static build)

```bash
cd artifacts/jarvas
PORT=3000 BASE_PATH=/ pnpm run build    # outputs to dist/public/
# Then serve dist/public/ with nginx (see docker-compose.yml)
```

### Frontend (development Vite dev server)

```bash
cd artifacts/jarvas
PORT=3000 BASE_PATH=/ pnpm run dev
```

---

## 5. Ports

| Service | Internal Port | Env Var | Notes |
|---|---|---|---|
| API Server (Express) | `8080` | `PORT=8080` | REST + SSE endpoints under `/api` |
| Frontend (Vite dev) | `3000` | `PORT=3000` | Dev only; replaced by nginx in prod |
| Frontend (nginx prod) | `80` / `443` | — | Serves `dist/public/`; proxies `/api` to API server |
| PostgreSQL | `5432` | — | Standard PG port |
| Mockup Sandbox | `20229` | `PORT=20229` | Dev/design tool, not required in prod |

**Replit port mapping (reference only):**
- `8080 → 8080` (API server external access)
- `8081 → 80` (frontend via proxy)
- `20229 → 3000` (mockup sandbox)

---

## 6. Persistent Storage

The project uses **three storage layers**. All must survive container/process restarts.

### 6a. PostgreSQL (primary relational store)

- **Schema:** `lib/db/src/schema/` — `conversations.ts`, `messages.ts`
- **Managed via:** Drizzle ORM migrations (`pnpm drizzle-kit migrate`)
- **Migration:** Provision a standard PostgreSQL ≥14 instance; set `DATABASE_URL`

### 6b. File-based session stores (`.jarvas-data/`)

| Subsystem | Path pattern | Implementation |
|---|---|---|
| Knowledge Base (KB) | `.jarvas-data/kb/{sessionId}.json` | `lib/kb/storage.ts` |
| Task Management | `.jarvas-data/tasks/{sessionId}.json` | `lib/tasks/storage.ts` |
| Long-Term Memory (LTM) | `.jarvas-data/ltm/{sessionId}.json` | `lib/ltm/store.ts` |

These paths are **relative to the project root** (`PROJECT_ROOT`). Mount a named volume at the project root (or at `.jarvas-data/` specifically) to preserve them across container restarts.

### 6c. Global `PersistentStore` JSON files (`/tmp/`)

> ⚠️ **Migration action required.** These files live in `/tmp/` which is ephemeral on many host systems and is cleared on container restart. In `docker-compose.yml` a named Docker volume is mounted at `/tmp` to preserve them. On Kubernetes or bare-metal, mount a `PersistentVolumeClaim` at `/tmp`.

| Store | Path | Contents |
|---|---|---|
| Decision Log | `/tmp/jarvis_decision_log.json` | Agent decision history |
| Project History | `/tmp/jarvis_project_history.json` | File change + event timeline |
| Pattern Learning | `/tmp/jarvis_patterns.json` | Learned code patterns |
| Architecture Nodes | `/tmp/jarvis_arch_nodes.json` | Architecture graph nodes |
| Architecture Edges | `/tmp/jarvis_arch_edges.json` | Architecture graph edges |
| Autonomy Audit | `/tmp/jarvis_autonomy_audit.json` | Autonomy cycle audit log |
| Autonomy Cycles | `/tmp/jarvis_cycles.json` | Cycle state & reports |
| Dev Tasks | `/tmp/jarvis_tasks.json` | Dev agent task queue |
| Snapshots | `/tmp/jarvis_snapshots.json` | File snapshot index |
| Execution State | `/tmp/jarvis_exec_state.json` | Agent execution state |
| Task Graph | `/tmp/jarvis_task_graph.json` | Multi-agent task graph |

**Future improvement (post-migration):** Introduce a `JARVIS_TMP_DIR` environment variable so all PersistentStore files can be redirected to a configurable persistent path without touching `/tmp`.

### 6d. Patch Persistence (`.jarvis/`)

- **Path:** `{PROJECT_ROOT}/.jarvis/pending_patches.json`
- **Purpose:** Survives API server restarts; stores pending code patches awaiting human approval
- **Migration:** Mount the project root (or `.jarvis/`) as a named volume

### 6e. Storage Volume Summary for Docker

```
volumes:
  postgres_data     → PostgreSQL data directory
  jarvis_tmp        → /tmp  (PersistentStore JSON files)
  jarvis_workspace  → /workspace  (.jarvis/, .jarvas-data/, project source)
```

---

## 7. API Routes

All routes are mounted under the `/api` prefix in `artifacts/api-server/src/app.ts`.

### Core

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/healthz` | Health check — returns `{ status: "ok" }` |
| `POST` | `/api/chat` | Single-turn conversation |
| `POST` | `/api/chat/stream` | SSE streaming conversation with tool use |
| `POST` | `/api/search` | Web search (Brave or training-knowledge fallback) |
| `POST` | `/api/plan/stream` | SSE streaming multi-step plan execution |

### Memory & Knowledge

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/memory/:sessionId` | Session history + preferences |
| `PUT` | `/api/memory/:sessionId/prefs` | Update preferences |
| `DELETE` | `/api/memory/:sessionId` | Clear session memory |
| `GET/DELETE` | `/api/memory/:sessionId/ltm` | Long-term memory CRUD |
| `DELETE` | `/api/memory/:sessionId/ltm/:entryId` | Delete single LTM entry |
| `GET/POST/PATCH/DELETE` | `/api/kb/…` | Knowledge base (notes) CRUD |
| `GET` | `/api/kb/search/:sessionId` | Full-text note search |

### Tasks, Projects, Goals

| Method | Path | Description |
|---|---|---|
| `GET/POST/PATCH/DELETE` | `/api/tasks/…` | Productivity task CRUD |
| `GET/POST/PATCH/DELETE` | `/api/projects/…` | Project CRUD |
| `GET/POST/PATCH/DELETE` | `/api/goals/…` | Daily goal CRUD |
| `GET` | `/api/tasks/stats/:sessionId` | Productivity statistics |

### Dev Agent

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/dev/stream` | SSE dev agent task stream |
| `POST` | `/api/dev/apply` | Apply an approved patch |
| `GET/POST/DELETE` | `/api/dev/patches` / `/api/dev/patches/:id` | Patch CRUD + persistent rejection |
| `GET` | `/api/dev/server-status` | Server start time + recovered patch count |
| `GET` | `/api/dev/health` | TypeScript health score |
| `POST` | `/api/dev/rollback` | Restore last file backup |
| `POST` | `/api/dev/snapshots/:id/restore` | Restore a named snapshot |
| `GET` | `/api/dev/context` | Aggregated dev context |
| `POST/GET` | `/api/dev/autofix` / `/api/dev/autofix/history` | Autofix pipeline |
| `GET/POST/PATCH/POST` | `/api/dev/improvements/…` | Improvement proposals + apply |
| `GET` | `/api/dev/files` | List project files |
| `GET` | `/api/dev/file` | Read file content |
| `GET/POST/PATCH/DELETE` | `/api/dev/tasks/…` | Dev task graph CRUD |
| `GET` | `/api/dev/snapshots` | List snapshots |
| `GET/POST/PATCH/DELETE` | `/api/dev/project-memory/…` | Project memory CRUD |
| `GET/POST` | `/api/dev/git/status` / `/api/dev/git/commit` | Git operations |
| `GET/POST` | `/api/dev/index` / `/api/dev/index/rebuild` | File index |

### Multi-Agent System

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/agents` | List registered agents |
| `POST` | `/api/agents/orchestrate` | Create execution plan from a goal |
| `GET` | `/api/agents/orchestrations/:id` | Plan status |
| `POST` | `/api/agents/tasks/:id/run` | Execute a single task (user-triggered) |
| `POST/GET` | `/api/agents/plan/:id/run\|step\|pause\|resume\|summary\|timeline` | Plan lifecycle |
| `GET/PATCH/DELETE` | `/api/agents/tasks/…` | Task graph management |
| `GET` | `/api/agents/messages` | Agent message log |
| `GET` | `/api/agents/permissions/audit` | Permission audit trail |

### Intelligence Layer (Phase 5)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/intel/graph` | Architecture graph summary |
| `GET/POST` | `/api/intel/graph/nodes` | Node listing / upsert |
| `GET` | `/api/intel/graph/hotspots` | High-risk nodes |
| `GET/POST` | `/api/intel/history` | Project history |
| `GET/POST` | `/api/intel/decisions` | Decision log |
| `GET` | `/api/intel/patterns` | Learned patterns |
| `GET` | `/api/intel/recommendations` | AI recommendations |
| `POST` | `/api/intel/patterns/analyze` | Trigger analysis |
| `GET` | `/api/intel/timeline` | Unified project timeline |
| `GET` | `/api/intel/search` | Cross-layer search |
| `POST` | `/api/intel/compress` | Memory compression |
| `GET` | `/api/intel/context` | Task-relevant memory |
| `GET` | `/api/intel/stats` | Global intelligence stats |

### Supervised Autonomy (Phase 6)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/autonomy/cycle-types` | Available cycle type metadata |
| `GET` | `/api/autonomy/active` | Currently running cycle |
| `POST` | `/api/autonomy/cycles` | Start an autonomy cycle (user-triggered only) |
| `GET/POST` | `/api/autonomy/cycles/:id/pause\|stop\|resume` | Cycle lifecycle controls |
| `GET` | `/api/autonomy/cycles/:id/report` | Final cycle report |
| `GET` | `/api/autonomy/audit` / `/api/autonomy/audit/:cycleId` | Audit log |
| `GET` | `/api/autonomy/proposals` | Memory-based improvement suggestions |
| `GET/POST` | `/api/autonomy/budget/…` | Budget config |
| `GET/POST` | `/api/autonomy/policy/…` | Policy & blocked-file checks |

---

## 8. SSE / WebSocket Usage

### Server-Sent Events (SSE)

The project uses **Server-Sent Events only** — no WebSocket connections.

| Endpoint | Content-Type | Events streamed |
|---|---|---|
| `POST /api/chat/stream` | `text/event-stream` | `chunk`, `tool_start`, `tool_done`, `tool_error`, `done`, `error` |
| `POST /api/dev/stream` | `text/event-stream` | Same event types; dev-specific tool results |
| `POST /api/plan/stream` | `text/event-stream` | Plan step updates |

**Important nginx configuration:** SSE requires that the nginx proxy **disables buffering** for these endpoints. Without this, tokens are held until the buffer fills. See `docker-compose.yml` for the required `proxy_buffering off` and `X-Accel-Buffering: no` configuration.

**Cancel detection:** Uses `res.on("close")` — NOT `req.on("close")`. The `req` close event fires immediately after body-parser consumes the POST body on SSE routes; always listen on `res`.

---

## 9. Patch Persistence

| Aspect | Detail |
|---|---|
| Storage file | `{PROJECT_ROOT}/.jarvis/pending_patches.json` |
| Created by | `artifacts/api-server/src/lib/dev/tools.ts` → `registerPatch()` |
| On server start | Patches in the file are loaded; each gets `recoveredFromRestart: true` |
| Recovery signal | `GET /api/dev/server-status` returns `{ startedAt, recoveredPatchCount }` |
| Rejection | `DELETE /api/dev/patches/:id` removes the patch from the JSON file |
| Snapshots | Before applying any patch, `snapshotStore.ts` writes a backup to `/tmp/jarvis_snapshots.json` |

**Docker:** Mount a named volume at the project workspace root so `.jarvis/` survives container restarts.

---

## 10. Agent & Runtime Assumptions

| Assumption | Detail |
|---|---|
| **Working directory** | The API server process must run from or be aware of `PROJECT_ROOT` (the monorepo root). It resolves file paths relative to this directory. |
| **Git available** | The dev agent runs `git status` and `git commit` via child_process. Git must be installed in the production container. |
| **Node.js 24** | Specified in `.replit` (`modules = ["nodejs-24"]`). The Dockerfile uses `node:24-alpine`. |
| **pnpm** | All scripts use pnpm. The Dockerfile installs pnpm via `corepack`. |
| **No cron / auto-execution** | The autonomy cycle, multi-agent plan, and all dev agent tasks are **user-triggered only**. No background schedulers exist. |
| **Policy gates** | `lib/autonomy/autonomyPolicy.ts` and `lib/agents/permissions.ts` must never be bypassed. They are on the blocked-file list. |
| **tsc must be on PATH** | `GET /api/dev/health` runs `tsc --noEmit`. The production image must include devDependencies (or install TypeScript separately). |
| **Claude Sonnet 4 (claude-sonnet-4-6)** | All AI reasoning routes through the Anthropic integration. Model name is configured in `lib/integrations-anthropic-ai`. |

---

## 11. Migration Steps

### Step 1 — Provision infrastructure

```
[ ] PostgreSQL ≥ 14 database
[ ] Linux host with Docker + Docker Compose (or Kubernetes)
[ ] DNS record pointing to your server
[ ] TLS certificate (Let's Encrypt / Cloudflare)
[ ] Anthropic API key
[ ] (Optional) Brave Search API key
```

### Step 2 — Clone and configure

```bash
git clone <your-repo-url> /srv/jarvis
cd /srv/jarvis
cp .env.example .env
# Edit .env — fill in all required values
```

### Step 3 — Remove Replit-only Vite plugin

Edit `artifacts/jarvas/vite.config.ts`: remove the import of  
`@replit/vite-plugin-runtime-error-modal` and its usage in the plugins array.  
(The `cartographer` and `devBanner` plugins are already auto-guarded by `REPL_ID` and need no change.)

### Step 4 — Build and start

```bash
docker compose build
docker compose up -d
```

### Step 5 — Run database migrations

```bash
docker compose exec api pnpm --filter @workspace/db run drizzle-kit migrate
```

### Step 6 — Verify

```bash
curl https://your-domain.com/api/healthz
# Expected: { "status": "ok" }

curl https://your-domain.com/api/dev/server-status
# Expected: { "ok": true, "startedAt": <ms>, "recoveredPatchCount": 0 }
```

### Step 7 — Export data from Replit (if needed)

See [§13 — Backup & Export Instructions](#13-backup--export-instructions).

---

## 12. Production Readiness Checklist

### Security

- [ ] All secrets in `.env` — never committed to git (`.gitignore` must cover `.env`)
- [ ] `NODE_ENV=production` set
- [ ] PostgreSQL not exposed on a public port (internal Docker network only)
- [ ] TLS termination at nginx (or upstream load balancer)
- [ ] CORS origins locked to your actual domain in `artifacts/api-server/src/app.ts`
- [ ] Rate limiting added to `/api/chat/stream` (currently unbounded)
- [ ] `LOG_LEVEL=warn` or `error` in production (reduces log volume)
- [ ] Replit-specific Vite plugin removed from frontend build

### Reliability

- [ ] Named Docker volumes configured for all three storage layers (§6)
- [ ] PostgreSQL with automated daily backups
- [ ] Health check endpoint (`/api/healthz`) wired into your load balancer / uptime monitor
- [ ] Restart policy (`restart: unless-stopped`) set on all Docker services
- [ ] Container resource limits (memory, CPU) configured
- [ ] Log rotation configured (or use a logging driver like `json-file` with size limits)

### Performance

- [ ] nginx `proxy_buffering off` for SSE endpoints (see §8)
- [ ] `proxy_read_timeout` ≥ 300s for SSE and long AI completions
- [ ] Database connection pooling (Drizzle uses `pg` pool — tune `max` connections)
- [ ] Frontend assets gzip / brotli compressed by nginx

### Observability

- [ ] Structured JSON logs (Pino) shipped to log aggregator (Grafana Loki, Datadog, etc.)
- [ ] Health check alerting
- [ ] Database disk usage alerting

### Future improvements

- [ ] Migrate `/tmp/jarvis_*.json` files to a configurable `JARVIS_TMP_DIR` path
- [ ] Add authentication layer (Jarvis currently has no auth in front of `/api`)
- [ ] Replace file-based session stores with PostgreSQL for horizontal scaling
- [ ] Add `drizzle-kit migrate` to container startup (currently manual)

---

## 13. Backup & Export Instructions

### Export from Replit

**PostgreSQL data:**
```bash
# Inside Replit shell
pg_dump $DATABASE_URL > jarvis_db_$(date +%Y%m%d).sql
# Download via Replit Files panel
```

**File-based stores (`/tmp/jarvis_*.json` and `.jarvas-data/`):**
```bash
# Inside Replit shell
tar -czf jarvis_data_$(date +%Y%m%d).tar.gz \
  /tmp/jarvis_*.json \
  .jarvas-data/ \
  .jarvis/
# Download via Replit Files panel
```

### Import on new host

```bash
# Restore PostgreSQL
psql $DATABASE_URL < jarvis_db_YYYYMMDD.sql

# Restore file stores
tar -xzf jarvis_data_YYYYMMDD.tar.gz -C /

# Verify
curl http://localhost:8080/api/dev/server-status
```

### Ongoing backups (cron example)

```bash
# Daily backup script — add to host crontab (cron: 0 2 * * *)
#!/bin/bash
BACKUP_DIR=/backups/jarvis/$(date +%Y%m%d)
mkdir -p $BACKUP_DIR

# Database
docker compose exec -T postgres pg_dump $DATABASE_URL > $BACKUP_DIR/db.sql

# File stores
docker compose exec -T api tar -czf - /tmp/jarvis_*.json /workspace/.jarvis /workspace/.jarvas-data \
  > $BACKUP_DIR/filedata.tar.gz

# Retain 30 days
find /backups/jarvis -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +
```

---

## 14. Known Post-Migration Work

| Item | Priority | Notes |
|---|---|---|
| Remove `@replit/vite-plugin-runtime-error-modal` from prod build | **High** | Harmless in dev, unnecessary in prod |
| Migrate `/tmp/jarvis_*.json` → configurable path | **Medium** | Required for Kubernetes / read-only root FS |
| Add auth layer in front of `/api` | **High** | Currently no authentication on any endpoint |
| CORS locked to production domain | **High** | Currently open in development config |
| drizzle-kit migrate on startup | **Medium** | Currently must be run manually |
| Replace file-based stores with PostgreSQL | **Low** | Required only for horizontal scaling |
