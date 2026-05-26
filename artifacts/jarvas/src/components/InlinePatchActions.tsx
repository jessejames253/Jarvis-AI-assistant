/**
 * InlinePatchActions.tsx
 *
 * Renders real Approve / Reject buttons directly below an agent message card
 * when there is a pending patch proposal in the surrounding message context.
 *
 * Exported so it can be independently unit-tested.
 */

import { useState } from "react";
import { Check, AlertTriangle } from "lucide-react";

// Minimal patch reference — DevAgentPanel's PatchData satisfies this structurally
export interface PatchRef {
  patchId: string;
  file:    string;
}

export interface InlinePatchActionsProps {
  patch:            PatchRef;
  /** Called when Approve is clicked. Returns null on success or an error string. */
  onApprove:        (patch: PatchRef) => Promise<string | null>;
  onReject:         (patchId: string) => void;
  /** Pass true while the sibling DiffViewer card is already applying the same patch. */
  siblingApplying?: boolean;
}

export default function InlinePatchActions({
  patch,
  onApprove,
  onReject,
  siblingApplying,
}: InlinePatchActionsProps) {
  const [applying, setApplying]   = useState(false);
  const [error,    setError]      = useState<string | null>(null);
  const [applied,  setApplied]    = useState(false);

  const isApplying = applying || !!siblingApplying;
  const fileName   = patch.file.split("/").pop() ?? patch.file;

  const handleApprove = async () => {
    setApplying(true);
    setError(null);
    const err = await onApprove(patch);
    setApplying(false);
    if (err) setError(err);
    else     setApplied(true);
  };

  if (applied) {
    return (
      <div
        data-testid="inline-patch-success"
        className="flex items-center gap-2 mt-2 text-xs"
        style={{ color: "hsl(142 71% 60%)" }}
      >
        <Check className="w-3.5 h-3.5" />
        <span>Patch applied — <span className="font-mono">{fileName}</span></span>
      </div>
    );
  }

  return (
    <div data-testid="inline-patch-actions" className="mt-2 flex flex-col gap-1.5">
      {error && (
        <div
          data-testid="inline-patch-error"
          className="flex items-start gap-2 px-2 py-1.5 rounded-md text-xs"
          style={{
            background: "hsl(355 80% 40% / 0.12)",
            border:     "1px solid hsl(355 80% 45% / 0.35)",
            color:      "hsl(355 80% 68%)",
          }}
        >
          <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <span className="break-all">{error}</span>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          data-testid="inline-approve-btn"
          onClick={handleApprove}
          disabled={isApplying}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 active:scale-95 disabled:opacity-50"
          style={{
            background: "hsl(142 60% 35% / 0.25)",
            border:     "1px solid hsl(142 60% 40% / 0.5)",
            color:      "hsl(142 71% 65%)",
          }}
        >
          {isApplying ? (
            <>
              <span
                className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin"
                aria-hidden="true"
              />
              Applying…
            </>
          ) : "Approve Patch"}
        </button>

        <button
          type="button"
          data-testid="inline-reject-btn"
          onClick={() => onReject(patch.patchId)}
          disabled={isApplying}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 active:scale-95 disabled:opacity-50"
          style={{
            background: "hsl(355 80% 40% / 0.15)",
            border:     "1px solid hsl(355 80% 45% / 0.4)",
            color:      "hsl(355 80% 62%)",
          }}
        >
          Reject Patch
        </button>

        <span className="text-[10px] truncate" style={{ color: "hsl(196 30% 40%)" }}>
          {fileName}
        </span>
      </div>
    </div>
  );
}
