---
name: Task Prioritizer v1
description: Scoring engine for master tasks — 6 weighted factors, persistent scores, recommendations, auto-recalculation hooks
---

## Architecture

- `lib/prioritizer.ts` — scoring engine: `recalculateAllPriorities()`, `getRecommendations()`, `getRankedTasks()`
- `routes/prioritizer.ts` — 3 REST endpoints under `/api/priority/`
- `PriorityPanel.tsx` — teal/TrendingUp icon panel; shows top-5 recs + full ranked list + factor bars

## CRITICAL: Route path conflict

**Use `/api/priority/*` — NOT `/api/tasks/*`.**

The existing `tasksRouter` (from `routes/tasks.ts`) has `GET /tasks/:sessionId` which intercepts any `GET /api/tasks/<anything>` and returns `[]` (session tasks for that sessionId). This silently breaks GET endpoints on `/api/tasks/`.

- `POST /api/priority/recalculate` — trigger recalculation
- `GET  /api/priority/recommendations` — top-5 with reasoning
- `GET  /api/priority/ranked` — all non-done tasks sorted by score

## Scoring model

| Factor | Weight | Source | High score means |
|--------|--------|--------|-----------------|
| urgency | 25% | task.priority field | high priority task |
| impact | 25% | title keywords + phase-1 boost | high-impact title |
| blocked | 15% | earlier-phase tasks still pending | no blockers |
| dependencies | 15% | phase order proxy (phase 1 blocks most) | early phase |
| riskLevel | 10% | title keyword table | low-risk operation |
| difficulty | 10% | plan task estimatedEffort (inverted) | small effort |

Score range: 0–100. Only `pending` and `in-progress` tasks are scored (done/cancelled skipped).

## Storage

- `.jarvas-data/tasks/priority-scores.json` — map of `taskId → PriorityScore`
- Persists across restarts; re-computed on demand or via auto-hooks

## Auto-recalculation hooks

Called via `setImmediate(() => { try { recalculateAllPriorities(); } catch { } })` after response — fire-and-forget, never blocks the route.

Hook injection points:
- `routes/masterTasks.ts` — after `updateTaskStatus()` in PATCH handler
- `routes/plans.ts` — after `convertPlanToTasks()` in convert-to-tasks handler
- `routes/executions.ts` — after execution completes, only when `!dryRun`

## PlanTaskInfo join

Tasks from plans have extra metadata: phaseOrder, effort, phaseTitle, planTitle. Built via `buildPlanTaskMap()` which iterates all plans → phases → tasks. Used for phase-order-based scoring of blocking/blocked status and effort-based difficulty.

Blocked logic: task is "blocked" if there are pending tasks in earlier phases of the same plan. Phase 1 tasks are never blocked.

**Why `/api/priority/*` prefix:**
Had to rename from `/api/tasks/recalculate-priority` / `/api/tasks/recommendations` / `/api/tasks/ranked` because `tasksRouter` registered `GET /tasks/:sessionId` catches any GET to `/api/tasks/<sessionId>` before prioritizerRouter runs.
