/**
 * routes/autonomy.ts — Phase 6 autonomy REST API.
 *
 * All endpoints require explicit user action — no auto-start, no scheduling.
 *
 * Endpoints:
 *   POST   /autonomy/cycles            — start a new cycle (user-triggered only)
 *   GET    /autonomy/cycles            — list all cycles
 *   GET    /autonomy/cycles/:id        — get cycle state
 *   POST   /autonomy/cycles/:id/pause  — pause active cycle
 *   POST   /autonomy/cycles/:id/stop   — stop active cycle
 *   POST   /autonomy/cycles/:id/resume — resume paused cycle
 *   GET    /autonomy/cycles/:id/report — get final report
 *   GET    /autonomy/audit             — full audit log
 *   GET    /autonomy/audit/:cycleId    — audit for one cycle
 *   GET    /autonomy/proposals         — memory-based improvement suggestions
 *   GET    /autonomy/budget/default    — default budget config
 *   POST   /autonomy/budget/validate   — validate a budget config
 *   GET    /autonomy/policy/blocked    — list blocked patterns/paths
 *   GET    /autonomy/active            — get currently active cycle
 */

import { Router }            from "express";
import {
  startCycle, pauseCycle, stopCycle, resumeCycle,
  getCycle, getActiveCycle, listCycles, getCycleReport, getProposals,
}                            from "../lib/autonomy/autonomyController";
import {
  getAuditLog, getCycleAudit, getRecentAudit, totalAuditEntries,
}                            from "../lib/autonomy/autonomyAudit";
import { DEFAULT_BUDGET }    from "../lib/autonomy/autonomyBudget";
import {
  listBlockedPatterns, listBlockedExactPaths, validateFiles,
}                            from "../lib/autonomy/autonomyPolicy";
import { CYCLE_META }        from "../lib/autonomy/improvementCycle";
import type { CycleType }    from "../lib/autonomy/improvementCycle";
import type { BudgetConfig } from "../lib/autonomy/autonomyBudget";

const router = Router();

// ─── Cycle types meta ─────────────────────────────────────────────────────────

router.get("/autonomy/cycle-types", (_req, res) => {
  res.json({ cycleTypes: CYCLE_META });
});

// ─── Active cycle ─────────────────────────────────────────────────────────────

router.get("/autonomy/active", (_req, res) => {
  const active = getActiveCycle();
  res.json({ active: active ?? null });
});

// ─── Start cycle (user-triggered only) ───────────────────────────────────────

router.post("/autonomy/cycles", async (req, res) => {
  try {
    const { type, budget } = req.body as { type: CycleType; budget?: Partial<BudgetConfig> };

    if (!type) {
      return res.status(400).json({ error: "Cycle type is required" });
    }
    if (!Object.keys(CYCLE_META).includes(type)) {
      return res.status(400).json({
        error:        `Unknown cycle type: ${type}`,
        validTypes:   Object.keys(CYCLE_META),
      });
    }

    const cycle = await startCycle(type, budget ?? {});
    return res.json({ cycle });
  } catch (err) {
    const msg = String(err);
    const status = msg.includes("already running") ? 409 : 500;
    return res.status(status).json({ error: msg });
  }
});

// ─── List cycles ──────────────────────────────────────────────────────────────

router.get("/autonomy/cycles", (_req, res) => {
  const limit  = Math.min(Number(_req.query.limit) || 20, 50);
  const cycles = listCycles(limit);
  res.json({ cycles, total: cycles.length });
});

// ─── Get cycle ────────────────────────────────────────────────────────────────

router.get("/autonomy/cycles/:id", (req, res) => {
  const cycle = getCycle(req.params.id);
  if (!cycle) return res.status(404).json({ error: "Cycle not found" });
  return res.json({ cycle });
});

// ─── Get cycle report ─────────────────────────────────────────────────────────

router.get("/autonomy/cycles/:id/report", (req, res) => {
  const report = getCycleReport(req.params.id);
  if (!report) return res.status(404).json({ error: "Report not available for this cycle" });
  return res.json({ report });
});

// ─── Pause cycle ──────────────────────────────────────────────────────────────

