/**
 * routes/plan.ts — Multi-step autonomous planner endpoint
 *
 * POST /api/plan/stream
 *
 * Body: { goal: string, sessionId?: string }
 *
 * SSE events emitted (text/event-stream):
 *   plan_created        — { type, id, title, goal, steps, createdAt }
 *   plan_step_start     — { type, planId, stepId, stepIndex, title }
 *   token               — { type, text }  (step's Claude response)
 *   tool_start          — { type, toolCallId, tool, label }
 *   tool_done           — { type, toolCallId, tool, durationMs, result }
 *   tool_error          — { type, toolCallId, tool, durationMs, error }
 *   plan_step_complete  — { type, planId, stepId, stepIndex, durationMs, summary }
 *   plan_step_failed    — { type, planId, stepId, stepIndex, error, willRetry }
 *   plan_step_retry     — { type, planId, stepId, stepIndex, attempt }
 *   plan_cancelled      — { type, planId }
 *   plan_done           — { type, planId, durationMs, summary, stepsCompleted, stepsFailed }
 *   done                — { type }
 *   error               — { type, message }
 *
 * DELETE /api/plan/:planId — (no-op acknowledgement; cancel via closing SSE connection)
 */

import { Router } from "express";
import { createPlan } from "../lib/planner/creator";
import { executePlan } from "../lib/planner/executor";
import { logger } from "../lib/logger";

const router = Router();

router.post("/plan/stream", async (req, res) => {
  const { goal, sessionId } = req.body as { goal?: string; sessionId?: string };

  if (!goal || typeof goal !== "string" || goal.trim().length === 0) {
    res.status(400).json({ error: "goal is required" });
    return;
  }

  // ── SSE setup ──────────────────────────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (data: object) => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch { /* client disconnected */ }
  };

  // Use res.on("close") — NOT req.on("close").
  // req "close" fires when the request BODY stream is consumed by body-parser,
  // which happens immediately after JSON parsing and before any step runs.
  // res "close" fires only when the actual HTTP connection is torn down.
  let cancelled = false;
  res.on("close", () => {
    logger.debug("SSE connection closed by client");
    cancelled = true;
  });

  const sid = sessionId ?? "";
  const goalTrimmed = goal.trim();

  try {
    // 1. Create plan via Claude
    const plan = await createPlan(goalTrimmed, sid);
    send({ type: "plan_created", ...plan });

    // 2. Execute each step
    const result = await executePlan(plan, { sessionId: sid }, send, () => cancelled);

    // 3. Finalize
    if (!cancelled) {
      send({
        type: "plan_done",
        planId: plan.id,
        durationMs: result.durationMs,
        summary: result.summary,
        stepsCompleted: result.stepsCompleted,
        stepsFailed: result.stepsFailed,
      });
    }
    send({ type: "done" });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Plan execution failed";
    logger.error({ err }, "Plan execution error");
    send({ type: "error", message });
  }

  res.end();
});

export default router;
