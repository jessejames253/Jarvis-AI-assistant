/**
 * restartRecovery.test.tsx — Phase 6B Server Restart Recovery
 *
 * Verifies all restart-recovery requirements:
 *
 *   ✓ fetchServerStatus() returns startedAt + recoveredPatchCount
 *   ✓ fetchServerStatus() returns null on network failure
 *   ✓ resubmitPatch() calls POST /api/dev/patches with full content
 *   ✓ resubmitPatch() returns new patchId on success
 *   ✓ resubmitPatch() returns ok:false with error on failure
 *   ✓ rejectPatch() calls DELETE /api/dev/patches/:id (persistent rejection)
 *   ✓ PendingPatchSummary.recoveredFromRestart is preserved through fetchPendingPatches
 *   ✓ ChatPatchProposal shows "Resubmit Patch" on restart error
 *   ✓ ChatPatchProposal "Resubmit Patch" calls resubmitPatch then approvePatch
 *   ✓ ChatPatchProposal does NOT show resubmit when newContent missing
 *   ✓ PatchNotificationBar shows recovery banner when recoveredPatchCount > 0
 *   ✓ PatchNotificationBar shows RECOVERED badge on recovered patches
 *   ✓ PatchNotificationBar renders when only recoveredPatchCount > 0 (no patches)
 *   ✓ Never auto-applies recovered patches (buttons remain; no auto-fire)
 */

import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  fetchServerStatus, resubmitPatch, rejectPatch, fetchPendingPatches,
} from "../lib/patchApproval";
import type { PendingPatchSummary, ServerStatus } from "../lib/patchApproval";
import ChatPatchProposal from "../components/ChatPatchProposal";
import PatchNotificationBar from "../components/PatchNotificationBar";
import type { PatchProposalRef } from "../components/ChatPatchProposal";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PATCH_ID   = "patch-recovery-001";
const PATCH_FILE = "artifacts/jarvas/src/components/Foo.tsx";
const NEW_CONTENT = "export default function Foo() { return <div>Fixed</div>; }";
const OLD_CONTENT = "export default function Foo() { return <div>Old</div>; }";

const makeProposal = (overrides?: Partial<PatchProposalRef>): PatchProposalRef => ({
  patchId:     PATCH_ID,
  file:        PATCH_FILE,
  description: "Fix Foo component",
  riskLevel:   "low",
  newContent:  NEW_CONTENT,
  oldContent:  OLD_CONTENT,
  ...overrides,
});

const makePatch = (overrides?: Partial<PendingPatchSummary>): PendingPatchSummary => ({
  patchId:     PATCH_ID,
  file:        PATCH_FILE,
  description: "Fix Foo component",
  riskLevel:   "low",
  createdAt:   Date.now(),
  ...overrides,
});

const SERVER_STARTED_AT = 1700000000000;

function makeServerStatus(overrides?: Partial<ServerStatus>): ServerStatus {
  return {
    ok:                  true,
    startedAt:           SERVER_STARTED_AT,
    recoveredPatchCount: 0,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchServerStatus() — GET /api/dev/server-status
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchServerStatus() — server status polling", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns startedAt and recoveredPatchCount from the backend", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => makeServerStatus({ recoveredPatchCount: 3 }),
    }));
    const status = await fetchServerStatus();
    expect(status).not.toBeNull();
    expect(status!.startedAt).toBe(SERVER_STARTED_AT);
    expect(status!.recoveredPatchCount).toBe(3);
  });

  it("returns null on network failure — never crashes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const status = await fetchServerStatus();
    expect(status).toBeNull();
  });

  it("returns null when ok:false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ ok: false }),
    }));
    const status = await fetchServerStatus();
    expect(status).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resubmitPatch() — POST /api/dev/patches (re-register after server restart)
// ─────────────────────────────────────────────────────────────────────────────

