# ─────────────────────────────────────────────────────────────────────────────
# Jarvis Frontend — Multi-stage Dockerfile
#
# Stages:
#   1. base     — Node 24 + pnpm (glibc/slim — required for rollup native)
#   2. deps     — install all workspace dependencies
#   3. build    — vite build → dist/public/
#   4. serve    — nginx serves static files + proxies /api to the API server
#
# Build context must be the MONOREPO ROOT (not apps/web).
#
# In Coolify set:
#   Base Directory  →  /          (repo root)
#   Dockerfile      →  apps/web/Dockerfile
#
# Manual build:
#   docker build -f apps/web/Dockerfile \
#     --build-arg BASE_PATH=/ \
#     -t jarvis-web .
# ─────────────────────────────────────────────────────────────────────────────

# ── 1. Base ───────────────────────────────────────────────────────────────────
FROM node:24-slim AS base
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /workspace

# ── 2. Dependencies ───────────────────────────────────────────────────────────
FROM base AS deps

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.base.json tsconfig.json ./

# Shared lib manifests
COPY lib/api-zod/package.json                   lib/api-zod/
COPY lib/db/package.json                        lib/db/
COPY lib/integrations-anthropic-ai/package.json lib/integrations-anthropic-ai/
COPY lib/api-client-react/package.json          lib/api-client-react/

# Frontend manifest
COPY artifacts/jarvas/package.json     artifacts/jarvas/
# api-server manifest (needed for workspace resolution)
COPY artifacts/api-server/package.json artifacts/api-server/

RUN pnpm install --frozen-lockfile

# ── 3. Build ──────────────────────────────────────────────────────────────────
FROM deps AS build

# BASE_PATH is the Vite base path (e.g. "/" for root, "/jarvis/" for sub-path)
# It is baked into the static build at build time.
ARG BASE_PATH=/
ARG VITE_PORT=3000
# VITE_API_BASE_URL — set this in Coolify to your backend's public URL.
# Example: https://outstanding-okapi.syd1.coolify.app/
# Leave blank to use the nginx /api proxy (same-origin deployment).
ARG VITE_API_BASE_URL=""

# Copy full source
COPY lib/              lib/
COPY artifacts/jarvas/ artifacts/jarvas/
COPY attached_assets/  attached_assets/

# Build shared lib types (jarvas imports types from api-zod)
RUN pnpm --filter @workspace/api-zod run build 2>/dev/null || true

# Build the frontend — output goes to artifacts/jarvas/dist/public
# VITE_API_BASE_URL is forwarded so getApiBase() bakes the backend URL into
# the bundle.  Leave blank (default) to keep relative /api/* paths (nginx proxy).
RUN PORT=${VITE_PORT} BASE_PATH=${BASE_PATH} VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    pnpm --filter @workspace/jarvas run build

# ── 4. Production nginx image ─────────────────────────────────────────────────
FROM nginx:1.27-alpine AS production

RUN rm /etc/nginx/conf.d/default.conf

COPY --from=build /workspace/artifacts/jarvas/dist/public /usr/share/nginx/html

# nginx config lives alongside this Dockerfile in apps/web/nginx/
# Build context must be repo root: path is relative to that root
COPY apps/web/nginx/jarvis.conf /etc/nginx/conf.d/jarvis.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
