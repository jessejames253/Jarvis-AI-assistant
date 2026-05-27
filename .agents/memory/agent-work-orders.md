---
name: Agent Work Orders v1
description: Converts collaboration plans into assigned work orders with status tracking, dependency cascade, and a grouped frontend panel
---

## Architecture

- `lib/workOrders.ts` — types, storage (flat array), `createFromCollaboration()`, `updateWorkOrderStatus()`, `getPlanForId()`
- `routes/workOrders.ts` — `GET /api/agents/work-orders`, `POST /api/agents/work-orders/from-collaboration/:id`, `PATCH /api/agents/work-orders/:id/status`
- `WorkOrdersPanel.tsx` — gold `hsl(43 100% 55%)` / `ClipboardList` icon; grouped by agent; status dropdowns; convert button

## WorkOrder shape

```typescript
{
  id, collaborationPlanId, agentId, agentName, agentColor, agentEmoji,
  title, objective, inputs: string[], expectedOutput,
  dependencies: string[],    // upstream WorkOrder IDs
  dependencyNames: string[], // readable names for UI
  riskLevel: "high"|"medium"|"low",
  status: "pending"|"ready"|"blocked"|"completed",
  createdAt, completedAt?,
}
```

## Status rules

- First order in chain (no dependencies) → `"ready"` on creation
- All others → `"pending"` on creation
- On PATCH to `"completed"`: cascade — any direct dependent whose ALL deps are now complete is promoted to `"ready"` automatically

## Deduplication

`createFromCollaboration()` replaces all existing orders matching the same `collaborationPlanId` (= `plan.plannedAt`). Safe to call multiple times — never doubles.

## Plan ID routing

`GET /api/agents/work-orders/from-collaboration/last` → reads `last-collaboration.json`. `:id` can also be a `plannedAt` timestamp. Returns 404 with actionable message if no plan exists.

## Risk level assignment

- Lead agent (pos 1) and final agent (pos N): inherit plan's max risk severity
- Middle agents: one step lower (high→medium, medium→low)

## Smoke test results

4-agent plan (Architect→Coder→Tester→Deployment):
- Architect: ready, high risk, 0 deps
- Coder: pending, medium, 1 dep
- Tester: pending, medium, 1 dep  
- Deployment: pending, high, 1 dep
- After Architect → completed: Coder → ready (cascade confirmed)
- Dedup: 2× POST → still 4 orders on disk

**Why flat array not per-agent files:** Work orders are queried together for cascade logic — a per-agent file layout would require loading all files on every status update. Flat array with in-memory filtering is simpler and fast enough at this scale.
