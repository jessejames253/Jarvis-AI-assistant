---
name: Autonomous dev loop
description: AUTO MODE orchestrator — queue manager, retry/lockout, activity log, safety-gated tick driven by frontend
---

## Architecture

- `lib/autoLoop.ts` — state management + `tick()` orchestration logic
- `routes/autoLoop.ts` — 6 REST endpoints (see below)
- `AutoLoopPanel.tsx` — dashboard: toggle, stats, queue, activity stream; polls every 4s

## Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET  | /api/auto-loop/state        | State + computed queue + stats |
| POST | /api/auto-loop/enable       | Enable AUTO MODE |
| POST | /api/auto-loop/disable      | Disable AUTO MODE |
| POST | /api/auto-loop/tick         | Trigger one processing cycle |
| GET  | /api/auto-loop/activity     | Last 50 activity events |
| POST | /api/auto-loop/reset-lockout | Clear safety lockout |

## Safety contract (never break)

1. AUTO MODE is OFF by default; must be explicitly enabled by user.
2. Only APPROVED + LOW-risk actions are ever processed.
3. Forbidden patterns block before any engine call: deletes, package.json, dep installs, git danger commands, deploys, shell exec.
4. Tick is frontend-driven (no true background process) — only runs when panel is open.
5. Auto-checkpoint created by `runExecution` before every real write.
6. Safety lockout after `LOCKOUT_THRESHOLD` (3) consecutive failures — requires explicit `/reset-lockout`.

## Constants

- `MAX_QUEUE = 3` — max actions processed per tick
- `MAX_RETRIES = 2` — per-action retry limit before it's dropped from queue
- `LOCKOUT_THRESHOLD = 3` — consecutive failures before lockout
- `ACTIVITY_MAX = 200` — events kept in activity.json (FIFO)

## tick() flow

1. Gate: enabled + not lockedOut + not already processing
2. Gate: checkpoint system available (write to .jarvas-data/)
3. `computeQueue()` → approved low-risk actions not yet successfully completed, within retry limit
4. For each action: `runDryRun()` → `buildPlan()` → `createExecution()` → `runExecution()` → `updateExecution(completed|failed)`
5. On success: reset consecutiveFails; on failure: increment retries[actionId] + consecutiveFails
6. At LOCKOUT_THRESHOLD consecutive fails: engage lockout + break loop

## Storage

- State: `.jarvas-data/auto-loop/state.json` — `AutoLoopState` (enabled, lockedOut, lockoutReason, consecutiveFails, processing, retries, executionIds, lastProcessedAt)
- Activity: `.jarvas-data/auto-loop/activity.json` — `ActivityEvent[]` (id, timestamp, type, message, actionId?, executionId?)
- `executionIds` on state tracks which execution records were created by the auto loop (for stats filtering)

## Header button

- Icon: `Bot` from lucide-react; Label: "AUTO"
- Color: green when open, normal when closed
- Position: between EXECUTIONS and DEV

**Why frontend-driven tick:** Keeps the loop human-supervised — stops when user closes the panel, no orphaned background process, easy to reason about.
