---
name: Work Order Execution Engine v1
description: Sandboxed file-output execution engine for approved work orders — Claude generates actions, safety gates enforce allowed ops
---

## Architecture

- `lib/workOrderExecutionEngine.ts` — engine: gates + Claude call + sanitizer + executor + storage
- `routes/workOrderExecution.ts` — 2 routes; literal `/executions` registered BEFORE `/:id/execute`
- `WorkOrdersPanel.tsx` — EXECUTE button + `ExecutionResultView` inline component; `executionResults` state loaded on panel open

## Pre-execution gates (all must pass before checkpoint is created)

1. `order.status === "ready"`
2. `executionPlan exists` for this workOrderId
3. `plan.recommendation === "proceed"`

If any gate fails: 422 with `{ ok: false, errors: string[] }`. No checkpoint is created.

## Allowed operations (enforced in code, not by Claude)

| type | effect |
|---|---|
| `create_file` | `writeFileSync` to sandboxed path |
| `append_log` | `appendFileSync` to sandboxed path |
| `generate_report` | `writeFileSync` to sandboxed path (labeled differently in UI) |
| `update_status` | Always applied at end: sets work order → `"completed"`, triggers cascade |

Any other type from Claude is skipped with reason in the action log.

## Path sanitizer

- Allowed extensions: `.txt .md .json .log .yaml .yml .csv`
- Forbidden names: `package.json`, `package-lock.json`, `tsconfig*`, `.env*`, `Makefile`, `Dockerfile*`, `docker-compose*`
- Safe chars: `[a-zA-Z0-9_\-./]+`
- Strips `..` and leading `/`
- Final check: resolved path must still start with `.jarvas-data/agents/outputs/{workOrderId}/`

## Output directory

`.jarvas-data/agents/outputs/{workOrderId}/` — each order gets its own sandbox directory.

## Storage

`.jarvas-data/agents/work-order-executions.json` — array, most-recent first, capped at 200 entries.

## ExecutionResult shape

```typescript
{
  id, workOrderId, agentId, agentName, agentEmoji, agentColor,
  executedAt, checkpointId,
  status: "success" | "partial" | "failed",
  actionsPlanned, actionsExecuted,
  actions: [{ type, path?, content?, status: "completed"|"skipped"|"failed", error? }],
  logs: string[], errors: string[],
  workOrderStatusUpdated: boolean, outputDir: string
}
```

## CRITICAL: JSON extractor bug (fixed)

Claude's content strings frequently contain:
- **Triple backtick markdown code fences** (e.g. ` ```typescript `) — these confused the fenced-block regex which matched backticks inside string values, not just at the response root
- **Brackets inside strings** (e.g. `@Index(['col'])`, markdown links `[text](url)`) — simple bracket counting without string-state tracking skewed depth

**Fix (`extractJsonArray`):**
1. Only apply fenced-block extraction when the response *starts* with ` ``` `
2. Track `inStr`/`escape` state in the bracket counter so `[` and `]` inside strings are ignored
3. After extraction, `repairJsonStrings()` replaces any raw literal `\n`, `\r`, `\t` inside strings with proper escape sequences as a fallback

## Frontend UX

- `EXECUTE WORK ORDER` button (green, `Rocket` icon) — only rendered when `order.status === "ready" && plan && plan.recommendation === "proceed"`
- Two indicator dots on card header: violet dot = plan exists (color = recommendation), green/amber/red dot = execution result exists (color = exec status)
- `ExecutionResultView`: status banner + action count + output files list (path, preview, status icon) + collapsible logs
- After execution, orders are re-fetched to pick up status cascade changes
- Bulk `GET /executions` loaded in parallel with orders and plans on panel open (3 parallel fetches)

## Smoke test results (Coder Agent, notification system order)

- Gates: ✅ 404 on no-plan order, ✅ 422 on non-"ready" order
- Execution: `success` | 4/4 actions completed (2 create_file, 1 generate_report, 1 append_log + auto update_status)
- Cascade: work order set to "completed", downstream orders unlocked to "ready"
- Bulk GET: shows all 4 execution attempts in history (3 failed = pre-fix debugging rounds, 1 success)

**Why:** The execution engine is intentionally a *sandboxed simulation* — agents produce real deliverable documents (architecture specs, reports, data models) into `.jarvas-data/agents/outputs/`, but never touch live application code. This lets the user see meaningful output without any risk to the codebase.
