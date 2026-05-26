/**
 * routes/plans.ts — Planner Brain v1 API
 *
 * GET  /api/plans                     List all plans (newest first)
 * GET  /api/plans/:id                 Get a single plan by ID
 * POST /api/plans                     Generate a new plan (calls Claude)
 * POST /api/plans/:id/convert-to-tasks  Push plan tasks into master task list
 */

import { Router }                               from "express";
import { listPlans, getPlan, generatePlan,
         updatePlan, convertPlanToTasks }       from "../lib/plans";

const router = Router();

// ─── GET /api/plans ───────────────────────────────────────────────────────────

router.get("/plans", (req, res) => {
  try {
    res.json({ ok: true, plans: listPlans() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── GET /api/plans/:id ───────────────────────────────────────────────────────

router.get("/plans/:id", (req, res) => {
  try {
    const plan = getPlan(req.params["id"]!);
    if (!plan) {
      res.status(404).json({ ok: false, error: "Plan not found" });
      return;
    }
    res.json({ ok: true, plan });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── POST /api/plans ──────────────────────────────────────────────────────────

router.post("/plans", async (req, res) => {
  try {
    const { title, goal } = req.body as { title?: string; goal?: string };

    if (!title?.trim()) {
      res.status(400).json({ ok: false, error: "title is required" });
      return;
    }
    if (!goal?.trim()) {
      res.status(400).json({ ok: false, error: "goal is required" });
      return;
    }

    const plan = await generatePlan(title.trim(), goal.trim());
    res.status(201).json({ ok: true, plan });
  } catch (err) {
    console.error("[plans] generate error:", err);
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── POST /api/plans/:id/convert-to-tasks ────────────────────────────────────

router.post("/plans/:id/convert-to-tasks", (req, res) => {
  try {
    const result = convertPlanToTasks(req.params["id"]!);
    const plan   = getPlan(req.params["id"]!)!;
    res.json({ ok: true, ...result, plan });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status  = message.includes("not found") ? 404 : 500;
    res.status(status).json({ ok: false, error: message });
  }
});

// ─── PATCH /api/plans/:id/status ─────────────────────────────────────────────
// Convenience: update plan status (e.g. approve, archive)

router.patch("/plans/:id/status", (req, res) => {
  try {
    const { status } = req.body as { status?: string };
    const valid = ["draft", "approved", "converting", "converted", "archived"];
    if (!status || !valid.includes(status)) {
      res.status(400).json({ ok: false, error: `status must be one of: ${valid.join(", ")}` });
      return;
    }
    const plan = updatePlan(req.params["id"]!, { status: status as Plan["status"] });
    res.json({ ok: true, plan });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status  = message.includes("not found") ? 404 : 500;
    res.status(status).json({ ok: false, error: message });
  }
});

interface Plan { status: import("../lib/plans").PlanStatus }

export default router;
