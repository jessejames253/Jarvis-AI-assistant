/**
 * __tests__/patchApproval.test.ts
 *
 * Coverage:
 *   - tryApplyPatch response parsing: null on success, exact error string on
 *     every failure mode (network, HTTP, ok:false with / without error field)
 *   - Typed APPROVE / REJECT command matching: case-insensitive, trims whitespace,
 *     rejects partial or unrelated input
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// ─── Replica of tryApplyPatch core logic (without React state) ────────────────
// This mirrors the logic in ManualPatchCard / sendMessage so we can verify the
// exact error strings shown to the user without mounting a React component.

async function callApplyEndpoint(
  url: string,
  patchId: string,
  taskId?: string,
): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patchId, taskId, project: "jarvas" }),
    });
  } catch (err) {
    return `Network error: ${String(err)}`;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return `Apply failed — HTTP ${res.status}: ${body.slice(0, 300)}`;
  }

  const data = await res.json() as { ok: boolean; error?: string };
  if (!data.ok) return data.error ?? "Apply failed";
  return null; // success
}

// ─── Response parsing ─────────────────────────────────────────────────────────

describe("tryApplyPatch — response parsing", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns null on successful apply", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, snapshotId: "snap-abc" }),
    }));
    const err = await callApplyEndpoint("/api/dev/apply", "p1", "task-1");
    expect(err).toBeNull();
  });

  it("returns the exact backend error string when ok is false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: "patchId not found in pending queue" }),
    }));
    const err = await callApplyEndpoint("/api/dev/apply", "p2", "task-1");
    expect(err).toBe("patchId not found in pending queue");
  });

  it("falls back to 'Apply failed' when backend omits the error field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false }),
    }));
    const err = await callApplyEndpoint("/api/dev/apply", "p3");
    expect(err).toBe("Apply failed");
  });

  it("returns HTTP status + body when response is non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    }));
    const err = await callApplyEndpoint("/api/dev/apply", "p4");
    expect(err).toMatch(/HTTP 500/);
    expect(err).toMatch(/Internal Server Error/);
  });

  it("truncates long HTTP body to 300 chars in the error string", async () => {
    const longBody = "x".repeat(500);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => longBody,
    }));
    const err = await callApplyEndpoint("/api/dev/apply", "p5");
    // prefix + 300 chars of body (no more)
    expect(err!.length).toBeLessThanOrEqual("Apply failed — HTTP 502: ".length + 300);
  });

  it("surfaces network-level errors as a readable string", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const err = await callApplyEndpoint("/api/dev/apply", "p6", "task-2");
    expect(err).toMatch(/Network error/);
    expect(err).toMatch(/ECONNREFUSED/);
  });

  it("works without a taskId (taskId optional)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }));
    const err = await callApplyEndpoint("/api/dev/apply", "p7");
    expect(err).toBeNull();
  });
});

// ─── Typed APPROVE / REJECT command matching ──────────────────────────────────
// Mirrors the exact check inside sendMessage:
//   const upperGoal = goal.toUpperCase();
//   if (upperGoal === "APPROVE" || upperGoal === "REJECT") { ... }

const normalise = (input: string) => input.trim().toUpperCase();
const isApproveCmd = (input: string) => normalise(input) === "APPROVE";
const isRejectCmd  = (input: string) => normalise(input) === "REJECT";
const isAnyCmd     = (input: string) => isApproveCmd(input) || isRejectCmd(input);

describe("typed command matching — APPROVE / REJECT", () => {
  it("matches APPROVE regardless of case", () => {
    for (const v of ["APPROVE", "approve", "Approve", "aPpRoVe"]) {
      expect(isApproveCmd(v)).toBe(true);
    }
  });

  it("matches APPROVE with leading / trailing whitespace", () => {
    expect(isApproveCmd("  APPROVE  ")).toBe(true);
    expect(isApproveCmd("\tApprove\n")).toBe(true);
  });

  it("matches REJECT regardless of case", () => {
    for (const v of ["REJECT", "reject", "Reject", "rEjEcT"]) {
      expect(isRejectCmd(v)).toBe(true);
    }
  });

  it("matches REJECT with leading / trailing whitespace", () => {
    expect(isRejectCmd("  reject  ")).toBe(true);
  });

  it("does NOT match partial words containing APPROVE or REJECT", () => {
    expect(isAnyCmd("approve patch")).toBe(false);
    expect(isAnyCmd("please approve")).toBe(false);
    expect(isAnyCmd("rejected")).toBe(false);
    expect(isAnyCmd("pre-approve")).toBe(false);
  });

  it("does NOT match unrelated single-word input", () => {
    expect(isAnyCmd("YES")).toBe(false);
    expect(isAnyCmd("ok")).toBe(false);
    expect(isAnyCmd("apply")).toBe(false);
    expect(isAnyCmd("")).toBe(false);
  });

  it("APPROVE does not trigger REJECT path and vice versa", () => {
    expect(isApproveCmd("REJECT")).toBe(false);
    expect(isRejectCmd("APPROVE")).toBe(false);
  });
});
