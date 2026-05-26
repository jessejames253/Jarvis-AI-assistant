---
name: Checkpoint system
description: Rollback & Recovery system — metadata store, dry-run restore preview, and frontend timeline panel
---

## Architecture

- `lib/checkpoints.ts` — store CRUD; `.jarvas-data/checkpoints/checkpoints.json`; captures `commitHash` (git log -1), `branch`, `changedFiles` (git status --porcelain) on create; falls back gracefully without git
- `lib/checkpointPreview.ts` — pure analysis, no I/O; uses `git diff --name-only {hash}..HEAD` for file diff, `git diff --name-status` per file for change type, `git status --porcelain` for dirty files/conflicts; file risk rules (lockfile→critical, package.json→critical/high, tsconfig/vite.config/.env→high, .ts/.tsx→medium, etc.)
- `routes/checkpoints.ts` — 3 routes; registered in routes/index.ts
- `CheckpointsPanel.tsx` — slide-in panel, CHECKPOINTS button in Chat.tsx header (between ACTIONS and DEV); green/cyan HSL color; History icon

## Routes

- `GET  /api/checkpoints`                       — list all, newest first
- `POST /api/checkpoints/create`                — `{ description }` required; captures live git snapshot
- `POST /api/checkpoints/:id/restore-preview`   — dry-run only; returns `RestorePreview`

## RestorePreview fields

```
filesAffected[]  — path, risk, reason, existsNow, changeType
estimatedRisk    — low | medium | high | critical
dependencyImpact — { affected, files[], note }
conflicts[]      — files dirty NOW that overlap with the restore set
warnings[]       — informational notes (no git, empty diff, large scope, etc.)
summary          — human-readable one-paragraph description
generatedAt      — ISO timestamp
```

## Safety rules (never break these)

- No `git checkout`, `git reset`, `git restore`, or destructive file writes anywhere in the module
- No automatic rollbacks — preview only; actual rollback is a future phase
- Checkpoint records are never deleted — status transitions only (active → restored | archived)
- All git calls use spawnSync/execSync with `timeout: 6000` and graceful fallback

**Why:** The whole point of this module is that it is safe to call at any time; any accidental file mutation would violate that contract and could destroy user work.
