/**
 * components/ChatPatchProposal.tsx — inline patch proposal card in Jarvis chat
 *
 * Rendered by MessageBubble when message.patchProposal is set (i.e. Jarvis used
 * the propose_code_change tool and got back a patchId from the backend).
 *
 * Shows real <button> elements with aria-labels so tests can find them by role:
 *   getByRole("button", { name: /approve patch/i })
 *   getByRole("button", { name: /reject patch/i })
 *
 * On Approve: calls approvePatch() from the shared lib, shows inline result.
 * On Reject:  calls rejectPatch() from the shared lib, shows rejected state.
 * Prevents double-click by disabling both buttons while applying.
 */

import { useState } from "react";
import { CheckCircle, XCircle, FileCode, AlertTriangle } from "lucide-react";
import { approvePatch, rejectPatch } from "@/lib/patchApproval";

export interface PatchProposalRef {
  patchId:     string;
  file:        string;
  description: string;
  riskLevel?:  "low" | "medium" | "high";
}

type Status = "pending" | "applying" | "applied" | "rejected" | "failed";

const riskColor = (r?: string) =>
  r === "high"   ? "hsl(355 80% 62%)"
  : r === "medium" ? "hsl(38 100% 62%)"
  : "hsl(142 71% 55%)";

const riskLabel = (r?: string) =>
  r === "high" ? "HIGH" : r === "medium" ? "MEDIUM" : "LOW";

export default function ChatPatchProposal({ proposal }: { proposal: PatchProposalRef }) {
  const [status,    setStatus]    = useState<Status>("pending");
  const [errorMsg,  setErrorMsg]  = useState<string | null>(null);
  const [validation, setValidation] = useState<string | null>(null);

  const isApplying = status === "applying";

  const handleApprove = async () => {
    if (isApplying) return;
    console.log("[Jarvis chat] approve clicked — patchId:", proposal.patchId);
    setStatus("applying");
    setErrorMsg(null);

    const result = await approvePatch(proposal.patchId, proposal.file);
    console.log("[Jarvis chat] backend response:", result);

    if (result.ok) {
      setStatus("applied");
      setValidation(result.validation?.summary ?? null);
    } else {
      setStatus("failed");
      setErrorMsg(result.error ?? "Apply failed");
    }
  };

  const handleReject = () => {
    console.log("[Jarvis chat] reject clicked — patchId:", proposal.patchId);
    rejectPatch(proposal.patchId, proposal.file);
    setStatus("rejected");
  };

  const fileName = proposal.file.split("/").pop() ?? proposal.file;

  // ── Applied state ──────────────────────────────────────────────────────────
  if (status === "applied") {
    return (
      <div
        data-testid="chat-patch-applied"
        className="mt-2 rounded-xl px-4 py-3 flex flex-col gap-1"
        style={{ background: "hsl(142 60% 20% / 0.25)", border: "1px solid hsl(142 60% 35% / 0.4)" }}
      >
        <div className="flex items-center gap-2">
          <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(142 71% 55%)" }} />
          <span className="text-sm font-semibold" style={{ color: "hsl(142 71% 65%)" }}>
            Patch applied — {fileName}
          </span>
        </div>
        {validation && (
          <p className="text-xs pl-6" style={{ color: "hsl(142 71% 45%)" }}>
            TS check: {validation}
          </p>
        )}
      </div>
    );
  }

  // ── Rejected state ─────────────────────────────────────────────────────────
  if (status === "rejected") {
    return (
      <div
        data-testid="chat-patch-rejected"
        className="mt-2 rounded-xl px-4 py-3 flex items-center gap-2"
        style={{ background: "hsl(355 80% 20% / 0.15)", border: "1px solid hsl(355 80% 40% / 0.3)" }}
      >
        <XCircle className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(355 80% 62%)" }} />
        <span className="text-sm" style={{ color: "hsl(355 80% 62%)" }}>
          Patch rejected — {fileName}
        </span>
      </div>
    );
  }

  // ── Pending / applying / failed state ─────────────────────────────────────
  return (
    <div
      data-testid="chat-patch-proposal"
      className="mt-2 rounded-xl flex flex-col gap-2 px-4 py-3"
      style={{
        background:  "hsl(38 100% 55% / 0.05)",
        border:      "1px solid hsl(38 100% 55% / 0.3)",
      }}
    >
      {/* Header row */}
      <div className="flex items-start gap-2 min-w-0">
        <FileCode className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "hsl(38 100% 62%)" }} />
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-xs font-mono truncate" style={{ color: "hsl(196 50% 65%)" }}>
            {proposal.file}
          </span>
          <span className="text-xs" style={{ color: "hsl(210 10% 65%)" }}>
            {proposal.description}
          </span>
        </div>
        <span
          className="text-xs font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ml-auto"
          style={{
            color:      riskColor(proposal.riskLevel),
            background: `${riskColor(proposal.riskLevel)}22`,
            border:     `1px solid ${riskColor(proposal.riskLevel)}44`,
          }}
        >
          {riskLabel(proposal.riskLevel)}
        </span>
      </div>

      {/* Error message — exact backend error string */}
      {errorMsg && (
        <div
          data-testid="chat-patch-error"
          className="flex items-center gap-2 rounded px-3 py-2 text-xs"
          style={{ background: "hsl(355 80% 25% / 0.2)", color: "hsl(355 80% 70%)" }}
        >
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          {errorMsg}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={handleApprove}
          disabled={isApplying}
          aria-label="Approve Patch"
          data-testid={`chat-approve-patch-${proposal.patchId}`}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                     active:scale-95 transition-all disabled:opacity-40"
          style={{
            background: "hsl(142 60% 35% / 0.22)",
            border:     "1px solid hsl(142 60% 40% / 0.45)",
            color:      "hsl(142 71% 65%)",
          }}
        >
          <CheckCircle className="w-3.5 h-3.5" />
          {isApplying ? "Applying…" : "Approve Patch"}
        </button>

        <button
          type="button"
          onClick={handleReject}
          disabled={isApplying}
          aria-label="Reject Patch"
          data-testid={`chat-reject-patch-${proposal.patchId}`}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                     active:scale-95 transition-all disabled:opacity-40"
          style={{
            background: "hsl(355 80% 40% / 0.12)",
            border:     "1px solid hsl(355 80% 45% / 0.35)",
            color:      "hsl(355 80% 62%)",
          }}
        >
          <XCircle className="w-3.5 h-3.5" />
          Reject Patch
        </button>

        <span className="text-xs ml-auto" style={{ color: "hsl(196 30% 45%)" }}>
          patchId: {proposal.patchId.slice(0, 8)}…
        </span>
      </div>
    </div>
  );
}
