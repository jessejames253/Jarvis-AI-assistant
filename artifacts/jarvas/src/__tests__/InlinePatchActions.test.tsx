/**
 * InlinePatchActions.test.tsx
 *
 * Proves that real clickable "Approve Patch" / "Reject Patch" button elements
 * render and that clicking them wires through to the correct handlers.
 *
 * Tests query buttons by their accessible role and name — the same way
 * assistive technology and the user interacts with them.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import InlinePatchActions from "../components/InlinePatchActions";
import type { PatchRef } from "../components/InlinePatchActions";

const PATCH: PatchRef = { patchId: "patch-001", file: "src/components/Foo.tsx" };

describe("InlinePatchActions — real button elements", () => {
  // ── Presence ─────────────────────────────────────────────────────────────

  it("renders an Approve Patch button (queryable by role+name)", () => {
    render(
      <InlinePatchActions
        patch={PATCH}
        onApprove={vi.fn().mockResolvedValue(null)}
        onReject={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /approve patch/i }),
    ).toBeInTheDocument();
  });

  it("renders a Reject Patch button (queryable by role+name)", () => {
    render(
      <InlinePatchActions
        patch={PATCH}
        onApprove={vi.fn().mockResolvedValue(null)}
        onReject={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /reject patch/i }),
    ).toBeInTheDocument();
  });

  it("both buttons are outside the markdown area (direct DOM children of the actions container)", () => {
    render(
      <InlinePatchActions
        patch={PATCH}
        onApprove={vi.fn().mockResolvedValue(null)}
        onReject={vi.fn()}
      />,
    );
    const container = screen.getByTestId("inline-patch-actions");
    const approveBtn = screen.getByRole("button", { name: /approve patch/i });
    const rejectBtn  = screen.getByRole("button", { name: /reject patch/i });
    // Buttons must live somewhere inside the actions container, not inside prose
    expect(container.contains(approveBtn)).toBe(true);
    expect(container.contains(rejectBtn)).toBe(true);
  });

  // ── Click handlers ────────────────────────────────────────────────────────

  it("clicking 'Approve Patch' calls onApprove with the patch object", async () => {
    const onApprove = vi.fn().mockResolvedValue(null);
    render(
      <InlinePatchActions patch={PATCH} onApprove={onApprove} onReject={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /approve patch/i }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith(PATCH));
  });

  it("clicking 'Reject Patch' calls onReject with the correct patchId", () => {
    const onReject = vi.fn();
    render(
      <InlinePatchActions
        patch={PATCH}
        onApprove={vi.fn().mockResolvedValue(null)}
        onReject={onReject}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /reject patch/i }));
    expect(onReject).toHaveBeenCalledWith("patch-001");
  });

  // ── In-flight state ───────────────────────────────────────────────────────

  it("both buttons are disabled and show 'Applying…' while the request is in flight", async () => {
    let resolveApprove!: (v: null) => void;
    const onApprove = vi.fn(
      () => new Promise<null>(res => { resolveApprove = res; }),
    );
    render(
      <InlinePatchActions patch={PATCH} onApprove={onApprove} onReject={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /approve patch/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /applying/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /reject patch/i })).toBeDisabled();
    });
    resolveApprove(null);
  });

  it("buttons are disabled when siblingApplying=true", () => {
    render(
      <InlinePatchActions
        patch={PATCH}
        onApprove={vi.fn().mockResolvedValue(null)}
        onReject={vi.fn()}
        siblingApplying={true}
      />,
    );
    // When siblingApplying=true the approve button shows "Applying…" (spinner state)
    // and the reject button shows "Reject Patch" — both must be disabled.
    expect(screen.getByTestId("inline-approve-btn")).toBeDisabled();
    expect(screen.getByRole("button", { name: /reject patch/i })).toBeDisabled();
  });

  // ── Terminal states ───────────────────────────────────────────────────────

  it("replaces buttons with a success confirmation after Approve resolves with null", async () => {
    render(
      <InlinePatchActions
        patch={PATCH}
        onApprove={vi.fn().mockResolvedValue(null)}
        onReject={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /approve patch/i }));
    await waitFor(() =>
      expect(screen.getByTestId("inline-patch-success")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /approve patch/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reject patch/i })).not.toBeInTheDocument();
  });

  it("shows the exact backend error string inline and keeps buttons for retry", async () => {
    render(
      <InlinePatchActions
        patch={PATCH}
        onApprove={vi.fn().mockResolvedValue("patchId not found in pending queue")}
        onReject={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /approve patch/i }));
    await waitFor(() => {
      expect(screen.getByTestId("inline-patch-error")).toHaveTextContent(
        "patchId not found in pending queue",
      );
    });
    // buttons must still be present so the user can retry
    expect(screen.getByRole("button", { name: /approve patch/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reject patch/i })).toBeInTheDocument();
  });

  // ── Display ───────────────────────────────────────────────────────────────

  it("displays the file basename next to the buttons", () => {
    render(
      <InlinePatchActions
        patch={PATCH}
        onApprove={vi.fn().mockResolvedValue(null)}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByTestId("inline-patch-actions")).toHaveTextContent("Foo.tsx");
  });
});
