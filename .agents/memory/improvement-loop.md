---
name: Improvement Loop v1
description: Self-improvement analysis system — scans system state, Claude generates suggestions, user converts to work orders
---

## Architecture

- `lib/autonomy/analyzer.ts` — `runAnalysis()`: collects 8 signal categories, feeds to Claude, returns `ImprovementSuggestion[]`
- `lib/autonomy/suggestions.ts` — storage CRUD in `.jarvas-data/autonomy/suggestions.json`; `mergeSuggestions()` preserves converted/dismissed on re-run
- `routes/autonomy.ts` — new routes **appended** to Phase 6 existing file (do NOT replace that file — it has Phase 6 cycle/audit/budget/policy routes too)
- `ImprovementPanel.tsx` — NEW component; **AutonomyPanel.tsx already existed** (Phase 6 cycles) so this is separate
- `Chat.tsx` — IMPROVE button (teal/Cpu, hsl 175) after ORDERS; `improvementPanelOpen` state; panel wired at bottom

## Key design decisions

- `createStandaloneWorkOrder()` added to `workOrders.ts` — sets `collaborationPlanId = sourceLabel ?? "standalone"`, `dependencies = []`, `status = "ready"` immediately
- Convert endpoint looks up agent profile by name match (case-insensitive), falls back to `profiles[0]`
- `mergeSuggestions()` replaces all open suggestions on re-analysis, preserves converted/dismissed
- `autoExecutable: true` only when pure analysis/doc/report — no code changes

## API endpoints (all under existing autonomyRouter)

```
POST /api/autonomy/analyze              — scan + Claude → suggestions (auto-checkpoint)
GET  /api/autonomy/suggestions          — load suggestions + meta
POST /api/autonomy/suggestions/:id/convert — → createStandaloneWorkOrder (auto-checkpoint)
POST /api/autonomy/suggestions/:id/dismiss — mark dismissed
```

## Scan signal sources

1. `task_backlog` — `.jarvas-data/tasks/` files
2. `failed_execution` — `loadExecutions()` from workOrderExecutionEngine
3. `repeated_warnings` / `missing_validation` — `readExecutionPlan()` per work order
4. `low_completion_agent` — per-agent completion rate from work orders
5. `empty_data_store` — 7 expected store paths checked
6. `route_without_panel` / `panel_without_actions` — readdirSync on routes/ and components/

**Why:** Read-only scan means no side effects during analysis; Claude synthesizes all signals holistically rather than rule-by-rule heuristics.
