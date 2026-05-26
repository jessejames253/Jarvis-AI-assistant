/**
 * routes/workspace.ts — Workspace Intelligence API
 *
 * GET  /api/workspace/map   Return current workspace map (auto-scan on first access)
 * POST /api/workspace/scan  Trigger a fresh scan with auto-checkpoint
 */

import { Router }                        from "express";
import { scanWorkspace, readWorkspaceMap } from "../lib/workspace";
import { createCheckpoint }              from "../lib/checkpoints";

const router = Router();

// ─── GET /api/workspace/map ───────────────────────────────────────────────────

router.get("/workspace/map", (req, res) => {
  try {
    let map = readWorkspaceMap();
    if (!map) map = scanWorkspace(); // first-access: scan immediately
    res.json({ ok: true, map });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── POST /api/workspace/scan ─────────────────────────────────────────────────

router.post("/workspace/scan", async (req, res) => {
  try {
    const checkpoint = await createCheckpoint({
      description: "Auto-checkpoint before workspace scan",
    });
    const map = scanWorkspace();
    res.json({ ok: true, map, checkpointId: checkpoint.id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
