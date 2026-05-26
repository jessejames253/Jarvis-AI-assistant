/**
 * InlinePatchActions.test.tsx
 *
 * Proves that the Approve / Reject button elements render correctly and that
 * clicking them triggers the correct handlers with the right patch ID.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import InlinePatchActions from "../components/InlinePatchActions";
import type { PatchRef } from "../components/InlinePatchActions";

const PATCH: PatchRef = { patchId: "patch-001", file: "src/components/Foo.tsx" };

describe("InlinePatchActions — button rendering", () => {
  it("renders an Approve button and a Reject button", () => {
    render(
      <InlinePatchActions
        patch={PATCH}
        onApprove={vi.fn().mockResolvedValue(null)}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByTestId("inline-approve-btn")).toBeInTheDocument();
    expect(screen.getByTestId("inline-reject-btn")).toBeInTheDocument();
  });

  it("Approve button text is '✓ Approve' when idle", () => {
    render(
      <InlinePatchActions
        patch={PATCH}
        onApprove={vi.fn().mockResolvedValue(null)}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByTestId("inline-approve-btn")).toHaveTextContent("✓ Approve");
  });

  it("Reject button is labelled '✕ Reject'", () => {
    render(
      <InlinePatchActions
        patch={PATCH}
        onApprove={vi.fn().mockResolvedValue(null)}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByTestId("inline-reject-btn")).toHaveTextContent("✕ Reject");
  });

  it("clicking Approve calls onApprove with the patch object", async () => {
    const onApprove = vi.fn().mockResolvedValue(null);
    render(
      <InlinePatchActions patch={PATCH} onApprove={onApprove} onReject={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("inline-approve-btn"));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith(PATCH));
  });

  it("clicking Reject calls onReject with the correct patchId", () => {
    const onReject = vi.fn();
    render(
      <InlinePatchActions
        patch={PATCH}
        onApprove={vi.fn().mockResolvedValue(null)}
        onReject={onReject}
      />,
    );
    fireEvent.click(screen.getByTestId("inline-reject-btn"));
    expect(onReject).toHaveBeenCalledWith("patch-001");
  });

  it("shows 'Applying…' text and disables both buttons while applying", async () => {
    let resolveApprove!: (v: null) => void;
    const onApprove = vi.fn(
      () => new Promise<null>(res => { resolveApprove = res; }),
    );
    render(
      <InlinePatchActions patch={PATCH} onApprove={onApprove} onReject={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("inline-approve-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("inline-approve-btn")).toBeDisabled();
      expect(screen.getByTestId("inline-reject-btn")).toBeDisabled();
      expect(screen.getByTestId("inline-approve-btn")).toHaveTextContent("Applying…");
    });
    resolveApprove(null);
  });

  it("disables buttons when siblingApplying=true", () => {
    render(
      <InlinePatchActions
        patch={PATCH}
        onApprove={vi.fn().mockResolvedValue(null)}
        onReject={vi.fn()}
        siblingApplying={true}
      />,
    );
    expect(screen.getByTestId("inline-approve-btn")).toBeDisabled();
    expect(screen.getByTestId("inline-reject-btn")).toBeDisabled();
  });

  it("shows success state after Approve resolves with null", async () => {
    render(
      <InlinePatchActions
        patch={PATCH}
        onApprove={vi.fn().mockResolvedValue(null)}
        onReject={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("inline-approve-btn"));
    await waitFor(() =>
      expect(screen.getByTestId("inline-patch-success")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("inline-approve-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("inline-reject-btn")).not.toBeInTheDocument();
  });

  it("shows inline error and keeps buttons when Approve returns an error string", async () => {
    render(
      <InlinePatchActions
        patch={PATCH}
        onApprove={vi.fn().mockResolvedValue("patchId not found in pending queue")}
        onReject={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("inline-approve-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("inline-patch-error")).toBeInTheDocument();
      expect(screen.getByTestId("inline-patch-error")).toHaveTextContent(
        "patchId not found in pending queue",
      );
    });
    // buttons still present so user can retry
    expect(screen.getByTestId("inline-approve-btn")).toBeInTheDocument();
    expect(screen.getByTestId("inline-reject-btn")).toBeInTheDocument();
  });

  it("displays the file basename next to the action buttons", () => {
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
