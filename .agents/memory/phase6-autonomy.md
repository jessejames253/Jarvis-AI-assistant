---
name: Phase 6 Supervised Autonomy
description: lib/autonomy/ (5 files), routes/autonomy.ts, AutonomyPanel.tsx, "autonomy" tab in DevAgentPanel. 63 new tests, 273/273 passing. Manual-start only, hard budget stops, absolute policy gates.
---

# Phase 6 — Supervised Autonomy

## Five new library files (lib/autonomy/)

### autonomyPolicy.ts
- `isFileBlocked(filePath)` → `{ blocked: boolean; reason?: string }`
- `validateFiles(files[])` → `{ allowed, blocked, allSafe }`
- `isTaskDescriptionSafe(description)` — heuristic pre-check for risky terms
- `listBlockedPatterns()` / `listBlockedExactPaths()`
- Blocked: auth, payment/stripe/billing, migration, .env, package.json, pnpm-lock, secret, deploy, permissions.ts, rollback, checkpoint, .key/.pem/.cert, replit.nix/.replit
- Exact blocked: `src/lib/agents/permissions.ts`, `src/lib/autonomy/autonomyPolicy.ts`
- Policy gates CANNOT be overridden by confidence, memory evidence, or any other factor

### autonomyBudget.ts
- `BudgetTracker` class — in-memory per cycle run, created fresh from persisted `BudgetConfig`
- `DEFAULT_BUDGET`: maxTasks=3, maxPatchProposals=3, maxAppliedPatches=2, maxRetries=2, maxFiles=2, maxLines=80, maxRuntimeMs=600_000, maxAutoFixAttempts=2
- All `check*()` methods return `BudgetCheck { allowed, reason?, remaining }`
- Every check runs `checkRuntime()` first — runtime is the universal hard stop
- `isExhausted()` true when tasks or appliedPatches or runtime are at limit
- Optional `maxModelCalls` for future tracking

### autonomyAudit.ts
- `logAudit(params)` → AuditEntry (id + timestamp auto-generated)
- Persisted to `/tmp/jarvis_autonomy_audit.json` via PersistentStore, max 5000 entries
- `critical` auto-set true for: rollback_executed, policy_blocked, approval_requested/granted/denied, cycle_stopped
- `getCycleAudit(cycleId)` → chronological (asc timestamp)
- `getRecentAudit(limit)` → newest first (desc timestamp)
- `getCriticalAuditEntries()` → all critical entries

### improvementCycle.ts
- 7 CycleTypes: fix_ts_errors, reduce_risk_hotspots, improve_unstable_modules, clean_unused_code, improve_tests, improve_documentation, strengthen_validation
- `CYCLE_META` — label + description + defaultRisk for each type
- `createCycle(type, budget)` → persisted to `/tmp/jarvis_cycles.json`, max 50
- `getActiveCycle()` → first with state "running" or "paused"
- `buildCycleGoal(type, evidence, budget)` → includes raw type key + label (both) so agent prompt and tests both match
- `buildProposals(patterns, hotspots)` → sorted ascending by riskScore, max 6 proposals, always includes doc+test as low-risk options
- `CycleReport` generated at end of each run; attached to cycle record

### autonomyController.ts
- `startCycle(type, budgetConfig?)` → only start mechanism; throws if another cycle running
- `pauseCycle(id)` / `stopCycle(id)` / `resumeCycle(id)` — user control
- `getCycle(id)` / `getActiveCycle()` / `listCycles()` — read API
- `getCycleReport(id)` — returns cycle.report or null
- `getProposals()` — builds proposals from getAllPatterns() + getHotspots()
- Cycle flow: create → audit → getRelevantMemory → orchestrate() → runTask(plannerTaskId) → loop: checkBudget → checkPolicy → checkRisk (≥60 → approval required) → runTask → audit → generateReport
- Budget tracker is ABSOLUTE STOP — exceeding any limit breaks the loop immediately
- Policy check skips individual task (not whole cycle) when triggered
- High-risk tasks (riskScore ≥ 60) pause cycle with approval_requested audit entry
- Errors during cycle set state="failed", always re-throw after logging

## routes/autonomy.ts
Mounted in routes/index.ts as `router.use(autonomyRouter)`.
Key endpoints:
- POST /autonomy/cycles — start (user-triggered only)
- GET  /autonomy/active — currently running/paused cycle
- GET  /autonomy/cycles/:id/report — final report
- POST /autonomy/cycles/:id/pause|stop|resume — user controls
- GET  /autonomy/audit, /autonomy/audit/:cycleId
- GET  /autonomy/proposals — memory-based suggestions
- GET  /autonomy/budget/default, POST /autonomy/budget/validate
- GET  /autonomy/policy/blocked, POST /autonomy/policy/check-files
- GET  /autonomy/cycle-types — CYCLE_META

## AutonomyPanel.tsx
5 views: Start / Active / Report / Audit / History
- Start: proposal cards from memory (sorted by risk), cycle type selector, optional budget fields, safety notice, Start button
- Active: current task + agent badge, approvals-pending warning, budget meters (tasks/patches/proposals), stat counters (tasks/patches/proposed/rolled back), Pause+Stop+Resume controls
- Report: summary text, scored stats grid, budget summary meters, memory evidence used, "Start New Cycle" button
- Audit: chronological audit trail with icons + critical highlighting + gold border for critical entries
- History: list of all cycles, click to navigate to report/active view
- Polls /autonomy/active every 3s when in "active" view

## Safety invariants enforced
- No exported function that sounds like scheduling: verified in tests (`/schedule|cron|interval|timer|background|auto.*run|loop/i`)
- Policy gates have no confidence parameter — cannot be overridden
- autonomyPolicy.ts itself is on the exact-blocked list
- permissions.ts is on the exact-blocked list
- BudgetTracker with maxTasks=0 is immediately exhausted
- One active cycle at a time enforced in startCycle()

## Test count: 273/273 (63 new Phase 6 tests)
BudgetTracker (12), autonomyPolicy (15), ImprovementCycle (12), autonomyAudit (13), Safety invariants (7), [+existing 210]

## One test fix needed during development
buildCycleGoal originally produced "AUTONOMY CYCLE: Improve Test Coverage" (label only).
Test expected raw key "improve_tests" to be present.
Fix: changed to `AUTONOMY CYCLE: ${type} (${meta.label})` — both key and label in the goal string.
**Why:** Raw type key is useful for agents to identify the cycle type; label is human-readable. Both should appear.
