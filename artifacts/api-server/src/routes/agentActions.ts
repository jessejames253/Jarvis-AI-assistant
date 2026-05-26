/**
 * routes/agentActions.ts — Agent Action Approval API
 *
 * GET    /api/agent-actions              List all actions (optional ?status= filter)
 * POST   /api/agent-actions              Create a new pending action
 * PATCH  /api/agent-actions/:id/approve  Approve a pending action
 * PATCH  /api/agent-actions/:id/reject   Reject a pending action
 *
 * Approved/rejected actions carry no side-effects — status change only.
 */

import { Router } from "express";
import {
  listActions,
  createAction,
  approveAction,
  rejectAction,
  type ActionStatus,
  type RiskLevel,
} from "../lib/agentActions";

const router = Router();

// ─── GET /api/agent-actions ───────────────────────────────────────────────────

router.get("/agent-actions", (_req, res) => {
  try {
    const status = _req.query["status"] as ActionStatus | undefined;
    const valid: ActionStatus[] = ["pending", "approved", "rejected"];
    if (status && !valid.includes(status)) {
      res.status(400).json({ ok: false, error: `Invalid status "${status}". Must be one of: ${valid.join(", ")}.` });
      return;
    }
    const actions = listActions(status ? { status } : undefined);
    res.json({ ok: true, actions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ ok: false, error: message });
  }
});

// ─── POST /api/agent-actions ──────────────────────────────────────────────────

router.post("/agent-actions", (req, res) => {
  try {
    const { title, description, riskLevel, proposedBy, id } = req.body as {
      title?:       string;
      description?: string;
      riskLevel?:   RiskLevel;
      proposedBy?:  string;
      id?:          string;
    };

    if (!title?.trim()) {
      res.status(400).json({ ok: false, error: "Field `title` is required and must be a non-empty string." });
      return;
    }
    if (!description?.trim()) {
      res.status(400).json({ ok: false, error: "Field `description` is required and must be a non-empty string." });
      return;
    }

    const validRisk: RiskLevel[] = ["low", "medium", "high"];
    if (riskLevel && !validRisk.includes(riskLevel)) {
      res.status(400).json({ ok: false, error: `Invalid riskLevel "${riskLevel}". Must be one of: ${validRisk.join(", ")}.` });
      return;
    }

    const action = createAction({ id, title: title.trim(), description: description.trim(), riskLevel, proposedBy });
    res.status(201).json({ ok: true, action });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status  = message.includes("already exists") ? 409 : 500;
    res.status(status).json({ ok: false, error: message });
  }
});

// ─── PATCH /api/agent-actions/:id/approve ────────────────────────────────────

router.patch("/agent-actions/:id/approve", (req, res) => {
  try {
    const action = approveAction(req.params["id"]);
    res.json({ ok: true, action });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status  = message.includes("not found") ? 404 : message.includes("already") ? 409 : 500;
    res.status(status).json({ ok: false, error: message });
  }
});

// ─── PATCH /api/agent-actions/:id/reject ─────────────────────────────────────

router.patch("/agent-actions/:id/reject", (req, res) => {
  try {
    const action = rejectAction(req.params["id"]);
    res.json({ ok: true, action });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status  = message.includes("not found") ? 404 : message.includes("already") ? 409 : 500;
    res.status(status).json({ ok: false, error: message });
  }
});

export default router;
