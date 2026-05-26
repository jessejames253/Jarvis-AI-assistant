---
name: Phase 6B Server Restart Patch Recovery
description: Durable patch persistence, restart detection, Resubmit Patch button, RECOVERED badges, persistent rejection. 76/76 tests passing.
---

# Phase 6B — Server Restart Recovery

## Persistence
- Patches stored in `PROJECT_ROOT/.jarvis/pending_patches.json` (not /tmp — survives deploys)
- `mkdirSync` with `recursive:true` ensures the directory is created on first write
- Each patch in the JSON gains `recoveredFromRestart: true` when loaded after a restart

## Server-status endpoint
- `GET /api/dev/server-status` → `{ ok, startedAt, recoveredPatchCount }`
- `SERVER_STARTED_AT` = `Date.now()` at module load (exported constant from tools.ts)
- `RECOVERED_PATCH_COUNT` = count of patches already in the JSON file at startup

## Persistent rejection
- `DELETE /api/dev/patches/:id` → removes the patch from `.jarvis/pending_patches.json`
- Frontend `rejectPatch()` now calls this endpoint (async, non-blocking void call)

## Resubmit flow (ChatPatchProposal)
- `patchProposal` on message objects now carries `newContent` / `oldContent`
- If approvePatch returns "Patch not found — server may have restarted", component enters `missing_server` status
- "Resubmit Patch" button (only when `newContent` present): calls `resubmitPatch()` then `approvePatch()` with new patchId
- `data-testid="chat-patch-restart-warning"` on the warning; `data-testid="chat-patch-applied"` on success

## PatchNotificationBar recovery UI
- Accepts `serverStatus: ServerStatus | null` prop
- Shows `data-testid="patch-recovery-banner"` when `recoveredPatchCount > 0`
- Per-patch `data-testid="patch-recovered-badge-{patchId}"` badge on recovered patches
- Renders bar even when patches list is empty if recoveredPatchCount > 0

## DevAgentPanel RECOVERED badge
- After the risk pill, shows a cyan RECOVERED badge when `p.recoveredFromRestart` is truthy
- `data-testid="dev-patch-recovered-{patchId}"`

## Chat.tsx polling
- `serverStatus` state + `lastServerStartRef` to detect startedAt changes
- Polls `/api/dev/server-status` every 30 s; on startedAt change → refreshes pending patches immediately
- `serverStatus` passed to `PatchNotificationBar`

## Safety invariant
- No auto-apply: recovered patches always require explicit user approval click; no timeouts, intervals, or effects fire approve actions

## Tests: 76/76 passing (23 new in restartRecovery.test.tsx)
Covers: fetchServerStatus (3), resubmitPatch (4), rejectPatch (2), fetchPendingPatches recovery flag (2), ChatPatchProposal resubmit flow (4), PatchNotificationBar recovery banner + badges (8)

**Why:** /tmp is cleared on container restart/deploy, losing all pending patch state. .jarvis/ inside the project root persists across restarts.
