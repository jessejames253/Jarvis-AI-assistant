/**
 * routes/repoReasoner.ts — Repo Reasoning API
 *
 * POST /api/workspace/reason
 *   Body: { goal, changeType, riskTolerance }
 *   Calls Claude with workspace context to produce a ReasoningResult.
 *   Read-only: never modifies project source files.
 */

import { Router }                                 from "express";
import { runReasoning, readLastReasoning,
         type ReasoningRequest, type ChangeType,
         type RiskTolerance }                     from "../lib/repoReasoner";
import { createCheckpoint }                       from "../lib/checkpoints";

const router = Router();

const VALID_CHANGE_TYPES: ChangeType[] = [
  "feature", "bugfix", "refactor", "api", "frontend", "data", "test", "docs",
];
const VALID_RISK_TOLERANCES: RiskTolerance[] = ["low", "medium", "high"];

// ─── POST /api/workspace/reason ───────────────────────────────────────────────

router.post("/workspace/reason", async (req, res) => {
  try {
    const { goal, changeType, riskTolerance } = req.body as Partial<ReasoningRequest>;

    if (!goal || typeof goal !== "string" || goal.trim().length < 3) {
      res.status(400).json({ ok: false, error: "goal is required (min 3 characters)." });
      return;
    }
    if (!changeType || !VALID_CHANGE_TYPES.includes(changeType)) {
      res.status(400).json({ ok: false, error: `changeType must be one of: ${VALID_CHANGE_TYPES.join(", ")}.` });
      return;
    }
    if (!riskTolerance || !VALID_RISK_TOLERANCES.includes(riskTolerance)) {
      res.status(400).json({ ok: false, error: `riskTolerance must be one of: ${VALID_RISK_TOLERANCES.join(", ")}.` });
      return;
    }

    // Auto-checkpoint before saving the reasoning result
    const checkpoint = await createCheckpoint({
      description: `Auto-checkpoint before repo reasoning: ${goal.slice(0, 60)}`,
    });

    const result = await runReasoning({
      goal:          goal.trim(),
      changeType,
      riskTolerance,
    });

    res.json({ ok: true, result, checkpointId: checkpoint.id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── GET /api/workspace/reason/last ──────────────────────────────────────────

router.get("/workspace/reason/last", (req, res) => {
  try {
    const result = readLastReasoning();
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
