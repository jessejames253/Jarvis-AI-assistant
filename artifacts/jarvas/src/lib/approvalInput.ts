/**
 * lib/approvalInput.ts — Parse typed approval/rejection shortcut commands.
 *
 * Extracts the intent-detection logic from DevAgentPanel.sendMessage into a
 * pure, independently-testable function so that:
 *   - "typed APPROVE still works"
 *   - "lowercase approve works"
 *   - "REJECT" / "reject" / " APPROVE " all work
 * can all be verified without rendering the full panel.
 */

export type ApprovalIntent = "approve" | "reject" | null;

/**
 * Determine whether a raw text input is an approval/rejection shortcut.
 *
 * Matches "APPROVE" or "REJECT" case-insensitively after trimming.
 * Returns null for any other input — the caller should route to normal flow.
 *
 * @param input  Raw text the user typed or dictated.
 * @returns      "approve" | "reject" | null
 */
export function parseApprovalInput(input: string): ApprovalIntent {
  const normalized = input.trim().toUpperCase();
  if (normalized === "APPROVE") return "approve";
  if (normalized === "REJECT")  return "reject";
  return null;
}
