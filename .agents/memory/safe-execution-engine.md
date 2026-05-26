---
name: Safe execution engine
description: Sandboxed executor for approved low-risk agent actions — 5 op types, hard safety gates, auto-checkpoint
---

## Architecture

- `lib/executionEngine.ts` — core engine; no execSync/exec/spawn/eval; fs-only writes to `.jarvas-data/`
- `lib/executionRecords.ts` — execution history in `.jarvas-data/executions/executions.json`; status: queued→running→completed|failed
- `routes/executions.ts` — POST /api/agent-actions/:id/execute + GET /api/executions + GET /api/executions/:id
- `ExecutionsPanel.tsx` — amber/orange theme; QUEUE + HISTORY tabs; polls every 4s; EXECUTIONS button in Chat.tsx header (between CHECKPOINTS and DEV); Cpu icon

## Safety gates (all must pass or request is rejected)

1. `action.status === "approved"` — only approved actions
2. `action.riskLevel === "low"` — ONLY low-risk (hard block for medium/high/critical)
3. BLOCKED_PATTERNS scan on title+description — rejects: delete/remove/unlink, package.json, npm/pnpm/yarn install, git reset/rebase/push, deploy commands, exec/spawn/eval
4. Path assertion: all output paths must resolve under `.jarvas-data/` (assertSafePath)

## Allowed operation types (detected by OP_PATTERNS — order matters)

1. `create_directory` — mkdirSync under `.jarvas-data/{slug}/`
2. `create_file` — writeFileSync `.jarvas-data/files/{ts}-{slug}.json` (no overwrite)
3. `append_log` — appendFileSync `.jarvas-data/logs/agent-execution.log`
4. `update_task_status` — find task by title keywords, update to "done" via updateTaskStatus()
5. `generate_report` — writeFileSync `.jarvas-data/reports/{ts}-{slug}.md`

## Key gotcha

- `MasterTask` has NO `description` field — only `title`, `id`, `status`, `priority`. Using `t.description` causes TS2339. Match by `t.title` only.
- OP_PATTERNS are checked in order. "task completions" in a description can falsely trigger `update_task_status` before `generate_report`. Reorder patterns if this becomes an issue.

## Auto-checkpoint

Every real (non-dry-run) execution calls `createCheckpoint({ description: "Auto-checkpoint before executing: {title}" })` before writing any files. Dry-runs skip this. The `checkpointId` is stored on the execution record.

**Why:** Auto-checkpoint ensures every real execution is reversible (via the checkpoint restore-preview flow) and provides a safety net against accidental changes.
