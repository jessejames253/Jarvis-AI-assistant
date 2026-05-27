# ─────────────────────────────────────────────────────────────────────────────
# Jarvis API Server — Multi-stage Dockerfile
#
# Stages:
#   1. base        — Node 24 + pnpm via corepack
#   2. deps        — install all workspace dependencies
#   3. build       — compile shared libs + api-server (esbuild → ESM)
#   4. production  — minimal runtime image
#
# Build from the monorepo root:
#   docker build -t jarvis-api .
#
# Run (requires .env):
#   docker run --env-file .env -p 8080:8080 jarvis-api
# ─────────────────────────────────────────────────────────────────────────────

# ── 1. Base ──────────────────────────────────────────────────────────────────
FROM node:24-alpine AS base

# Enable corepack so we can use the exact pnpm version from package.json
RUN corepack enable && corepack prepare pnpm@10 --activate

# Install git (required by the dev agent's git routes)
RUN apk add --no-cache git

WORKDIR /workspace

# ── 2. Dependency installation ────────────────────────────────────────────────
FROM base AS deps

# Copy manifest files first (better layer caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.base.json tsconfig.json ./

# Shared libs — manifests only
COPY lib/api-zod/package.json                     lib/api-zod/
COPY lib/db/package.json                          lib/db/
COPY lib/integrations-anthropic-ai/package.json   lib/integrations-anthropic-ai/

# Artifacts — manifests only
COPY artifacts/api-server/package.json            artifacts/api-server/
COPY artifacts/jarvas/package.json                artifacts/jarvas/

# Install all dependencies (including devDependencies — needed for tsc in prod health check)
RUN pnpm install --frozen-lockfile

# ── 3. Build ──────────────────────────────────────────────────────────────────
FROM deps AS build

# Copy full source tree
COPY lib/                   lib/
COPY artifacts/api-server/  artifacts/api-server/

# Build shared packages
RUN pnpm --filter @workspace/api-zod run build 2>/dev/null || true
RUN pnpm --filter @workspace/db run build 2>/dev/null || true
RUN pnpm --filter @workspace/integrations-anthropic-ai run build 2>/dev/null || true

# Build the API server
RUN pnpm --filter @workspace/api-server run build

# ── 4. Production image ───────────────────────────────────────────────────────
FROM node:24-alpine AS production

# Install runtime tools
RUN apk add --no-cache git && \
    corepack enable && \
    corepack prepare pnpm@10 --activate

WORKDIR /workspace

# Copy the full node_modules (workspace-linked packages need the full tree)
COPY --from=build /workspace/node_modules             ./node_modules
COPY --from=build /workspace/package.json             ./package.json
COPY --from=build /workspace/pnpm-workspace.yaml      ./pnpm-workspace.yaml

# Copy shared lib node_modules (workspace symlinks)
COPY --from=build /workspace/lib                      ./lib

# Copy compiled api-server
COPY --from=build /workspace/artifacts/api-server/dist       ./artifacts/api-server/dist
COPY --from=build /workspace/artifacts/api-server/package.json ./artifacts/api-server/package.json
COPY --from=build /workspace/artifacts/api-server/node_modules ./artifacts/api-server/node_modules

# Copy the full source tree — needed by:
#   - dev agent file-read/write routes (reads source files by path)
#   - health route (runs tsc --noEmit against src/)
#   - patch system (writes to project files)
COPY --from=build /workspace/artifacts/api-server/src    ./artifacts/api-server/src
COPY --from=build /workspace/artifacts/api-server/tsconfig.json ./artifacts/api-server/
COPY --from=build /workspace/tsconfig.base.json          ./

# Create the .jarvis directory for patch persistence
RUN mkdir -p /workspace/.jarvis /workspace/.jarvas-data

# Expose default API port (override with PORT env var)
EXPOSE 8080

ENV NODE_ENV=production
ENV PORT=8080
ENV AI_INTEGRATION=anthropic
ENV AI_INTEGRATIONS_ANTHROPIC_BASE_URL=https://api.anthropic.com

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/api/healthz || exit 1

WORKDIR /workspace/artifacts/api-server

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
