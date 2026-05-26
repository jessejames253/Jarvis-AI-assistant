/**
 * routes/checkpoints.ts — Checkpoint Rollback & Recovery API
 *
 * GET  /api/checkpoints                    List all checkpoints (newest first)
 * POST /api/checkpoints/create             Create a new checkpoint (captures git state)
 * POST /api/checkpoints/:id/restore-preview  Dry-run restore preview — no files changed
 *
 * SAFETY:
 *   All restore operations in this file are DRY-RUN ONLY.
 *   No `git checkout`, `git reset`, `git restore`, or file writes are performed.
 *   The restore-preview endpoint returns a structured report of what WOULD happen.
 */

import { Router } from "express";
import { listCheckpoints, createCheckpoint, getCheckpoint } from "../lib/checkpoints";
import { runRestorePreview } from "../lib/checkpointPreview";

const router = Router();

// ─── GET /api/checkpoints ────────────────────────────────────────────────────

router.get("/checkpoints", (_req, res) => {
  try {
    const checkpoints = listCheckpoints();
    res.json({ ok: true, checkpoints });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ ok: false, error: message });
  }
});

// ─── POST /api/checkpoints/create ───────────────────────────────────────────

router.post("/checkpoints/create", (req, res) => {
  try {
    const { description, id } = req.body as { description?: string; id?: string };

    if (!description?.trim()) {
      res.status(400).json({ ok: false, error: "Field `description` is required." });
      return;
    }

    const checkpoint = createCheckpoint({ description, id });
    res.status(201).json({ ok: true, checkpoint });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status  = message.includes("already exists") ? 409 : 500;
    res.status(status).json({ ok: false, error: message });
  }
});

// ─── POST /api/checkpoints/:id/restore-preview ──────────────────────────────

router.post("/checkpoints/:id/restore-preview", (req, res) => {
  try {
    const checkpoint = getCheckpoint(req.params["id"]);

    if (!checkpoint) {
      res.status(404).json({ ok: false, error: `Checkpoint "${req.params["id"]}" not found.` });
      return;
    }

    // Pure dry-run analysis — no files are modified
    const preview = runRestorePreview(checkpoint);
    res.json({ ok: true, preview });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status  = message.includes("not found") ? 404 : 500;
    res.status(status).json({ ok: false, error: message });
  }
});

export default router;
