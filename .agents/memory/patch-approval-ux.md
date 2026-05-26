---
name: Patch approval UX
description: How "Approve Patch" / "Reject Patch" buttons are wired across all three approval surfaces.
---

## Rule
All approval surfaces share one backend store (`pendingPatches` Map in `lib/dev/tools.ts`). When Jarvis's AI uses the `propose_code_change` tool, the patch is registered in `pendingPatches` via `registerPatch()`. The DEV Patches tab and Jarvis chat notification bar both poll `GET /api/dev/patches` from the same store. Inline buttons inside chat messages are rendered by `ChatPatchProposal.tsx` using the patch data attached to the message when `tool_done` fires for `propose_code_change`.

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
- `src/components/ChatPatchProposal.tsx` — inline patch proposal card rendered inside MessageBubble when `message.patchProposal` is set. Owns its own `applying` state. Shows Approve/Reject buttons, then applied/rejected/failed state with exact backend error strings.
- `artifacts/api-server/src/lib/dev/tools.ts` — `registerPatch()` (exported) adds to the shared `pendingPatches` Map and persists to disk. Call it from any source (REST or Jarvis tool).
- `artifacts/api-server/src/lib/agent/tools/propose.ts` — Jarvis agent tool implementation for `propose_code_change`. Calls `registerPatch()` and returns `{patchId, file, description, riskLevel, status:"pending_approval"}`.
- `artifacts/api-server/src/lib/agent/registry.ts` — `propose_code_change` tool added to TOOL_DEFINITIONS, TOOL_LABELS, and executeToolCall.
- `artifacts/api-server/src/routes/dev.ts` — `POST /api/dev/patches` REST endpoint for external patch registration (same store as GET).

## End-to-end flow (Phase 6B complete)
1. User asks Jarvis to modify a file → Claude calls `propose_code_change` tool
2. Backend: `registerPatch()` stores patch in `pendingPatches` Map + persists to `/tmp/jarvis_pending_patches.json`; returns `{patchId, file, description, riskLevel}`
3. Frontend: SSE `tool_done` event for `propose_code_change` → Chat.tsx extracts `patchId` from result, sets `message.patchProposal`, and immediately refreshes `pendingPatches` for the notification bar
4. MessageBubble renders `<ChatPatchProposal>` — real Approve/Reject buttons inside the chat message
5. PatchNotificationBar (polled every 15s) also shows the patch above the input
6. DEV Patches tab (fetches `GET /api/dev/patches`) shows the same patch with Approve/Reject/View Diff

## Typed APPROVE / no-pending-patch message
DevAgentPanel sendMessage now uses `parseApprovalInput(goal)` and shows `"No pending patch to approve or reject."` if no patch_proposed message is found in the backlog.

## Tests (Phase 6B complete)
- `src/__tests__/patchApprovalUX.test.tsx` — 45 tests: parseApprovalInput (8), approvePatch lib (6), rejectPatch (1), fetchPendingPatches/persistence (3), PatchActionButtons (7), PatchNotificationBar (11), InlinePatchActions (7 in this file) + 2 act-warning-only
- `src/__tests__/InlinePatchActions.test.tsx` — 8 tests for the DEV chat-tab look-ahead component.
- Total: 53/53 passing, 0 TypeScript errors.

**Why:** Centralising in one lib + one shared component ensures consistent HTTP payload, consistent console logging, and a single place to update when the approval API changes. Without this, each surface was duplicating the fetch logic with subtle differences (e.g., project inference, taskId handling).
