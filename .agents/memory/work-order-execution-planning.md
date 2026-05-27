---
name: Work Order Execution Planning v1
description: Claude dry-run execution planner per work order — steps, files, safety checks, risks, validation, recommendation
---

## Architecture

- `lib/workOrderExecutionPlanner.ts` — Claude prompt + JSON parse + storage; reads WorkOrder + siblings + workspace map
- `routes/workOrderExecutionPlanning.ts` — 3 routes; literal `/execution-plans` MUST be registered before `/:id` routes
- `WorkOrdersPanel.tsx` — PLAN EXECUTION button in expanded OrderCard; `ExecutionPlanView` inline component; `executionPlans` state loaded on panel open via bulk GET

## ExecutionPlan shape

```typescript
{
  workOrderId, assignedAgent: { agentId, agentName, agentColor, agentEmoji, role },
  objective, requiredInputs: string[],
  proposedSteps: [{ stepNumber, action, detail, reversible }],
  filesLikelyAffected: [{ path, change: create|modify|delete|read, reason }],
  safetyChecks: [{ check, result: pass|warn|fail, detail }],
  risks: [{ description, severity, mitigation }],
  validationPlan: [{ description, type: test|lint|typecheck|manual|automated }],
  estimatedDifficulty: low|medium|high|critical,
  recommendation: proceed|revise|block,
  plannedAt,
}
```

## Route ordering (CRITICAL)

`GET /agents/work-orders/execution-plans` (literal, bulk) must be declared **before** `GET /agents/work-orders/:id/execution-plan` in the router file. If reversed, Express captures "execution-plans" as `:id` and returns a 404.

## Storage

`.jarvas-data/agents/work-order-execution-plans.json` — object keyed by workOrderId. Re-planning the same order overwrites.

## Workspace context

`workspaceSummary()` reads `.jarvas-data/workspace/workspace-map.json` (if present) and injects artifact list + language breakdown into the Claude prompt. Fails silently if file doesn't exist.

## Frontend UX

- `PLAN EXECUTION` button → violet `PlayCircle`; becomes `RE-PLAN EXECUTION` + `RotateCcw` if plan exists
- Inline `ExecutionPlanView` renders recommendation banner (proceed=green, revise=amber, block=red), difficulty badge, fail/warn safety counts
- 5 collapsible sections: Steps (default open), Files, Safety Checks, Risks, Validation
- Small colored dot on card header when plan exists (color = recommendation color)
- Bulk `GET /execution-plans` loaded in parallel with orders on panel open (one round-trip)

## Smoke test results

- Architect Agent order: `proceed` + `high` difficulty, 7 steps (all reversible), 7 files (docs + types), 5 safety checks (2 warn — contract spec and type interface coverage), 4 risks, 5 validation steps
- GET cached plan → same data
- GET bulk → total 1 plan
- GET non-existent → 404 with message
- Auto-checkpoint created before each POST

**Why:** Dry-run planning gives the user confidence before any agent executes work. Claude is well-suited because it can reason about what a specialist agent would realistically do given a concrete objective and project context.
