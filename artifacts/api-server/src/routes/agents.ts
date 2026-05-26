/**
 * routes/agents.ts — Phase 4 Multi-Agent API routes.
 *
 * GET  /agents              — list all registered agents
 * GET  /agents/tasks        — list the full task graph
 * GET  /agents/tasks/ready  — list tasks ready to run (deps satisfied)
 * GET  /agents/context      — shared context bus snapshot
 * POST /agents/orchestrate  — create a new orchestration from a user goal
 * POST /agents/tasks/:id/run — manually execute a task (user-initiated only)
 * PATCH /agents/tasks/:id   — update task metadata (cancel, reprioritise)
 * DELETE /agents/tasks      — clear the task graph (all or by orchestrationId)
 * GET  /agents/permissions/audit — recent permission audit log
 */

import { Router }           from "express";
import { listAgents }       from "../lib/agents/registry";
import {
  getTaskGraph, getReadyTasks, updateTask, clearTasks, getTask,
}                           from "../lib/agents/taskGraph";
import { getSharedContext } from "../lib/agents/contextBus";
import {
  orchestrate, runTask, getOrchestrationStatus,
}                           from "../lib/agents/orchestrator";
import {
  getPermissionAuditLog, getPermissionDenials,
}                           from "../lib/agents/permissions";

const router = Router();

// ─── GET /agents ──────────────────────────────────────────────────────────────

router.get("/agents", (_req, res) => {
  const agents = listAgents().map(a => ({
    id:            a.id,
    name:          a.name,
    role:          a.role,
    description:   a.description,
    capabilities:  a.capabilities,
    permissions:   a.permissions,
    riskLimit:     a.riskLimit,
    executionMode: a.executionMode,
  }));
  res.json({ ok: true, agents });
});

// ─── GET /agents/tasks ────────────────────────────────────────────────────────

router.get("/agents/tasks", (req, res) => {
  const { orchestrationId } = req.query as { orchestrationId?: string };
  const tasks = orchestrationId
    ? getTaskGraph().filter(t => t.orchestrationId === orchestrationId)
    : getTaskGraph();
  res.json({ ok: true, tasks, total: tasks.length });
});

// ─── GET /agents/tasks/ready ──────────────────────────────────────────────────

router.get("/agents/tasks/ready", (_req, res) => {
  const ready = getReadyTasks();
  res.json({ ok: true, tasks: ready, total: ready.length });
});

// ─── GET /agents/context ──────────────────────────────────────────────────────

router.get("/agents/context", async (_req, res): Promise<void> => {
  try {
    const ctx = await getSharedContext();
    res.json({ ok: true, context: ctx });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ─── POST /agents/orchestrate ─────────────────────────────────────────────────

router.post("/agents/orchestrate", async (req, res): Promise<void> => {
  const { goal } = req.body as { goal?: string };
  if (!goal?.trim()) {
    res.status(400).json({ ok: false, error: "goal is required" });
    return;
  }
  try {
    const result = await orchestrate(goal.trim());
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ─── GET /agents/orchestrations/:id ──────────────────────────────────────────

router.get("/agents/orchestrations/:id", (req, res) => {
  const { id } = req.params;
  const status = getOrchestrationStatus(id);
  res.json({ ok: true, ...status });
});

// ─── POST /agents/tasks/:id/run ───────────────────────────────────────────────
// SAFETY: This is the ONLY way tasks execute. Never called automatically.

router.post("/agents/tasks/:id/run", async (req, res): Promise<void> => {
  const { id } = req.params;
  try {
    const result = await runTask(id);
    res.json({ ok: result.success, result });
  } catch (err) {
    const msg = String(err);
    const status = msg.includes("PermissionDenied") ? 403
                 : msg.includes("not found")         ? 404
                 : 400;
    res.status(status).json({ ok: false, error: msg });
  }
});

// ─── PATCH /agents/tasks/:id ─────────────────────────────────────────────────

router.patch("/agents/tasks/:id", (req, res) => {
  const { id } = req.params;
  const task = getTask(id);
  if (!task) { res.status(404).json({ ok: false, error: "Task not found" }); return; }

  // Only allow safe metadata updates — status changes limited to "cancelled"
  const { status, priority, riskScore } = req.body as {
    status?: string; priority?: string; riskScore?: number;
  };

  const patch: Record<string, unknown> = {};
  if (status === "cancelled" && task.status === "pending") patch.status = "cancelled";
  if (priority) patch.priority = priority;
  if (riskScore !== undefined) patch.riskScore = riskScore;

  const updated = updateTask(id, patch);
  res.json({ ok: true, task: updated });
});

// ─── DELETE /agents/tasks ─────────────────────────────────────────────────────

router.delete("/agents/tasks", (req, res) => {
  const { orchestrationId } = req.query as { orchestrationId?: string };
  const removed = clearTasks(orchestrationId);
  res.json({ ok: true, removed });
});

// ─── GET /agents/permissions/audit ───────────────────────────────────────────

router.get("/agents/permissions/audit", (req, res) => {
  const limit  = Math.min(parseInt((req.query.limit as string) ?? "50", 10), 200);
  const denied = req.query.denied === "true";
  const log    = denied ? getPermissionDenials(limit) : getPermissionAuditLog(limit);
  res.json({ ok: true, entries: log, total: log.length });
});

export default router;