describe("resubmitPatch() — re-register a lost patch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calls POST /api/dev/patches with file, description, newContent, riskLevel", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, patchId: "new-patch-xyz" }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await resubmitPatch({
      file:        PATCH_FILE,
      description: "Fix Foo component",
      newContent:  NEW_CONTENT,
      oldContent:  OLD_CONTENT,
      riskLevel:   "low",
    });

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/api\/dev\/patches/);
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string);
    expect(body.file).toBe(PATCH_FILE);
    expect(body.newContent).toBe(NEW_CONTENT);
    expect(body.oldContent).toBe(OLD_CONTENT);
    expect(body.riskLevel).toBe("low");
  });

  it("returns ok:true and new patchId on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, patchId: "new-patch-xyz" }),
    }));
    const result = await resubmitPatch({ file: PATCH_FILE, description: "Fix", newContent: NEW_CONTENT });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.patchId).toBe("new-patch-xyz");
  });

  it("returns ok:false with error message on backend failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ ok: false, error: "validation failed" }),
    }));
    const result = await resubmitPatch({ file: PATCH_FILE, description: "Fix", newContent: NEW_CONTENT });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("validation failed");
  });

  it("returns ok:false on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    const result = await resubmitPatch({ file: PATCH_FILE, description: "Fix", newContent: NEW_CONTENT });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Network error/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// rejectPatch() — DELETE /api/dev/patches/:id (persistent rejection)
// ─────────────────────────────────────────────────────────────────────────────

describe("rejectPatch() — persistent server-side rejection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calls DELETE /api/dev/patches/:id with the correct patch ID", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({});
    vi.stubGlobal("fetch", fetchSpy);
    await rejectPatch(PATCH_ID, PATCH_FILE);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toMatch(new RegExp(`api/dev/patches/${PATCH_ID}`));
    expect(opts.method).toBe("DELETE");
  });

  it("does not throw on network failure (non-fatal)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(rejectPatch(PATCH_ID, PATCH_FILE)).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fetchPendingPatches() — recoveredFromRestart flag preserved
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchPendingPatches() — recoveredFromRestart propagation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("preserves recoveredFromRestart:true when backend includes it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({
        ok:      true,
        patches: [makePatch({ recoveredFromRestart: true })],
      }),
    }));
    const patches = await fetchPendingPatches();
    expect(patches[0].recoveredFromRestart).toBe(true);
  });

  it("recoveredFromRestart is falsy for new patches (not in payload)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({
        ok:      true,
        patches: [makePatch()],
      }),
    }));
    const patches = await fetchPendingPatches();
    expect(patches[0].recoveredFromRestart).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ChatPatchProposal — Resubmit Patch button (restart recovery)
// ─────────────────────────────────────────────────────────────────────────────