router.post("/autonomy/cycles/:id/pause", (req, res) => {
  try {
    const cycle = pauseCycle(req.params.id);
    return res.json({ cycle, message: "Cycle paused" });
  } catch (err) {
    return res.status(400).json({ error: String(err) });
  }
});

// ─── Stop cycle ───────────────────────────────────────────────────────────────

router.post("/autonomy/cycles/:id/stop", (req, res) => {
  try {
    const cycle = stopCycle(req.params.id);
    return res.json({ cycle, message: "Cycle stopped" });
  } catch (err) {
    return res.status(400).json({ error: String(err) });
  }
});

// ─── Resume cycle ─────────────────────────────────────────────────────────────

router.post("/autonomy/cycles/:id/resume", (req, res) => {
  try {
    const cycle = resumeCycle(req.params.id);
    return res.json({ cycle, message: "Cycle resumed" });
  } catch (err) {
    return res.status(400).json({ error: String(err) });
  }
});

// ─── Audit log ────────────────────────────────────────────────────────────────

router.get("/autonomy/audit", (req, res) => {
  const limit   = Math.min(Number(req.query.limit) || 50, 200);
  const cycleId = req.query.cycleId as string | undefined;
  const entries = cycleId
    ? getCycleAudit(cycleId)
    : getRecentAudit(limit);
  res.json({ entries, total: totalAuditEntries() });
});

router.get("/autonomy/audit/:cycleId", (req, res) => {
  const entries = getCycleAudit(req.params.cycleId);
  res.json({ entries, total: entries.length });
});

// ─── Proposals ────────────────────────────────────────────────────────────────

router.get("/autonomy/proposals", (_req, res) => {
  try {
    const proposals = getProposals();
    res.json({ proposals });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Budget ───────────────────────────────────────────────────────────────────

router.get("/autonomy/budget/default", (_req, res) => {
  res.json({ budget: DEFAULT_BUDGET });
});

router.post("/autonomy/budget/validate", (req, res) => {
  const b = req.body as Partial<BudgetConfig>;
  const errors: string[] = [];

  if (b.maxTasks       !== undefined && (b.maxTasks < 1 || b.maxTasks > 20))              errors.push("maxTasks must be 1–20");
  if (b.maxPatchProposals !== undefined && (b.maxPatchProposals < 1 || b.maxPatchProposals > 20)) errors.push("maxPatchProposals must be 1–20");
  if (b.maxAppliedPatches !== undefined && (b.maxAppliedPatches < 0 || b.maxAppliedPatches > 10)) errors.push("maxAppliedPatches must be 0–10");
  if (b.maxRetries      !== undefined && (b.maxRetries < 0 || b.maxRetries > 10))          errors.push("maxRetries must be 0–10");
  if (b.maxFiles        !== undefined && (b.maxFiles < 1 || b.maxFiles > 20))              errors.push("maxFiles must be 1–20");
  if (b.maxLines        !== undefined && (b.maxLines < 10 || b.maxLines > 2000))           errors.push("maxLines must be 10–2000");
  if (b.maxRuntimeMs    !== undefined && (b.maxRuntimeMs < 30_000 || b.maxRuntimeMs > 3_600_000)) errors.push("maxRuntimeMs must be 30 000–3 600 000 (30s–1h)");
  if (b.maxAutoFixAttempts !== undefined && (b.maxAutoFixAttempts < 0 || b.maxAutoFixAttempts > 10)) errors.push("maxAutoFixAttempts must be 0–10");

  if (errors.length > 0) return res.status(400).json({ valid: false, errors });

  const merged = { ...DEFAULT_BUDGET, ...b };
  return res.json({ valid: true, merged });
});

// ─── Policy ───────────────────────────────────────────────────────────────────

router.get("/autonomy/policy/blocked", (_req, res) => {
  res.json({
    patterns:   listBlockedPatterns(),
    exactPaths: listBlockedExactPaths(),
  });
});

router.post("/autonomy/policy/check-files", (req, res) => {
  const { files } = req.body as { files: string[] };
  if (!Array.isArray(files)) return res.status(400).json({ error: "files must be an array" });
  return res.json(validateFiles(files));
});

export { router as autonomyRouter };
