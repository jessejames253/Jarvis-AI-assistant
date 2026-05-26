/**
 * routes/autoLoop.ts — Autonomous Dev Loop API
 *
 * GET  /api/auto-loop/state        Current state + computed queue
 * POST /api/auto-loop/enable       Turn AUTO MODE on
 * POST /api/auto-loop/disable      Turn AUTO MODE off
 * POST /api/auto-loop/tick         Trigger one processing cycle (called by frontend)
 * GET  /api/auto-loop/activity     Recent activity events (last 50)
 * POST /api/auto-loop/reset-lockout  Clear safety lockout
 */

import { Router } from "express";
import {
  getState, enable, disable, resetLockout, tick,
  listActivity, computeQueue,
} from "../lib/autoLoop";
import { listExecutions } from "../lib/executionRecords";

const router = Router();

// ─── GET /api/auto-loop/state ─────────────────────────────────────────────────

router.get("/auto-loop/state", (req, res) => {
  try {
    const state  = getState();
    const queue  = computeQueue();

    // Execution stats for the dashboard
    const allExecs = listExecutions();
    const autoExecs = state.executionIds.length > 0
      ? allExecs.filter(e => state.executionIds.includes(e.id))
      : allExecs; // if no tracked IDs yet, show all (graceful fallback)

    const stats = {
      queued:            queue.length,
      running:           autoExecs.filter(e => e.status === "running").length,
      completed:         autoExecs.filter(e => e.status === "completed").length,
      failed:            autoExecs.filter(e => e.status === "failed").length,
      rollbackAvailable: autoExecs.filter(e => e.status === "completed" && e.checkpointId).length,
    };

    res.json({ ok: true, state, queue, stats });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── POST /api/auto-loop/enable ───────────────────────────────────────────────

router.post("/auto-loop/enable", (req, res) => {
  try {
    const state = enable();
    res.json({ ok: true, state });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status  = message.includes("locked") ? 409 : 500;
    res.status(status).json({ ok: false, error: message });
  }
});

// ─── POST /api/auto-loop/disable ──────────────────────────────────────────────

router.post("/auto-loop/disable", (req, res) => {
  try {
    const state = disable();
    res.json({ ok: true, state });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── POST /api/auto-loop/tick ─────────────────────────────────────────────────

router.post("/auto-loop/tick", async (req, res) => {
  try {
    const result = await tick();
    const state  = getState();
    res.json({ ok: true, ...result, state });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── GET /api/auto-loop/activity ─────────────────────────────────────────────

router.get("/auto-loop/activity", (req, res) => {
  try {
    const limit    = Math.min(Number(req.query["limit"] ?? 50), 100);
    const activity = listActivity(limit);
    res.json({ ok: true, activity });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── POST /api/auto-loop/reset-lockout ───────────────────────────────────────

router.post("/auto-loop/reset-lockout", (req, res) => {
  try {
    const state = resetLockout();
    res.json({ ok: true, state });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
