---
name: Phase 2A Autofix Engine
description: Controlled low-risk self-fix engine — guarded apply pipeline, human-supervised only
---

# Phase 2A — Controlled Low-Risk Self-Fix Engine

## Files
- `lib/dev/improvements.ts` — persistent store at `/tmp/jarvis_improvements.json`; types: Improvement, ImprovementCategory, RiskLevel, ImprovementStatus
- `lib/dev/autofix.ts` — scan + apply engine; history at `/tmp/jarvis_autofix_history.json`

## API routes (all in routes/dev.ts)
- `POST /dev/autofix` — scan both packages for TS errors → create improvements
- `GET /dev/autofix/history` — rollback log
- `GET /dev/improvements` — list all
- `POST /dev/improvements` — add manual improvement
- `PATCH /dev/improvements/:id` — update status/metadata
- `POST /dev/improvements/:id/apply` — guarded apply (human-triggered only)

## Six safety gates (in applyImprovement)
1. Not in terminal state (applied/rejected/applying)
2. riskLevel === "low" — hard guard, no override
3. category in SAFE_CATEGORIES allow-list
4. patch data must exist on improvement
5. file must not match BLOCKED_FILE_SUBSTRINGS (no package.json, lock files, .env, schema, auth, db, migration)
6. newContent must be non-empty (no file deletions)

## Apply pipeline
snapshot → verify no file drift → write → tsc×2 (both packages) → health score check → commit OR rollback
- Rollback trigger: any tsc errors OR health score drops >10 points
- Rollback log includes: snapshotId, failure reason, healthBefore/After

## Frontend UI (ImprovementsSection in PatchesTab)
- Lives inside PatchesTab's scrollable container, below patches list
- Scan button → POST /api/dev/autofix → refresh list
- Each card: category pill, title, auto-fixable badge, risk pill, status, Apply/Reject/Expand
- Apply only shown when autoFixable===true && riskLevel==="low"
- History toggle fetches from /api/dev/autofix/history

**Why:** Phase 2A is strictly human-supervised. No autonomous scheduling, no autoApprove mode, no recursive loops. Apply must be triggered by a human clicking the button.
