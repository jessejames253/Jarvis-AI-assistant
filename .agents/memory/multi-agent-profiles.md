---
name: Multi-Agent System v1
description: 6 specialist agent profiles with keyword-based assignment logic; read-only — no agent work is executed from this system
---

## Architecture

- `lib/agentProfiles.ts` — profile definitions, storage helpers, keyword-scoring assignment engine
- `routes/agentProfiles.ts` — 4 routes under `/agents/profiles` and `/agents/assign`
- `AgentsPanel.tsx` — cyan `hsl(185 75% 52%)` / `Users` icon; assignment form at top, active result, full roster

## 6 Specialist Agents

| ID          | Role       | Preferred changeTypes         | Color                   |
|-------------|------------|-------------------------------|-------------------------|
| architect   | architect  | feature, api, refactor        | hsl(264 80% 68%) violet |
| coder       | coder      | feature, frontend, api, refactor | hsl(150 70% 55%) green |
| debugger    | debugger   | bugfix, refactor               | hsl(355 80% 65%) red   |
| tester      | tester     | test, bugfix, feature          | hsl(38 100% 60%) amber  |
| deployment  | deployment | docs, data                     | hsl(196 80% 58%) blue  |
| memory      | memory     | data, feature                  | hsl(280 70% 65%) purple |

## Storage

- `.jarvas-data/agents/agents.json` — 6 profiles, auto-seeded on first load (5.5 KB)
- `.jarvas-data/agents/last-assignment.json` — single cached result, overwritten per POST assign (~1 KB)

## API Routes

- `GET  /api/agents/profiles`       — list all 6 profiles
- `GET  /api/agents/profiles/:id`   — single profile by id; 404 if not found
- `POST /api/agents/assign`         — validate goal+changeType, auto-checkpoint, run scoring, cache result
- `GET  /api/agents/assign/last`    — return cached last assignment (null if none)

## CRITICAL: Route conflict with existing agents.ts

The existing `agents.ts` has `GET /agents` (returns execution framework agents). These new routes use sub-paths `/agents/profiles` and `/agents/assign` which do NOT conflict. `agentProfilesRouter` is registered AFTER `agentsRouter` in routes/index.ts — this is fine since paths are distinct.

## Scoring algorithm

For each profile:
1. Count keyword matches in `goal + context` (multi-word phrases worth 2, single words worth 1)
2. Add stem partial matches (first 4 chars, worth 0.5)
3. Add changeType bonus (+3 if changeType is in `preferredChangeTypes`)
4. Sort descending; normalise winner score to 30-100 confidence range
5. Alternates: 2nd and 3rd agents at 85% of winner's normalised confidence

## Assignment was consistently correct in smoke tests

- Design API contract → architect (keywords: design, contract, system, model)
- Fix SSE crash → debugger (keywords: fix, crash, unexpected, investigate)
- Write unit tests/e2e → tester (keywords: test, coverage, e2e, unit)
- Docker + production env → deployment

**Why read-only assignment:**
Phase 1 only matches the right agent — actual agent work is a separate future phase. This prevents accidental autonomous execution while the routing logic is being validated.
