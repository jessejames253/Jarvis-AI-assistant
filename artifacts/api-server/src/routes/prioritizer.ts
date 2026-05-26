/**
 * routes/prioritizer.ts — Task Prioritizer API
 *
 * POST /api/tasks/recalculate-priority   Recompute all task scores
 * GET  /api/tasks/recommendations        Top-5 recommended tasks + reasoning
 * GET  /api/tasks/ranked                 All non-done tasks sorted by score
 */

import { Router }                         from "express";
import { recalculateAllPriorities,
         getRecommendations,
         getRankedTasks }                 from "../lib/prioritizer";
import { createCheckpoint }               from "../lib/checkpoints";

const router = Router();

// ─── POST /api/tasks/recalculate-priority ────────────────────────────────────

router.post("/priority/recalculate", async (req, res) => {
  try {
    // Auto-checkpoint before modifying score records
    const checkpoint = await createCheckpoint({
      description: "Auto-checkpoint before priority recalculation",
    });

    const scores = recalculateAllPriorities();
    res.json({
      ok:           true,
      scored:       scores.length,
      checkpointId: checkpoint.id,
      scores,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── GET /api/tasks/recommendations ──────────────────────────────────────────

router.get("/priority/recommendations", (req, res) => {
  try {
    const result = getRecommendations();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── GET /api/tasks/ranked ────────────────────────────────────────────────────

router.get("/priority/ranked", (req, res) => {
  try {
    const ranked = getRankedTasks();
    res.json({ ok: true, ranked });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
