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

const BASE           = import.meta.env.BASE_URL ?? "/";
const APPLY_URL      = `${BASE}api/dev/apply`;
const PATCHES_URL    = `${BASE}api/dev/patches`;
const SERVER_STATUS_URL = `${BASE}api/dev/server-status`;

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
  /** True when this patch was loaded from disk after a server restart. */
  recoveredFromRestart?: boolean;
}

export interface ServerStatus {
  ok:                  boolean;
  startedAt:           number;
  recoveredPatchCount: number;
}

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * POST /api/dev/apply — approve and apply a pending patch by its ID.
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
 * DELETE /api/dev/patches/:id — persistently reject a patch.
 * This removes it from the server queue and saves to disk so the rejection
 * survives page refreshes and server restarts.
 */
export async function rejectPatch(patchId: string, file: string): Promise<void> {
  console.log("[patchApproval] Rejecting patchId:", patchId, "| file:", file);
  try {
    await fetch(`${PATCHES_URL}/${patchId}`, { method: "DELETE" });
  } catch (err) {
    console.warn("[patchApproval] DELETE patch failed (non-fatal):", String(err));
  }
}

/**
 * Re-register a patch whose server record was lost after a backend restart.
 * Calls POST /api/dev/patches with the stored content and returns the new patchId,
 * or null if newContent is missing or the request fails.
 */
export async function resubmitPatch(params: {
  file:        string;
  description: string;
  newContent:  string;
  oldContent?: string;
  riskLevel?:  "low" | "medium" | "high";
}): Promise<{ ok: true; patchId: string } | { ok: false; error: string }> {
  console.log("[patchApproval] Resubmitting patch for:", params.file);
  try {
    const res = await fetch(PATCHES_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        file:        params.file,
        description: params.description,
        newContent:  params.newContent,
        oldContent:  params.oldContent ?? "",
        riskLevel:   params.riskLevel ?? "medium",
      }),
    });
    const data = await res.json() as { ok: boolean; patchId?: string; error?: string };
    if (data.ok && data.patchId) {
      console.log("[patchApproval] Resubmitted — new patchId:", data.patchId);
      return { ok: true, patchId: data.patchId };
    }
    return { ok: false, error: data.error ?? "Resubmit failed" };
  } catch (err) {
    const msg = `Network error: ${String(err)}`;
    console.error("[patchApproval] resubmitPatch:", msg);
    return { ok: false, error: msg };
  }
}

/**
 * GET /api/dev/server-status — returns when the backend started and how many
 * patches were recovered from disk. The frontend polls this to detect restarts.
 */
export async function fetchServerStatus(): Promise<ServerStatus | null> {
  try {
    const res  = await fetch(SERVER_STATUS_URL);
    const data = await res.json() as ServerStatus;
    return data.ok ? data : null;
  } catch {
    return null;
  }
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
