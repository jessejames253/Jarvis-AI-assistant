/**
 * agent/tools/propose.ts — propose_code_change tool implementation
 *
 * When Jarvis's AI suggests a code change, it calls this tool to register
 * the change as a pending patch in the shared `pendingPatches` store.
 *
 * The patch is immediately visible in:
 *   - The Jarvis chat message (inline Approve/Reject buttons via ChatPatchProposal)
 *   - The DEV → Patches tab (polled via GET /api/dev/patches)
 *   - The Jarvis chat notification bar (polled every 15 s)
 *
 * The tool returns a structured object (not a string) so the SSE tool_done
 * event carries the patchId which Chat.tsx uses to attach patchProposal to
 * the message and render real buttons.
 */

import { registerPatch } from "../../dev/tools";

export async function proposeCodeChange(input: Record<string, unknown>): Promise<object> {
  const file        = String(input.file ?? "").trim();
  const description = String(input.description ?? "Code change").trim();
  const newContent  = String(input.newContent ?? "").trim();
  const oldContent  = String(input.oldContent ?? "").trim();
  const riskLevel   = (input.riskLevel as "low" | "medium" | "high" | undefined) ?? "medium";

  if (!file || !newContent) {
    return { error: "file and newContent are required" };
  }

  const patch = registerPatch({ file, description, oldContent, newContent, riskLevel });

  console.log("[propose_code_change] Patch registered — patchId:", patch.patchId, "file:", file);

  return {
    patchId:     patch.patchId,
    file:        patch.file,
    description: patch.description,
    riskLevel:   patch.riskLevel,
    // Include content so the frontend can resubmit if the backend loses the
    // patch after a server restart before the user has approved it.
    newContent:  patch.newContent,
    oldContent:  patch.oldContent,
    status:      "pending_approval",
    message:     "Code change queued for your review. Approve or Reject buttons will appear in the chat and in DEV → Patches.",
  };
}
