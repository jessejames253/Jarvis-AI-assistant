/**
 * routes/workOrderExecutionPlanning.ts — Work Order Execution Planning API
 *
 * GET  /api/agents/work-orders/execution-plans        — all cached plans (bulk)
 * POST /api/agents/work-orders/:id/plan-execution     — generate plan via Claude
 * GET  /api/agents/work-orders/:id/execution-plan     — get cached plan for one order
 *
 * IMPORTANT: the literal route "/agents/work-orders/execution-plans" is registered
 * BEFORE any ":id" routes so Express matches the literal path first.
 *
 * Read-only planning — no agent code is executed.
 */

import { Router }                                              from "express";
import {
  planExecution, readExecutionPlan, readAllExecutionPlans,
}                                                              from "../lib/workOrderExecutionPlanner";
import { loadWorkOrders }                                      from "../lib/workOrders";
import { createCheckpoint }                                    from "../lib/checkpoints";

const router = Router();

// ─── GET /api/agents/work-orders/execution-plans (bulk) ──────────────────────
// MUST be registered before the /:id routes.

router.get("/agents/work-orders/execution-plans", (_req, res) => {
  try {
    const plans = readAllExecutionPlans();
    res.json({ ok: true, plans, total: Object.keys(plans).length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── POST /api/agents/work-orders/:id/plan-execution ─────────────────────────

router.post("/agents/work-orders/:id/plan-execution", async (req, res) => {
  try {
    const { id } = req.params;

    // Verify the work order exists before checkpointing
    const orders = loadWorkOrders();
    const order  = orders.find(o => o.id === id);
    if (!order) {
      res.status(404).json({ ok: false, error: `Work order '${id}' not found.` });
      return;
    }

    const checkpoint = await createCheckpoint({
      description: `Auto-checkpoint before planning execution for: ${order.agentName} — ${order.objective.slice(0, 60)}`,
    });

    const plan = await planExecution(id);

    res.json({ ok: true, plan, checkpointId: checkpoint.id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── GET /api/agents/work-orders/:id/execution-plan ──────────────────────────

router.get("/agents/work-orders/:id/execution-plan", (req, res) => {
  try {
    const { id } = req.params;
    const plan   = readExecutionPlan(id);
    if (!plan) {
      res.status(404).json({ ok: false, plan: null, error: "No execution plan found for this work order." });
      return;
    }
    res.json({ ok: true, plan });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
