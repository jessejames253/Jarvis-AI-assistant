/**
 * components/PatchActionButtons.tsx — Shared "Approve Patch" / "Reject Patch" button pair.
 *
 * Used by every approval surface so there is exactly one implementation of
 * these buttons and tests can target them by accessible role + name from
 * any context:
 *
 *   getByRole("button", { name: /approve patch/i })
 *   getByRole("button", { name: /reject patch/i })
 *
 * Consumers:
 *   - DEV panel Patches tab card rows  (DevAgentPanel PatchesTab)
 *   - Jarvis main chat notification bar (Chat.tsx PatchNotificationBar)
 *   - Any future surface that needs approve / reject
 */

interface Props {
  patchId:   string;
  isApplying?: boolean;
  onApprove:   () => void;
  onReject:    () => void;
}

export default function PatchActionButtons({ patchId, isApplying, onApprove, onReject }: Props) {
  return (
    <div className="flex items-center gap-1.5" data-testid={`patch-action-buttons-${patchId}`}>
      <button
        type="button"
        onClick={onApprove}
        disabled={isApplying}
        aria-label="Approve Patch"
        data-testid="patch-approve-btn"
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold active:scale-95 transition-all disabled:opacity-40"
        style={{
          background: "hsl(142 60% 35% / 0.22)",
          border:     "1px solid hsl(142 60% 40% / 0.45)",
          color:      "hsl(142 71% 65%)",
        }}
      >
        {isApplying ? "Applying…" : "Approve Patch"}
      </button>

      <button
        type="button"
        onClick={onReject}
        disabled={isApplying}
        aria-label="Reject Patch"
        data-testid="patch-reject-btn"
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold active:scale-95 transition-all disabled:opacity-40"
        style={{
          background: "hsl(355 80% 40% / 0.12)",
          border:     "1px solid hsl(355 80% 45% / 0.35)",
          color:      "hsl(355 80% 62%)",
        }}
      >
        Reject Patch
      </button>
    </div>
  );
}
