/**
 * routes/agentProfiles.ts — Multi-Agent System v1 API
 *
 * GET  /api/agents/profiles          — list all specialist agent profiles
 * GET  /api/agents/profiles/:id      — get single profile by id
 * POST /api/agents/assign            — assign best agent to a goal
 * GET  /api/agents/assign/last       — return cached last assignment
 *
 * Read-only assignment: no code is executed or files modified.
 */

import { Router }                                 from "express";
import {
  loadProfiles,
  assignAgent,
  readLastAssignment,
  type ChangeType,
  type AssignmentRequest,
}                                                 from "../lib/agentProfiles";
import { createCheckpoint }                       from "../lib/checkpoints";

const router = Router();

const VALID_CHANGE_TYPES: ChangeType[] = [
  "feature", "bugfix", "refactor", "api", "frontend", "data", "test", "docs",
];

// ─── GET /api/agents/profiles ─────────────────────────────────────────────────

router.get("/agents/profiles", (_req, res) => {
  try {
    const profiles = loadProfiles();
    res.json({ ok: true, profiles, total: profiles.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── GET /api/agents/profiles/:id ────────────────────────────────────────────

router.get("/agents/profiles/:id", (req, res) => {
  try {
    const profiles = loadProfiles();
    const profile  = profiles.find(p => p.id === req.params.id);
    if (!profile) {
      res.status(404).json({ ok: false, error: `Agent profile '${req.params.id}' not found.` });
      return;
    }
    res.json({ ok: true, profile });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── POST /api/agents/assign ─────────────────────────────────────────────────

router.post("/agents/assign", async (req, res) => {
  try {
    const { goal, changeType, context } = req.body as Partial<AssignmentRequest>;

    if (!goal || typeof goal !== "string" || goal.trim().length < 3) {
      res.status(400).json({ ok: false, error: "goal is required (min 3 characters)." });
      return;
    }
    if (!changeType || !VALID_CHANGE_TYPES.includes(changeType)) {
      res.status(400).json({
        ok: false,
        error: `changeType must be one of: ${VALID_CHANGE_TYPES.join(", ")}.`,
      });
      return;
    }

    // Auto-checkpoint before writing the assignment cache
    const checkpoint = await createCheckpoint({
      description: `Auto-checkpoint before agent assignment: ${goal.slice(0, 60)}`,
    });

    const result = assignAgent({
      goal:       goal.trim(),
      changeType,
      context:    typeof context === "string" ? context.trim() : undefined,
    });

    res.json({ ok: true, result, checkpointId: checkpoint.id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── GET /api/agents/assign/last ─────────────────────────────────────────────

router.get("/agents/assign/last", (_req, res) => {
  try {
    const result = readLastAssignment();
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
