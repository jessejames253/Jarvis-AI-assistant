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
 *
 * Recovery banner:
 *   When serverStatus.recoveredPatchCount > 0, a banner is shown above the
 *   patch list indicating how many patches survived a server restart.
 *   Each patch row also shows a "RECOVERED" badge if recoveredFromRestart=true.
 */

import { CheckCircle, XCircle, FileEdit, RefreshCw } from "lucide-react";
import type { PendingPatchSummary, ServerStatus } from "@/lib/patchApproval";

interface Props {
  patches:       PendingPatchSummary[];
  approvingId?:  string | null;
  errorMessage?: string | null;
  serverStatus?: ServerStatus | null;
  onApprove:     (patch: PendingPatchSummary) => void;
  onReject:      (patch: PendingPatchSummary) => void;
}

export default function PatchNotificationBar({
  patches,
  approvingId,
  errorMessage,
  serverStatus,
  onApprove,
  onReject,
}: Props) {
  const hasRecovered = (serverStatus?.recoveredPatchCount ?? 0) > 0;
  const showBar = patches.length > 0 || hasRecovered;

  if (!showBar) return null;

  return (
    <div
      data-testid="patch-notification-bar"
      className="relative z-10 flex-shrink-0 border-t border-b flex flex-col gap-1.5 px-4 sm:px-8 py-2.5"
      style={{ borderColor: "hsl(38 100% 55% / 0.35)", background: "hsl(38 100% 55% / 0.06)" }}
    >
      {/* Recovery banner */}
      {hasRecovered && (
        <div
          data-testid="patch-recovery-banner"
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg mb-0.5"
          style={{
            background: "hsl(196 100% 45% / 0.10)",
            border:     "1px solid hsl(196 100% 55% / 0.3)",
          }}
        >
          <RefreshCw className="w-3 h-3 flex-shrink-0" style={{ color: "hsl(196 100% 65%)" }} />
          <span className="text-xs font-semibold" style={{ color: "hsl(196 100% 75%)" }}>
            Server restarted — {serverStatus!.recoveredPatchCount} patch{serverStatus!.recoveredPatchCount === 1 ? "" : "es"} recovered. Manual approval required.
          </span>
        </div>
      )}

      {patches.length > 0 && (
        <div className="flex items-center gap-1.5">
          <FileEdit className="w-3 h-3 flex-shrink-0" style={{ color: "hsl(38 100% 62%)" }} />
          <span className="text-xs font-semibold tracking-wider" style={{ color: "hsl(38 100% 62%)" }}>
            PENDING PATCHES — approve or reject:
          </span>
        </div>
      )}

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

          {/* Sync status badge */}
          {p.recoveredFromRestart && (
            <span
              data-testid={`patch-recovered-badge-${p.patchId}`}
              className="text-[9px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
              style={{
                background: "hsl(196 100% 45% / 0.15)",
                border:     "1px solid hsl(196 100% 55% / 0.35)",
                color:      "hsl(196 100% 70%)",
              }}
            >
              RECOVERED
            </span>
          )}

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
