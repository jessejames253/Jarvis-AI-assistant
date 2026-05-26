---
name: Phase 4B Coordinated Execution Engine
description: Supervised multi-agent plan execution — runPlan, stepNext, pause/resume, timeline, retry policy, agent messages. No autonomous execution.
---

# Phase 4B — Coordinated Execution Engine

## New pure library files
- `lib/agents/executionState.ts` — OrchestrationRun state machine; timeline events; persists to /tmp/jarvis_execution_state.json
- `lib/agents/agentMessages.ts` — structured agent-to-agent message bus; in-memory, capped at 2000 msgs; no persistence needed
- `lib/agents/retryPolicy.ts` — classifyFailure (4 classes) + canRetry + logRetry; no retry on permission_denied or risky

## Extended orchestrator.ts exports
- `runPlan(orchestrationId)` — sequential task executor; stops at riskScore >= 60 (waiting_approval), pause state, or MAX_STEPS=20; auto-propagates blocked on failure
- `stepNext(orchestrationId)` — runs exactly one ready task; respects pause state
- `pausePlan(orchestrationId)` — requires state === "running"
- `resumePlan(orchestrationId)` — requires state === "paused"; does NOT auto-advance
- `buildSummary` (internal) — returns PlanRunResult with state/passed/failed/blocked/skipped/rolledBack/timeline

## New routes (in routes/agents.ts)
- POST /agents/plan/:id/run    — trigger runPlan (HTTP waits for completion)
- POST /agents/plan/:id/step   — trigger stepNext
- POST /agents/plan/:id/pause  — pause
- POST /agents/plan/:id/resume — resume
- GET  /agents/plan/:id/summary — PlanRunResult + full timeline
- GET  /agents/plan/:id/timeline — timeline only
- GET  /agents/messages — agent bus messages (filter: orchestrationId, limit)
- GET  /agents/retries  — retry log (filter: taskId)

## Extended TaskStatus (taskGraph.ts)
Added: "ready" | "waiting_approval" | "validating" | "passed" | "skipped" | "rolled_back"
Kept:  "pending" | "running" | "blocked" | "done" | "failed" | "cancelled" (backward compat)
isSuccess("done") = true, isSuccess("passed") = true (both are success)
isTaskReady checks for "pending" OR "ready" status + all deps isSuccess

## MultiAgentPanel.tsx (rewritten ~700 lines)
4 views: Plan / Agents / Timeline / Messages
Plan view: goal textarea, Plan Controls bar (Run Plan / Step Next / Pause / Resume / Clear), active agent banner, run summary panel, context widget, task cards (grouped by status group)
Task cards: show retry count, blocked reason, waiting_approval indicator, expand for result/error
Timeline view: scrolling event list with icons per event type

## Safety invariants unchanged
- runPlan/stepNext are NEVER called automatically — only via explicit POST
- propagateBlocked uses iterative loop (not recursive) to cascade blocked status
- Permission boundaries enforced in runTask via assertPermission
- Orchestrator cannot grant permissions; agents cannot escalate themselves

## Tests: 149/149 passing
50 new Phase 4B tests covering: classifyFailure (5), canRetry (5), logRetry (3),
executionState lifecycle (10), timeline (5), agentMessages (8), new TaskStatus states (7),
dependency ordering (4), no-escalation (5), pause/resume state (2).

**Why runPlan is synchronous (HTTP waits):**
Plans are small (≤8 tasks from PlannerAgent). Each Claude call is bounded by MAX_TOKENS=2048. Total wall time < 40s, well under Express default timeout. Avoids SSE/WebSocket complexity for a supervised (human-paced) flow.
