/**
 * routes/workOrders.ts — Work Orders API
 *
 * GET   /api/agents/work-orders
 *   Returns all stored work orders.
 *
 * POST  /api/agents/work-orders/from-collaboration/:id
 *   Converts a collaboration plan to work orders.
 *   :id = "last" uses the most recent collaboration plan.
 *   Replaces any existing orders from the same plan.
 *
 * PATCH /api/agents/work-orders/:id/status
 *   Updates a work order's status; cascades to unblock dependents.
 *
 * Auto-checkpoint on POST and PATCH.
 */

import { Router }                                              from "express";
import {
  loadWorkOrders, createFromCollaboration, updateWorkOrderStatus,
  getPlanForId,
  type WorkOrderStatus,
}                                                              from "../lib/workOrders";
import { createCheckpoint }                                    from "../lib/checkpoints";

const router = Router();

const VALID_STATUSES: WorkOrderStatus[] = ["pending", "ready", "blocked", "completed"];

// ─── GET /api/agents/work-orders ─────────────────────────────────────────────

router.get("/agents/work-orders", (_req, res) => {
  try {
    const orders = loadWorkOrders();
    res.json({ ok: true, orders, total: orders.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── POST /api/agents/work-orders/from-collaboration/:id ─────────────────────

router.post("/agents/work-orders/from-collaboration/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const plan   = getPlanForId(id);

    if (!plan) {
      res.status(404).json({
        ok:    false,
        error: id === "last"
          ? "No collaboration plan found. Create one first via POST /api/agents/collaborate."
          : `Collaboration plan '${id}' not found.`,
      });
      return;
    }

    const checkpoint = await createCheckpoint({
      description: `Auto-checkpoint before creating work orders from plan: ${plan.goal.slice(0, 60)}`,
    });

    const orders = createFromCollaboration(plan);

    res.json({
      ok:           true,
      orders,
      total:        orders.length,
      planGoal:     plan.goal,
      planId:       plan.plannedAt,
      checkpointId: checkpoint.id,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── PATCH /api/agents/work-orders/:id/status ────────────────────────────────

router.patch("/agents/work-orders/:id/status", async (req, res) => {
  try {
    const { id }     = req.params;
    const { status } = req.body as { status?: string };

    if (!status || !VALID_STATUSES.includes(status as WorkOrderStatus)) {
      res.status(400).json({
        ok:    false,
        error: `status must be one of: ${VALID_STATUSES.join(", ")}.`,
      });
      return;
    }

    const checkpoint = await createCheckpoint({
      description: `Auto-checkpoint before updating work order ${id.slice(0, 8)} → ${status}`,
    });

    const updated = updateWorkOrderStatus(id, status as WorkOrderStatus);
    if (!updated) {
      res.status(404).json({ ok: false, error: `Work order '${id}' not found.` });
      return;
    }

    // Return all orders (client needs to refresh the full list for cascade effects)
    const allOrders = loadWorkOrders();

    res.json({
      ok:           true,
      order:        updated,
      orders:       allOrders,
      checkpointId: checkpoint.id,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
