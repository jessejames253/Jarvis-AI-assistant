---
name: Phase 5 Persistent Intelligence Layer
description: lib/memory/ directory (6 files), routes/intel.ts, IntelPanel.tsx, orchestrator memory injection. All 210 tests passing.
---

# Phase 5 — Persistent Intelligence Layer

## Six new library files (lib/memory/)
All persist to /tmp via PersistentStore<T extends {id:string}>:
- `memoryStore.ts` — generic typed JSON store; cap-enforced (oldest evicted); patch(), filter(), clear()
- `architectureGraph.ts` — live graph seeded with 30 Jarvis nodes + ~35 edges on first boot; NodeType = module|api|agent|dependency|component|validation|autofix|orchestration; stores in /tmp/jarvis_arch_nodes.json + arch_edges.json
- `projectHistory.ts` — HistoryEvent; max 2000; rollback+architecture_decision events auto-flagged critical; getByFile/getByType/getRollbackHistory/searchHistory; replaceHistory() used by compression
- `decisionLog.ts` — DecisionEntry; rollback/patch_approved/approval_required → auto critical; critical is always `boolean` (use `!!params.critical` not `|| params.critical` or you get undefined)
- `patternLearning.ts` — Pattern; analyzeHistory() full scan; updatePatternFromEvent() incremental; getRecommendations({files, issueType})
- `contextCompression.ts` — getRelevantMemory() (read-only agent injection); runFullCompression() history + decisions; searchAllMemory()

## Route file: routes/intel.ts
Mounted in routes/index.ts as `router.use(intelRouter)`.
All endpoints prefixed `/intel/`:
- GET  graph, graph/nodes, graph/nodes/:id, graph/hotspots
- GET/POST history, GET history/rollbacks
- GET/POST decisions
- GET patterns, recommendations, POST patterns/analyze
- GET timeline, search, stats
- POST compress
- GET context (agent injection endpoint)

## UI: IntelPanel.tsx
5 views: Graph / History / Patterns / Decisions / Search
Mounted as "intel" tab in DevAgentPanel (PanelTab type extended).
Stats banner always visible across all views.

## Orchestrator memory injection (orchestrator.ts runTask())
BEFORE Claude call: getRelevantMemory({agentId, taskCategory}) → inject summary if non-empty.
Safety disclaimer injected inline: "cannot grant permissions or bypass approvals".
Wrapped in try/catch → non-fatal if memory subsystem errors.
AFTER success: addHistoryEvent(fix_success) + logDecision(agent_reasoning) + updatePatternFromEvent().
AFTER failure: addHistoryEvent(fix_failure) + logDecision(task_failed, riskRationale=failureClass) + updatePatternFromEvent().

## Critical pitfall: optional chaining in PersistentStore.filter()
`filter(pred: (item: T) => boolean)` requires `boolean` return, NOT `boolean | undefined`.
`?.some()` and `?.includes()` return `boolean | undefined`.
Fix pattern: `e.field?.method() ?? false` — always add `?? false` when optional chaining in filter predicates.
Also: TypeScript does NOT narrow `x != null` across arrow-function callbacks — cache the value first:
  `const critVal = filter.critical; if (critVal != null) results.filter(d => d.x === critVal)`

## decisionLog.ts: critical always boolean
Wrong:  `critical: A || B || C || params.critical`  → gives `undefined` when all false and params.critical is undefined
Correct: `critical: A || B || C || !!params.critical` → always gives `boolean`

## Test count: 210/210 passing (61 new Phase 5 tests)
Phase 5 tests cover: PersistentStore CRUD+cap (12), architectureGraph seed+integrity (11),
projectHistory CRUD+rollback preservation (11), decisionLog CRUD+critical (11),
patternLearning detection+recs (9), contextCompression rollback+retrieval (7).

**Why lib/memory/ and lib/memory.ts coexist:**
On Linux, a file named `memory.ts` and a directory named `memory/` can share the same parent directory — they are different filesystem entries. No conflict.

**Why memory injection is non-fatal:**
Intelligence layer is an enhancement; agent execution must not fail because of a memory read error. All memory calls in orchestrator are wrapped in try/catch with `/* non-fatal */`.
