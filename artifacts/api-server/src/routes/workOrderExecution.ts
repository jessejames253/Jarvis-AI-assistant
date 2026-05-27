/**
 * routes/workOrderExecution.ts — Work Order Execution Engine v1 API
 *
 * GET  /api/agents/work-orders/executions       — all execution results (bulk)
 * POST /api/agents/work-orders/:id/execute      — execute an approved work order
 *
 * IMPORTANT: the literal "/agents/work-orders/executions" is registered FIRST
 * so Express matches it before the "/:id/execute" parameterized route.
 *
 * Gate requirements (enforced before Claude is called):
 *   - Work order status must be "ready"
 *   - Execution plan must exist
 *   - Plan recommendation must be "proceed"
 */

import { Router }                                    from "express";
import {
  checkExecutionGates, executeWorkOrder, loadExecutions,
}                                                    from "../lib/workOrderExecutionEngine";
import { createCheckpoint }                          from "../lib/checkpoints";

const router = Router();

// ─── GET /api/agents/work-orders/executions (bulk) ───────────────────────────
// MUST be registered before /:id routes.

router.get("/agents/work-orders/executions", (_req, res) => {
  try {
    const executions = loadExecutions();
    res.json({ ok: true, executions, total: executions.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── POST /api/agents/work-orders/:id/execute ────────────────────────────────

router.post("/agents/work-orders/:id/execute", async (req, res) => {
  try {
    const { id } = req.params;

    // Run all gate checks before checkpointing
    const gates = checkExecutionGates(id);
    if (!gates.ok) {
      res.status(422).json({ ok: false, errors: gates.errors, error: gates.errors[0] });
      return;
    }

    // Auto-checkpoint before any execution
    const checkpoint = await createCheckpoint({
      description: `Auto-checkpoint before executing work order ${id.slice(0, 8)}`,
    });

    const result = await executeWorkOrder(id, checkpoint.id);

    res.json({ ok: true, result, checkpointId: checkpoint.id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
