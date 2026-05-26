/**
 * routes/executions.ts — Safe Execution Engine API
 *
 * POST /api/agent-actions/:id/execute
 *   Execute an approved low-risk action safely.
 *   Body: { dryRun?: boolean }
 *   Guards: action must be approved + riskLevel === "low"
 *   Side-effects: auto-creates checkpoint, writes to .jarvas-data/ only
 *
 * GET /api/executions
 *   List all execution records (newest first).
 *   Query: ?actionId=&status=
 *
 * GET /api/executions/:id
 *   Get a single execution record.
 *
 * SAFETY: No shell commands are ever run. All writes go to .jarvas-data/.
 */

import { Router } from "express";
import { listActions }         from "../lib/agentActions";
import { runExecution, ExecutionBlockedError, ExecutionGateError } from "../lib/executionEngine";
import { recalculateAllPriorities }                                from "../lib/prioritizer";
import {
  listExecutions, getExecution,
  createExecution, updateExecution,
  type ExecutionStatus,
} from "../lib/executionRecords";

const router = Router();

// ─── POST /api/agent-actions/:id/execute ─────────────────────────────────────

router.post("/agent-actions/:id/execute", async (req, res) => {
  const actionId = req.params["id"];
  const dryRun   = Boolean(req.body?.dryRun);

  try {
    // Validate action exists
    const actions = listActions();
    const action  = actions.find(a => a.id === actionId);
    if (!action) {
      res.status(404).json({ ok: false, error: `Action "${actionId}" not found.` });
      return;
    }

    // Create execution record (queued → running)
    const record = createExecution({
      actionId:      action.id,
      actionTitle:   action.title,
      operationType: "unsupported", // will be updated after plan
      dryRun,
    });

    updateExecution(record.id, { status: "running", startedAt: new Date().toISOString() });

    // Run the engine
    const result = await runExecution(
      {
        id:          action.id,
        title:       action.title,
        description: action.description,
        riskLevel:   action.riskLevel,
        status:      action.status,
      },
      dryRun,
    );

    // Mark completed
    const completed = updateExecution(record.id, {
      operationType:  result.operationType,
      status:         "completed",
      completedAt:    new Date().toISOString(),
      checkpointId:   result.checkpointId,
      affectedFiles:  result.affectedFiles,
      report:         result.report,
    });

    res.status(dryRun ? 200 : 201).json({ ok: true, execution: completed });
    if (!dryRun) setImmediate(() => { try { recalculateAllPriorities(); } catch { /* ignore */ } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status  =
      err instanceof ExecutionGateError    ? 409 :
      err instanceof ExecutionBlockedError ? 403 : 500;

    // Try to mark the record as failed (best-effort)
    try {
      const records = listExecutions({ actionId });
      const running = records.find(r => r.status === "running" || r.status === "queued");
      if (running) {
        updateExecution(running.id, {
          status:      "failed",
          completedAt: new Date().toISOString(),
          error:       message,
          report:      `Execution failed: ${message}`,
        });
      }
    } catch { /* ignore */ }

    res.status(status).json({ ok: false, error: message });
  }
});

// ─── GET /api/executions ─────────────────────────────────────────────────────

router.get("/executions", (req, res) => {
  try {
    const actionId = typeof req.query["actionId"] === "string" ? req.query["actionId"] : undefined;
    const status   = typeof req.query["status"]   === "string" ? req.query["status"] as ExecutionStatus : undefined;
    const records  = listExecutions({ actionId, status });
    res.json({ ok: true, executions: records });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ ok: false, error: message });
  }
});

// ─── GET /api/executions/:id ──────────────────────────────────────────────────

router.get("/executions/:id", (req, res) => {
  try {
    const record = getExecution(req.params["id"]);
    if (!record) {
      res.status(404).json({ ok: false, error: `Execution "${req.params["id"]}" not found.` });
      return;
    }
    res.json({ ok: true, execution: record });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ ok: false, error: message });
  }
});

export default router;
