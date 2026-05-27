/**
 * routes/agentCollaboration.ts — Agent Collaboration v1 API
 *
 * POST /api/agents/collaborate      — plan a multi-agent collaboration
 * GET  /api/agents/collaborate/last — return cached last plan
 *
 * Read-only planning: no agent work is executed.
 */

import { Router }                                                from "express";
import { planCollaboration, readLastCollaboration }             from "../lib/agentCollaboration";
import { createCheckpoint }                                      from "../lib/checkpoints";

const router = Router();

// ─── POST /api/agents/collaborate ────────────────────────────────────────────

router.post("/agents/collaborate", async (req, res) => {
  try {
    const { goal } = req.body as { goal?: string };

    if (!goal || typeof goal !== "string" || goal.trim().length < 5) {
      res.status(400).json({ ok: false, error: "goal is required (min 5 characters)." });
      return;
    }

    // Auto-checkpoint before writing the collaboration plan
    const checkpoint = await createCheckpoint({
      description: `Auto-checkpoint before collaboration plan: ${goal.slice(0, 60)}`,
    });

    const plan = await planCollaboration(goal.trim());

    res.json({ ok: true, plan, checkpointId: checkpoint.id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── GET /api/agents/collaborate/last ────────────────────────────────────────

router.get("/agents/collaborate/last", (_req, res) => {
  try {
    const plan = readLastCollaboration();
    res.json({ ok: true, plan });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
