---
name: Dev Health System
description: Phase 1 read-only health monitoring — tsc check, score, StatusBar badge, startup banner
---

# Dev Health System (Phase 1)

## Score formula
- 100 base
- −5 per frontend TS error (max −40)
- −2 per backend TS error (max −20)
- Labels: ≥90 healthy, 70–89 degraded, <70 failing

## Backend
- `lib/dev/health.ts` — runs tsc --noEmit on both packages in parallel, 30s cache, never writes
- Route: `GET /api/dev/health` — supports `?refresh=1`, returns `{ score, label, typescript: { frontend, backend }, lastChecked, cached }`

## Frontend (DevAgentPanel.tsx)
- `DEV_HEALTH_URL`, `IMPROVEMENTS_URL`, `AUTOFIX_URL`, `AUTOFIX_HIST_URL` constants at top
- `HealthData` interface and extended `StatusData` with health field
- StatusBar: polls every 30s, health badge opens flyout showing score bar + per-package TS errors
- Startup banner: fetches health + patches on mount, auto-dismisses after 8s, dismissible with X

**Why:** Read-only observer only — no writes from health check code path.