describe("ChatPatchProposal — restart recovery / Resubmit Patch", () => {
  afterEach(() => vi.unstubAllGlobals());

  function renderWithRestartError(newContent?: string) {
    const fetchSpy = vi.fn()
      // First call: approvePatch → server returns restart error
      .mockResolvedValueOnce({
        ok:   true,
        json: async () => ({
          ok:    false,
          error: "Patch not found — server may have restarted. Use Manual Patch to apply manually.",
        }),
      })
      // Second call: resubmitPatch (POST /api/dev/patches)
      .mockResolvedValueOnce({
        json: async () => ({ ok: true, patchId: "resubmit-patch-new" }),
      })
      // Third call: approvePatch with new patchId
      .mockResolvedValueOnce({
        ok:   true,
        json: async () => ({ ok: true, snapshotId: "snap-1", validation: { passed: true, summary: "passed" } }),
      });
    vi.stubGlobal("fetch", fetchSpy);

    const proposal = makeProposal({ newContent });
    render(<ChatPatchProposal proposal={proposal} />);
    return { fetchSpy };
  }

  it("shows 'Resubmit Patch' button after a restart error when newContent is present", async () => {
    renderWithRestartError(NEW_CONTENT);

    // Click Approve — triggers restart error from backend
    fireEvent.click(screen.getByRole("button", { name: /approve patch/i }));

    await waitFor(() => {
      expect(screen.getByTestId("chat-patch-restart-warning")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /resubmit patch/i })).toBeInTheDocument();
    });
  });

  it("does NOT show 'Resubmit Patch' when newContent is absent", async () => {
    renderWithRestartError(undefined); // no newContent

    fireEvent.click(screen.getByRole("button", { name: /approve patch/i }));

    await waitFor(() => {
      // Should still show a failure state, but no resubmit button
      expect(screen.queryByRole("button", { name: /resubmit patch/i })).not.toBeInTheDocument();
    });
  });

  it("'Resubmit Patch' re-registers and then applies the patch successfully", async () => {
    renderWithRestartError(NEW_CONTENT);

    // Trigger restart error
    fireEvent.click(screen.getByRole("button", { name: /approve patch/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /resubmit patch/i })).toBeInTheDocument(),
    );

    // Click Resubmit
    fireEvent.click(screen.getByRole("button", { name: /resubmit patch/i }));

    // Should end in applied state
    await waitFor(() =>
      expect(screen.getByTestId("chat-patch-applied")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /resubmit patch/i })).not.toBeInTheDocument();
  });

  it("never auto-applies — approval only happens on user click (buttons present, no auto-fire)", () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok:   true,
      json: async () => ({ ok: true, snapshotId: "x" }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const proposal = makeProposal();
    render(<ChatPatchProposal proposal={proposal} />);

    // On mount — no fetch calls should have been made
    expect(fetchSpy).not.toHaveBeenCalled();
    // Buttons must be present and await user action
    expect(screen.getByRole("button", { name: /approve patch/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reject patch/i })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PatchNotificationBar — recovery banner + RECOVERED badge
// ─────────────────────────────────────────────────────────────────────────────

describe("PatchNotificationBar — recovery banner and badges", () => {
  const recoveredPatch = makePatch({ recoveredFromRestart: true });
  const freshPatch     = makePatch({ patchId: "p-fresh", recoveredFromRestart: false });

  it("shows recovery banner when recoveredPatchCount > 0", () => {
    render(
      <PatchNotificationBar
        patches={[recoveredPatch]}
        serverStatus={makeServerStatus({ recoveredPatchCount: 2 })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByTestId("patch-recovery-banner")).toBeInTheDocument();
    expect(screen.getByTestId("patch-recovery-banner")).toHaveTextContent("2 patches recovered");
  });

  it("shows singular 'patch recovered' when count is 1", () => {
    render(
      <PatchNotificationBar
        patches={[recoveredPatch]}
        serverStatus={makeServerStatus({ recoveredPatchCount: 1 })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByTestId("patch-recovery-banner")).toHaveTextContent("1 patch recovered");
  });

  it("does NOT show recovery banner when recoveredPatchCount is 0", () => {
    render(
      <PatchNotificationBar
        patches={[freshPatch]}
        serverStatus={makeServerStatus({ recoveredPatchCount: 0 })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("patch-recovery-banner")).not.toBeInTheDocument();
  });

  it("renders the bar when recoveredPatchCount > 0 even if patches list is empty", () => {
    render(
      <PatchNotificationBar
        patches={[]}
        serverStatus={makeServerStatus({ recoveredPatchCount: 3 })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByTestId("patch-notification-bar")).toBeInTheDocument();
    expect(screen.getByTestId("patch-recovery-banner")).toBeInTheDocument();
  });

  it("shows RECOVERED badge on patches with recoveredFromRestart:true", () => {
    render(
      <PatchNotificationBar
        patches={[recoveredPatch]}
        serverStatus={makeServerStatus({ recoveredPatchCount: 1 })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByTestId(`patch-recovered-badge-${PATCH_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`patch-recovered-badge-${PATCH_ID}`)).toHaveTextContent("RECOVERED");
  });

  it("does NOT show RECOVERED badge on fresh patches", () => {
    render(
      <PatchNotificationBar
        patches={[freshPatch]}
        serverStatus={makeServerStatus({ recoveredPatchCount: 0 })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.queryByTestId(`patch-recovered-badge-p-fresh`)).not.toBeInTheDocument();
  });

  it("shows 'Manual approval required' message in recovery banner", () => {
    render(
      <PatchNotificationBar
        patches={[recoveredPatch]}
        serverStatus={makeServerStatus({ recoveredPatchCount: 1 })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByTestId("patch-recovery-banner")).toHaveTextContent("Manual approval required");
  });

  it("approve/reject buttons still work on recovered patches — not auto-applied", () => {
    const onApprove = vi.fn();
    const onReject  = vi.fn();
    render(
      <PatchNotificationBar
        patches={[recoveredPatch]}
        serverStatus={makeServerStatus({ recoveredPatchCount: 1 })}
        onApprove={onApprove}
        onReject={onReject}
      />,
    );
    // Buttons must still require manual click
    expect(onApprove).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /approve patch/i }));
    expect(onApprove).toHaveBeenCalledWith(recoveredPatch);
    expect(onReject).not.toHaveBeenCalled();
  });
});
