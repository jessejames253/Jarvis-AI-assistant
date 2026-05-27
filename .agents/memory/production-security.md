---
name: Production security middleware
description: CORS allowlist + API key auth in lib/security.ts — opt-in via env vars, zero impact on dev when unset
---

## What was added

`artifacts/api-server/src/lib/security.ts` — two exports wired into `app.ts`:

- `buildCorsOptions()` — called once at startup; returns `CorsOptions` for `cors()`
- `apiKeyAuth` — Express `RequestHandler` middleware

## Behaviour matrix

| API_KEY set | ALLOWED_ORIGINS set | Auth behaviour | CORS behaviour |
|---|---|---|---|
| No | No | No-op (dev unchanged) | Allow all origins (dev unchanged) |
| Yes | No + NODE_ENV=production | Enforced | Block all browser origins (warn logged) |
| Yes | Yes | Enforced | Allowlist only |
| No | Yes | No-op | Allowlist only |

## Middleware order in app.ts

```
pinoHttp → cors(buildCorsOptions()) → apiKeyAuth → json → urlencoded → /api router
```

CORS must come before auth so OPTIONS preflight requests return CORS headers
before the auth check runs. `cors()` terminates OPTIONS requests internally.

## Exempt paths

`/api/healthz` is always public — needed by Docker HEALTHCHECK, uptime monitors,
load balancers. Defined as `PUBLIC_PATHS` Set in security.ts.

## Environment variables

- `API_KEY` — Bearer token. Leave unset in dev. Generate: `openssl rand -hex 32`
- `ALLOWED_ORIGINS` — Comma-separated origins, e.g. `https://jarvis.example.com,http://localhost:5173`

**Why opt-in:** Setting either var in Replit dev would break the frontend proxy.
Requiring both vars only in production keeps the dev workflow identical to before.

## Auth header format

```
Authorization: Bearer <API_KEY>
```

Returns `401` + `WWW-Authenticate: Bearer realm="Jarvis API"` on failure.
