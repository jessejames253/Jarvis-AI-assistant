---
name: Phase 7A Migration Prep
description: Replit exit docs — MIGRATION_PLAN.md, Dockerfile, Dockerfile.frontend, docker-compose.yml, .env.example, .gitignore .env entry. No runtime changes.
---

# Phase 7A — Replit Exit / Migration Prep

## Files created

| File | Purpose |
|---|---|
| `MIGRATION_PLAN.md` | Comprehensive migration guide (14 sections) |
| `Dockerfile` | Multi-stage API server image (node:24-alpine) |
| `Dockerfile.frontend` | Multi-stage Vite build + nginx image |
| `docker-compose.yml` | Orchestrates postgres + api + web with named volumes |
| `.env.example` | Placeholder env vars — safe to commit |
| `.gitignore` (edited) | Added `.env`, `.env.local`, `.env.*.local` |

## Key findings — Replit-specific things to remove

- `@replit/vite-plugin-runtime-error-modal` — always imported in `artifacts/jarvas/vite.config.ts`; must be removed for prod builds
- `@replit/vite-plugin-cartographer` and `@replit/vite-plugin-dev-banner` — already auto-guarded by `REPL_ID !== undefined`; no change needed
- `.replit`, `scripts/post-merge.sh` — Replit-only, do not copy to production

## Critical storage migration note

`PersistentStore` writes 11 JSON files to `/tmp/jarvis_*.json` (absolute path, hardcoded). In Docker, docker-compose mounts a named volume at `/tmp` to preserve them. On Kubernetes, use a PVC at `/tmp`. Future work: add `JARVIS_TMP_DIR` env var to make the path configurable.

## Port mapping

| Service | Internal | External (compose) |
|---|---|---|
| API server | 8080 | internal only (proxied by nginx) |
| nginx (web) | 80 | `HTTP_PORT` (default 80) |
| PostgreSQL | 5432 | internal only |

## Required env vars (production)

- `PORT` (API server, default 8080)
- `NODE_ENV=production`
- `DATABASE_URL` (assembled by compose from `POSTGRES_PASSWORD`)
- `AI_INTEGRATIONS_ANTHROPIC_API_KEY`
- `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`
- `SEARCH_API_KEY` (optional)
- `LOG_LEVEL` (optional, default warn)
- `BASE_PATH` (build-time Vite, default /)

**Why:** No auth exists in front of /api — this is the highest-priority post-migration task.
