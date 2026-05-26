/**
 * routes/agents.ts — Phase 4 / 4B Multi-Agent API routes.
 *
 * Phase 4 routes:
 *   GET  /agents                       — list all registered agents
 *   GET  /agents/tasks                 — list the full task graph
 *   GET  /agents/tasks/ready           — tasks ready to run (deps satisfied)
 *   GET  /agents/context               — shared context bus snapshot
 *   POST /agents/orchestrate           — create orchestration from a goal
 *   GET  /agents/orchestrations/:id    — orchestration status
 *   POST /agents/tasks/:id/run         — run a single task (user-triggered only)
 *   PATCH /agents/tasks/:id            — update task metadata (cancel, reprioritise)
 *   DELETE /agents/tasks               — clear task graph
 *   GET  /agents/permissions/audit     — permission audit log
 *
 * Phase 4B routes (supervised plan execution):
 *   POST /agents/plan/:orchestrationId/run     — run the full plan (supervised)
 *   POST /agents/plan/:orchestrationId/step    — advance one task
 *   POST /agents/plan/:orchestrationId/pause   — pause the running plan
 *   POST /agents/plan/:orchestrationId/resume  — resume a paused plan
 *   GET  /agents/plan/:orchestrationId/summary — execution summary + timeline
 *   GET  /agents/plan/:orchestrationId/timeline — timeline only
 *   GET  /agents/messages                      — agent-to-agent messages
 */

import { Router }                 from "express";
import { listAgents }             from "../lib/agents/registry";
import {
  getTaskGraph, getReadyTasks, updateTask, clearTasks, getTask,
}                                 from "../lib/agents/taskGraph";
import { getSharedContext }       from "../lib/agents/contextBus";
import {
  orchestrate, runTask, getOrchestrationStatus,
  runPlan, stepNext, pausePlan, resumePlan,
  type PlanRunResult,
}                                 from "../lib/agents/orchestrator";
import {
  getPermissionAuditLog, getPermissionDenials,
}                                 from "../lib/agents/permissions";
import { getTimeline }            from "../lib/agents/executionState";
import { getMessages }            from "../lib/agents/agentMessages";
import { getRetryLog }            from "../lib/agents/retryPolicy";

const router = Router();

// ─── Phase 4: Agent & task management ────────────────────────────────────────

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

router.get("/agents/tasks", (req, res) => {
  const { orchestrationId } = req.query as { orchestrationId?: string };
  const tasks = orchestrationId
    ? getTaskGraph().filter(t => t.orchestrationId === orchestrationId)
    : getTaskGraph();
  res.json({ ok: true, tasks, total: tasks.length });
});

router.get("/agents/tasks/ready", (_req, res) => {
  const ready = getReadyTasks();
  res.json({ ok: true, tasks: ready, total: ready.length });
});

router.get("/agents/context", async (_req, res): Promise<void> => {
  try {
    const ctx = await getSharedContext();
    res.json({ ok: true, context: ctx });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

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

router.get("/agents/orchestrations/:id", (req, res) => {
  const status = getOrchestrationStatus(req.params.id);
  res.json({ ok: true, ...status });
});

// SAFETY: the only entry point for single-task execution
router.post("/agents/tasks/:id/run", async (req, res): Promise<void> => {
  try {
    const result = await runTask(req.params.id);
    res.json({ ok: result.success, result });
  } catch (err) {
    const msg = String(err);
    const status = msg.includes("PermissionDenied") ? 403
                 : msg.includes("not found")         ? 404
                 : 400;
    res.status(status).json({ ok: false, error: msg });
  }
});

router.patch("/agents/tasks/:id", (req, res) => {
  const task = getTask(req.params.id);
  if (!task) { res.status(404).json({ ok: false, error: "Task not found" }); return; }

  const { status, priority, riskScore } = req.body as {
    status?: string; priority?: string; riskScore?: number;
  };
  const patch: Record<string, unknown> = {};
  if (status === "cancelled" && task.status === "pending") patch.status = "cancelled";
  if (priority)                patch.priority  = priority;
  if (riskScore !== undefined) patch.riskScore = riskScore;

  res.json({ ok: true, task: updateTask(req.params.id, patch) });
});

router.delete("/agents/tasks", (req, res) => {
  const { orchestrationId } = req.query as { orchestrationId?: string };
  const removed = clearTasks(orchestrationId);
  res.json({ ok: true, removed });
});

router.get("/agents/permissions/audit", (req, res) => {
  const limit  = Math.min(parseInt((req.query.limit as string) ?? "50", 10), 200);
  const denied = req.query.denied === "true";
  const log    = denied ? getPermissionDenials(limit) : getPermissionAuditLog(limit);
  res.json({ ok: true, entries: log, total: log.length });
});

// ─── Phase 4B: supervised plan execution ─────────────────────────────────────

router.post("/agents/plan/:id/run", async (req, res): Promise<void> => {
  try {
    const summary: PlanRunResult = await runPlan(req.params.id);
    res.json({ ok: true, ...summary });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err) });
  }
});

router.post("/agents/plan/:id/step", async (req, res): Promise<void> => {
  try {
    const summary: PlanRunResult = await stepNext(req.params.id);
    res.json({ ok: true, ...summary });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err) });
  }
});

router.post("/agents/plan/:id/pause", (req, res) => {
  try {
    pausePlan(req.params.id);
    res.json({ ok: true, message: "Plan paused" });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err) });
  }
});

router.post("/agents/plan/:id/resume", (req, res) => {
  try {
    resumePlan(req.params.id);
    res.json({ ok: true, message: "Plan resumed" });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err) });
  }
});

router.get("/agents/plan/:id/summary", (req, res) => {
  const { id } = req.params;
  const status = getOrchestrationStatus(id);
  const timeline = getTimeline(id);
  res.json({ ok: true, orchestrationId: id, ...status, timeline });
});

router.get("/agents/plan/:id/timeline", (req, res) => {
  const timeline = getTimeline(req.params.id);
  res.json({ ok: true, timeline, total: timeline.length });
});

// ─── Phase 4B: agent messages + retry log ────────────────────────────────────

router.get("/agents/messages", (req, res) => {
  const { orchestrationId, limit } = req.query as {
    orchestrationId?: string; limit?: string;
  };
  const msgs = getMessages(orchestrationId, parseInt(limit ?? "50", 10));
  res.json({ ok: true, messages: msgs, total: msgs.length });
});

router.get("/agents/retries", (req, res) => {
  const { taskId } = req.query as { taskId?: string };
  const log = getRetryLog(taskId);
  res.json({ ok: true, entries: log, total: log.length });
});

export default router;
