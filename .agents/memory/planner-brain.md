---
name: Planner Brain v1
description: Claude-powered structured plan generator — phases, tasks, risks, convert-to-tasks
---

## Architecture

- `lib/plans.ts` — Plan data model, Claude generation, CRUD, convertPlanToTasks()
- `routes/plans.ts` — REST API (GET/POST /plans, GET /plans/:id, POST /plans/:id/convert-to-tasks, PATCH /plans/:id/status)
- `PlansPanel.tsx` — purple/Layers icon panel; create form, phase/task/risk view, convert button

## Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET  | /api/plans                        | List all plans, newest first |
| GET  | /api/plans/:id                    | Get single plan |
| POST | /api/plans                        | Generate plan via Claude (title + goal) |
| POST | /api/plans/:id/convert-to-tasks   | Push pending tasks to master task list |
| PATCH| /api/plans/:id/status             | Update plan status (draft/approved/converting/converted/archived) |

## Plan shape (Plan interface)

- `id`, `title`, `goal`, `createdAt`, `updatedAt`, `status`
- `phases: PlanPhase[]` — each phase has `{ id, title, order, tasks: PlanTask[] }`
- `tasks: PlanTask[]` — flat list (same tasks as in phases, for convenience)
- `risks: PlanRisk[]` — `{ id, description, severity, mitigation }`
- `recommendedNextAction: string`

PlanTask: `{ id, title, phaseId, priority, estimatedEffort, dependsOn[], status }`
- `priority`: "low" | "medium" | "high"
- `estimatedEffort`: "small" (≤2h) | "medium" (≤1d) | "large" (>1d)
- `status`: "pending" | "converted"

## Claude generation

- Model: `claude-sonnet-4-6` via `@workspace/integrations-anthropic-ai`
- System prompt instructs: 2–5 phases, 3–8 tasks/phase, 2–4 risks, JSON-only output
- JSON extracted with bracket-matching (strips markdown fences if present)
- IDs assigned server-side after parsing; `dependsOn` always empty (Claude doesn't know UUIDs)

## convert-to-tasks behaviour

- Calls `addTask()` from masterTasks for each `status === "pending"` task
- `addTask()` throws on duplicate IDs → caught and treated as already-converted (idempotent)
- After conversion: task status → "converted"; plan status → "converted" (all done) or "converting" (partial)
- Returns `{ converted, skipped, taskIds }` — idempotent: calling twice yields 0 converted, all skipped

## Storage

- `.jarvas-data/plans/plans.json` — array of Plan objects, sorted newest-first on read

## Header button

- Icon: `Layers` from lucide-react; Label: "PLANS"; Color: `hsl(264 80% 65%)` purple
- Position: between AUTO and DEV

**Why Claude for generation:** Plans are inherently knowledge-intensive and hard to template. Claude produces realistic, project-specific phases/tasks/risks in a single call. The JSON-only system prompt + bracket extraction is reliable in practice.
