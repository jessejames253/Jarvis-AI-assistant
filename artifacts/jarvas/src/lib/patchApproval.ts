/**
 * lib/patchApproval.ts — Shared patch approval / rejection helpers.
 *
 * Used by every approval surface:
 *   - Typed APPROVE / REJECT in DevAgentPanel sendMessage
 *   - Jarvis chat PatchNotificationBar (Chat.tsx)
 *   - DEV panel chat-tab PatchActionBar / DiffViewer (DevAgentPanel.tsx)
 *   - DEV panel Patches-tab card rows (DevAgentPanel PatchesTab)
 *
 * Centralises the HTTP call and console logging so there is exactly one
 * implementation of "approve this patch" regardless of which UI element
 * the user clicks.
 */

const BASE        = import.meta.env.BASE_URL ?? "/";
const APPLY_URL   = `${BASE}api/dev/apply`;
const PATCHES_URL = `${BASE}api/dev/patches`;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ApproveResult {
  ok:       boolean;
  error?:   string;
  snapshotId?:  string;
  validation?:  { passed: boolean; summary: string };
  autoFixResult?: unknown;
  validationEvents?: Array<Record<string, unknown>>;
}

export interface PendingPatchSummary {
  patchId:      string;
  file:         string;
  description:  string;
  riskLevel?:   "low" | "medium" | "high";
  uiImpact?:    string;
  logicImpact?: string;
  safeToTest?:  boolean;
  createdAt:    number;
}

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * POST /api/dev/apply — approve and apply a pending patch by its ID.
 *
 * @param patchId  The ID from the pending-patch queue.
 * @param file     The target file path (used to auto-detect the project).
 * @param opts.taskId   Optional task correlation ID.
 * @param opts.project  Override project detection ("jarvas" | "api-server").
 * @returns ApproveResult with ok, optional error, snapshotId, validation.
 */
export async function approvePatch(
  patchId: string,
  file:    string,
  opts:    { taskId?: string; project?: string } = {},
): Promise<ApproveResult> {
  const project =
    opts.project ?? (file.startsWith("artifacts/api-server") ? "api-server" : "jarvas");

  console.log(
    "[patchApproval] Approving patchId:", patchId,
    "| file:", file,
    "| project:", project,
    ...(opts.taskId ? ["| taskId:", opts.taskId] : []),
  );

  try {
    const res = await fetch(APPLY_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ patchId, taskId: opts.taskId, project }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err  = `Apply failed — HTTP ${res.status}: ${body.slice(0, 300)}`;
      console.error("[patchApproval]", err);
      return { ok: false, error: err };
    }

    const data = await res.json() as ApproveResult;
    if (!data.ok) console.warn("[patchApproval] Backend ok:false —", data.error);
    else           console.log("[patchApproval] Applied successfully, snapshotId:", data.snapshotId);
    return data;
  } catch (err) {
    const msg = `Network error: ${String(err)}`;
    console.error("[patchApproval]", msg);
    return { ok: false, error: msg };
  }
}

/**
 * Log and record a patch rejection.
 * Rejection is currently a client-side operation (removes from queue).
 * This function centralises the console trace so every rejection surface
 * produces the same log line.
 */
export function rejectPatch(patchId: string, file: string): void {
  console.log("[patchApproval] Rejecting patchId:", patchId, "| file:", file);
}

/**
 * Fetch the list of patches that are currently pending approval.
 */
export async function fetchPendingPatches(): Promise<PendingPatchSummary[]> {
  try {
    const res  = await fetch(PATCHES_URL);
    const data = await res.json() as { ok: boolean; patches?: PendingPatchSummary[] };
    return data.patches ?? [];
  } catch {
    return [];
  }
}
