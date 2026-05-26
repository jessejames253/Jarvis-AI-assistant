---
name: Patch approval UX
description: How "Approve Patch" / "Reject Patch" buttons are wired across all three approval surfaces.
---

## Rule
All three approval surfaces (Jarvis main chat, DEV panel chat tab, DEV panel Patches tab) share one HTTP implementation in `lib/patchApproval.ts`. UI buttons are rendered by the `PatchActionButtons` shared component and `InlinePatchActions`.

## Surfaces
1. **Jarvis chat** (`pages/Chat.tsx`) — `PatchNotificationBar` polls `GET /api/dev/patches` every 15 s; renders one row per patch with "Approve Patch" / "Reject Patch" buttons above the input footer. Uses `approvePatch()` from the shared lib.
2. **DEV panel Patches tab** (`DevAgentPanel PatchesTab`) — each card row uses `<PatchActionButtons>` component (replaces old "✓"/"✕" icon buttons). `handleApprove` calls shared `approvePatch()`, `handleReject` calls shared `logRejectPatch()`.
3. **DEV panel chat tab** — `patch_proposed` cards render `DiffViewer` (showActions=true) + sticky `PatchActionBar`. `tryApplyPatch` calls shared `approvePatch()`.

## Shared lib (`src/lib/patchApproval.ts`)
- `approvePatch(patchId, file, opts?)` — POST `/api/dev/apply`; auto-detects project from file path; returns `ApproveResult {ok, error?, snapshotId?, validation?, autoFixResult?}`.
- `rejectPatch(patchId, file)` — console.log only; rejection is client-side (filter from state).
- `fetchPendingPatches()` — GET `/api/dev/patches`; returns `PendingPatchSummary[]`; never throws.

## Shared component (`src/components/PatchActionButtons.tsx`)
- Props: `patchId, isApplying?, onApprove, onReject`
- Always renders buttons with `aria-label="Approve Patch"` / `aria-label="Reject Patch"` so tests can use `getByRole("button", { name: /approve patch/i })` regardless of text content during `isApplying` state.

## Tests
- `src/__tests__/patchApprovalUX.test.tsx` — 21 tests covering lib functions (approvePatch, rejectPatch, fetchPendingPatches), PatchActionButtons, and InlinePatchActions.
- `src/__tests__/InlinePatchActions.test.tsx` — 10 tests for the DEV chat-tab look-ahead component.
- Total: 31/31 passing.

**Why:** Centralising in one lib + one shared component ensures consistent HTTP payload, consistent console logging, and a single place to update when the approval API changes. Without this, each surface was duplicating the fetch logic with subtle differences (e.g., project inference, taskId handling).
