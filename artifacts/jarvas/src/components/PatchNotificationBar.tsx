/**
 * components/PatchNotificationBar.tsx — Jarvis chat pending-patch bar.
 *
 * Renders one row per pending patch with "Approve Patch" / "Reject Patch"
 * buttons that mirror the same approval logic used by the DEV panel.
 * Extracted from Chat.tsx so it can be rendered and tested in isolation:
 *
 *   getByRole("button", { name: /approve patch/i })
 *   getByRole("button", { name: /reject patch/i })
 *
 * Props are pure data + callbacks — no fetch, no side effects.
 * Chat.tsx owns the state (polling, dismissedIds) and passes filtered patches.
 */

import { CheckCircle, XCircle, FileEdit } from "lucide-react";
import type { PendingPatchSummary } from "@/lib/patchApproval";

interface Props {
  patches:       PendingPatchSummary[];
  approvingId?:  string | null;
  errorMessage?: string | null;
  onApprove:     (patch: PendingPatchSummary) => void;
  onReject:      (patch: PendingPatchSummary) => void;
}

export default function PatchNotificationBar({
  patches,
  approvingId,
  errorMessage,
  onApprove,
  onReject,
}: Props) {
  if (patches.length === 0) return null;

  return (
    <div
      data-testid="patch-notification-bar"
      className="relative z-10 flex-shrink-0 border-t border-b flex flex-col gap-1.5 px-4 sm:px-8 py-2.5"
      style={{ borderColor: "hsl(38 100% 55% / 0.35)", background: "hsl(38 100% 55% / 0.06)" }}
    >
      <div className="flex items-center gap-1.5">
        <FileEdit className="w-3 h-3 flex-shrink-0" style={{ color: "hsl(38 100% 62%)" }} />
        <span className="text-xs font-semibold tracking-wider" style={{ color: "hsl(38 100% 62%)" }}>
          PENDING PATCHES — approve or reject:
        </span>
      </div>

      {errorMessage && (
        <p
          className="text-xs pl-4"
          data-testid="patch-bar-error"
          style={{ color: "hsl(355 80% 62%)" }}
        >
          {errorMessage}
        </p>
      )}

      {patches.map(p => (
        <div key={p.patchId} className="flex items-center gap-2 pl-4 min-w-0">
          <span
            className="font-mono text-xs truncate flex-1 min-w-0"
            data-testid={`patch-filename-${p.patchId}`}
            style={{ color: "hsl(196 50% 65%)" }}
          >
            {p.file.split("/").pop()}
          </span>

          <button
            type="button"
            onClick={() => onApprove(p)}
            disabled={approvingId === p.patchId}
            aria-label="Approve Patch"
            data-testid={`approve-patch-${p.patchId}`}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold active:scale-95 transition-all disabled:opacity-40 flex-shrink-0"
            style={{
              background: "hsl(142 60% 35% / 0.22)",
              border:     "1px solid hsl(142 60% 40% / 0.45)",
              color:      "hsl(142 71% 65%)",
            }}
          >
            <CheckCircle className="w-3 h-3" />
            {approvingId === p.patchId ? "Applying…" : "Approve Patch"}
          </button>

          <button
            type="button"
            onClick={() => onReject(p)}
            disabled={approvingId === p.patchId}
            aria-label="Reject Patch"
            data-testid={`reject-patch-${p.patchId}`}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold active:scale-95 transition-all disabled:opacity-40 flex-shrink-0"
            style={{
              background: "hsl(355 80% 40% / 0.12)",
              border:     "1px solid hsl(355 80% 45% / 0.35)",
              color:      "hsl(355 80% 62%)",
            }}
          >
            <XCircle className="w-3 h-3" />
            Reject Patch
          </button>
        </div>
      ))}
    </div>
  );
}
