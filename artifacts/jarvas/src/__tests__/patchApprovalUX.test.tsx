/**
 * patchApprovalUX.test.tsx
 *
 * Proves all three approval-UX surfaces produce real, clickable
 * "Approve Patch" / "Reject Patch" buttons that tests (and assistive
 * technology) can find by accessible role + name.
 *
 * Surface 1 — Shared lib functions (approvePatch / rejectPatch)
 * Surface 2 — PatchActionButtons shared component
 *              (used by both DEV Patches-tab cards AND the Jarvis chat bar)
 * Surface 3 — InlinePatchActions (DEV panel chat-tab look-ahead)
 *
 * Tests verify:
 *   • getByRole("button", { name: /approve patch/i }) succeeds in every surface
 *   • getByRole("button", { name: /reject patch/i })  succeeds in every surface
 *   • clicking wires through to the correct handler
 *   • in-flight / disabled state is correct
 *   • the shared approvePatch lib sends the right HTTP payload
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import PatchActionButtons from "../components/PatchActionButtons";
import InlinePatchActions from "../components/InlinePatchActions";
import type { PatchRef } from "../components/InlinePatchActions";
import { approvePatch, rejectPatch, fetchPendingPatches } from "../lib/patchApproval";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PATCH_ID   = "patch-abc123";
const PATCH_FILE = "artifacts/jarvas/src/components/Foo.tsx";

const INLINE_PATCH: PatchRef = { patchId: PATCH_ID, file: PATCH_FILE };

// ─────────────────────────────────────────────────────────────────────────────
// Surface 1 — Shared lib: approvePatch / rejectPatch / fetchPendingPatches
// ─────────────────────────────────────────────────────────────────────────────

describe("approvePatch() — shared approval lib", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("POST /api/dev/apply with correct patchId, file, and project", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, snapshotId: "snap-1", validation: { passed: true, summary: "clean" } }),
    });

    await approvePatch(PATCH_ID, PATCH_FILE);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/api\/dev\/apply/);
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string);
    expect(body.patchId).toBe(PATCH_ID);
    expect(body.project).toBe("jarvas");
  });

  it("infers project=api-server when file starts with artifacts/api-server", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await approvePatch(PATCH_ID, "artifacts/api-server/src/routes/dev.ts");

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.project).toBe("api-server");
  });

  it("propagates a taskId when provided", async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    await approvePatch(PATCH_ID, PATCH_FILE, { taskId: "task-99" });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.taskId).toBe("task-99");
  });

  it("returns ok:true with snapshotId + validation on success", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        snapshotId: "snap-42",
        validation: { passed: true, summary: "All checks passed" },
      }),
    });

    const result = await approvePatch(PATCH_ID, PATCH_FILE);

    expect(result.ok).toBe(true);
    expect(result.snapshotId).toBe("snap-42");
    expect(result.validation?.passed).toBe(true);
    expect(result.validation?.summary).toBe("All checks passed");
  });

  it("returns ok:false with error when backend returns ok:false", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: "patchId not found in pending queue" }),
    });

    const result = await approvePatch(PATCH_ID, PATCH_FILE);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("patchId not found in pending queue");
  });

  it("returns ok:false with HTTP error details when response is not ok", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    const result = await approvePatch(PATCH_ID, PATCH_FILE);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/HTTP 500/);
  });

  it("returns ok:false on network failure", async () => {
    fetchSpy.mockRejectedValue(new Error("fetch failed"));

    const result = await approvePatch(PATCH_ID, PATCH_FILE);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Network error/);
  });
});

describe("rejectPatch() — shared rejection lib", () => {
  it("logs the patchId and file to console", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    rejectPatch(PATCH_ID, PATCH_FILE);
    // console.log("[patchApproval] Rejecting patchId:", patchId, "| file:", file)
    expect(spy).toHaveBeenCalledWith(
      "[patchApproval] Rejecting patchId:",
      PATCH_ID,
      "| file:",
      PATCH_FILE,
    );
    spy.mockRestore();
  });
});

describe("fetchPendingPatches() — shared fetch helper", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("returns the patches array from the backend", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, patches: [{ patchId: "p1", file: "foo.ts", description: "desc", createdAt: 1 }] }),
    }));

    const patches = await fetchPendingPatches();
    expect(patches).toHaveLength(1);
    expect(patches[0].patchId).toBe("p1");
  });

  it("returns an empty array when fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const patches = await fetchPendingPatches();
    expect(patches).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Surface 2 — PatchActionButtons (used by DEV Patches-tab AND Chat bar)
// ─────────────────────────────────────────────────────────────────────────────

describe("PatchActionButtons — shared button pair", () => {
  it("renders an 'Approve Patch' button queryable by role+name", () => {
    render(
      <PatchActionButtons
        patchId={PATCH_ID}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /approve patch/i })).toBeInTheDocument();
  });

  it("renders a 'Reject Patch' button queryable by role+name", () => {
    render(
      <PatchActionButtons
        patchId={PATCH_ID}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /reject patch/i })).toBeInTheDocument();
  });

  it("clicking 'Approve Patch' calls onApprove once", () => {
    const onApprove = vi.fn();
    render(
      <PatchActionButtons patchId={PATCH_ID} onApprove={onApprove} onReject={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /approve patch/i }));
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it("clicking 'Reject Patch' calls onReject once", () => {
    const onReject = vi.fn();
    render(
      <PatchActionButtons patchId={PATCH_ID} onApprove={vi.fn()} onReject={onReject} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /reject patch/i }));
    expect(onReject).toHaveBeenCalledOnce();
  });

  it("disables both buttons and shows 'Applying…' when isApplying=true", () => {
    render(
      <PatchActionButtons
        patchId={PATCH_ID}
        isApplying={true}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    // aria-label "Approve Patch" is always present regardless of text content
    expect(screen.getByRole("button", { name: /approve patch/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /reject patch/i })).toBeDisabled();
    expect(screen.getByTestId("patch-approve-btn")).toHaveTextContent("Applying…");
  });

  it("both buttons are enabled by default (isApplying=false)", () => {
    render(
      <PatchActionButtons patchId={PATCH_ID} onApprove={vi.fn()} onReject={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /approve patch/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /reject patch/i })).not.toBeDisabled();
  });

  it("wraps buttons in a container tagged with the patchId", () => {
    render(
      <PatchActionButtons patchId="my-patch" onApprove={vi.fn()} onReject={vi.fn()} />,
    );
    expect(
      screen.getByTestId("patch-action-buttons-my-patch"),
    ).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Surface 3 — InlinePatchActions (DEV panel chat-tab look-ahead)
//             Already has its own test file; this verifies the shared contract.
// ─────────────────────────────────────────────────────────────────────────────

describe("InlinePatchActions — DEV chat-tab look-ahead", () => {
  it("renders an 'Approve Patch' button queryable by role+name", () => {
    render(
      <InlinePatchActions
        patch={INLINE_PATCH}
        onApprove={vi.fn().mockResolvedValue(null)}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /approve patch/i })).toBeInTheDocument();
  });

  it("renders a 'Reject Patch' button queryable by role+name", () => {
    render(
      <InlinePatchActions
        patch={INLINE_PATCH}
        onApprove={vi.fn().mockResolvedValue(null)}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /reject patch/i })).toBeInTheDocument();
  });

  it("clicking 'Approve Patch' calls onApprove with the patch ref", async () => {
    const onApprove = vi.fn().mockResolvedValue(null);
    render(
      <InlinePatchActions patch={INLINE_PATCH} onApprove={onApprove} onReject={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /approve patch/i }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith(INLINE_PATCH));
  });

  it("clicking 'Reject Patch' calls onReject with the patchId", () => {
    const onReject = vi.fn();
    render(
      <InlinePatchActions
        patch={INLINE_PATCH}
        onApprove={vi.fn().mockResolvedValue(null)}
        onReject={onReject}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /reject patch/i }));
    expect(onReject).toHaveBeenCalledWith(PATCH_ID);
  });
});
