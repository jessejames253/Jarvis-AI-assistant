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

## Key utilities
- `src/lib/approvalInput.ts` — `parseApprovalInput(input)` returns `"approve" | "reject" | null`; used by DevAgentPanel sendMessage for typed shortcut detection (case-insensitive, whitespace-trimmed).
- `src/components/PatchNotificationBar.tsx` — standalone component (extracted from Chat.tsx) that accepts `patches`, `approvingId`, `errorMessage`, `onApprove`, `onReject` as props. No fetch/state inside — Chat.tsx owns that. Enables independent rendering in tests.

## Typed APPROVE / no-pending-patch message
DevAgentPanel sendMessage now uses `parseApprovalInput(goal)` and shows `"No pending patch to approve or reject."` if no patch_proposed message is found in the backlog.

## Tests (Phase 6B complete)
- `src/__tests__/patchApprovalUX.test.tsx` — 45 tests: parseApprovalInput (8), approvePatch lib (6), rejectPatch (1), fetchPendingPatches/persistence (3), PatchActionButtons (7), PatchNotificationBar (11), InlinePatchActions (7 in this file) + 2 act-warning-only
- `src/__tests__/InlinePatchActions.test.tsx` — 8 tests for the DEV chat-tab look-ahead component.
- Total: 53/53 passing, 0 TypeScript errors.

**Why:** Centralising in one lib + one shared component ensures consistent HTTP payload, consistent console logging, and a single place to update when the approval API changes. Without this, each surface was duplicating the fetch logic with subtle differences (e.g., project inference, taskId handling).
