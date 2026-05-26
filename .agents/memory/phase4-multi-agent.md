---
name: Phase 4 multi-agent architecture
description: Multi-agent framework structure, agent IDs, permission model, task graph, and safety invariants. No autonomous execution.
---

# Phase 4 Multi-Agent Architecture

## Framework files (all in api-server/src/lib/agents/)
- `permissions.ts` — PERMISSIONS const, assertPermission (throws), checkPermission (safe), audit log
- `baseAgent.ts` — AgentDefinition interface, AgentRunResult, AgentContext, RiskLimit, ExecutionMode types
- `registry.ts` — singleton Map, registerAgent/getAgent/listAgents/_unregisterAgent (test helper)
- `taskGraph.ts` — Task type, createTask/updateTask/deleteTask, getReadyTasks (dep-gate), persists to /tmp/jarvis_task_graph.json
- `contextBus.ts` — getSharedContext() aggregates health/patches/tasks/autofix/denials
- `orchestrator.ts` — orchestrate(goal) creates PlannerAgent task; runTask(id) calls Claude; never self-invoked

## Agents (api-server/src/agents/, self-register on import)
| ID         | Permissions                                                   | executionMode | riskLimit |
|------------|---------------------------------------------------------------|---------------|-----------|
| planner    | READ_FILES, READ_CONTEXT, TASK_CREATE, TASK_UPDATE            | read-only     | safe      |
| builder    | READ_FILES, READ_CONTEXT, PATCH_PROPOSAL, TASK_UPDATE         | proposal      | review    |
| tester     | READ_FILES, READ_CONTEXT, TEST_RUNNER, AUTOFIX_TRIGGER, TASK_UPDATE | test    | safe      |
| researcher | READ_FILES, READ_CONTEXT, TASK_UPDATE                         | read-only     | safe      |
| git        | READ_CONTEXT, CHECKPOINT, ROLLBACK, GIT_STATUS, GIT_COMMIT, TASK_UPDATE | git  | review    |

## Routes (api-server/src/routes/agents.ts)
- GET  /api/agents                    — list agents
- GET  /api/agents/tasks              — task graph
- GET  /api/agents/tasks/ready        — ready tasks (deps satisfied)
- GET  /api/agents/context            — shared context bus
- POST /api/agents/orchestrate        — create orchestration (PlannerAgent task)
- POST /api/agents/tasks/:id/run      — execute one task (user-triggered ONLY)
- PATCH /api/agents/tasks/:id         — cancel/reprioritise
- DELETE /api/agents/tasks            — clear graph
- GET  /api/agents/permissions/audit  — audit log (?denied=true)

## Registration
Agents are imported in routes/index.ts — 5 side-effectful imports trigger registerAgent() calls.
Do NOT move imports or make them lazy or agents won't be registered on startup.

## Safety invariants
- runTask() is NEVER called automatically — only via POST /api/agents/tasks/:id/run
- assertPermission() throws PermissionDeniedError + records to audit log
- Task dependencies are enforced: deps must all be "done" before a task can run
- PlannerAgent creates subtasks from JSON block in Claude response; BuilderAgent does not auto-apply patches
- All task state persists to /tmp/jarvis_task_graph.json (survives server restart)

## UI
- MultiAgentPanel.tsx — new component in jarvas/src/components/
- DevAgentPanel.tsx — added "agents" to PanelTab type + tab button + render block
- Tab uses Network icon from lucide-react (already added to import)

## Tests (api-server/src/__tests__/agents.test.ts)
53 new tests: permission enforcement, audit log, task graph CRUD, dep logic, registry, orchestration status, blocked-action attempts, rollback integrity.
Total: 99 tests (46 Phase 3C + 53 Phase 4).

**Why no autonomous execution:**
Phase 4 is architecture/foundation. The orchestrator creates task graphs but tasks run only on explicit user action. This matches the spec: "No autonomous multi-agent execution yet."
