/**
 * routes/tasks.ts — REST API for task management
 *
 * All routes require a sessionId to scope data to the current user.
 *
 * GET    /api/tasks/:sessionId          — list all tasks
 * POST   /api/tasks                     — create task
 * PATCH  /api/tasks/:taskId             — update task (status, priority, title…)
 * DELETE /api/tasks/:taskId             — delete task
 *
 * GET    /api/projects/:sessionId       — list all projects
 * POST   /api/projects                  — create project
 * PATCH  /api/projects/:projectId       — update project
 * DELETE /api/projects/:projectId       — delete project
 *
 * GET    /api/goals/:sessionId          — daily goals (today by default)
 * POST   /api/goals                     — create goal
 * PATCH  /api/goals/:goalId             — toggle goal done
 * DELETE /api/goals/:goalId             — delete goal
 *
 * GET    /api/tasks/stats/:sessionId    — productivity stats
 */

import { Router } from "express";
import {
  getTasks, createTask, updateTask, deleteTask,
  getProjects, createProject, updateProject, deleteProject,
  getGoals, createGoal, updateGoal, deleteGoal,
  getStats,
} from "../lib/tasks/manager";

const router = Router();

// ─── Tasks ────────────────────────────────────────────────────────────────────

router.get("/tasks/stats/:sessionId", async (req, res) => {
  try {
    const stats = await getStats(req.params.sessionId);
    res.json(stats);
  } catch (err) {
    console.error("[tasks] stats error:", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

router.get("/tasks/:sessionId", async (req, res) => {
  try {
    const tasks = await getTasks(req.params.sessionId);
    res.json(tasks);
  } catch (err) {
    console.error("[tasks] list error:", err);
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
});

router.post("/tasks", async (req, res) => {
  try {
    const { sessionId, title, ...rest } = req.body as Record<string, string>;
    if (!sessionId || !title) {
      return res.status(400).json({ error: "sessionId and title are required" });
    }
    const task = await createTask({ sessionId, title, ...rest } as Parameters<typeof createTask>[0]);
    res.status(201).json(task);
  } catch (err) {
    console.error("[tasks] create error:", err);
    res.status(500).json({ error: "Failed to create task" });
  }
});

router.patch("/tasks/:taskId", async (req, res) => {
  try {
    const { sessionId, ...updates } = req.body as Record<string, string>;
    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
    const task = await updateTask(sessionId, req.params.taskId, updates as Parameters<typeof updateTask>[2]);
    if (!task) return res.status(404).json({ error: "Task not found" });
    res.json(task);
  } catch (err) {
    console.error("[tasks] update error:", err);
    res.status(500).json({ error: "Failed to update task" });
  }
});

router.delete("/tasks/:taskId", async (req, res) => {
  try {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) return res.status(400).json({ error: "sessionId query param required" });
    const ok = await deleteTask(sessionId, req.params.taskId);
    if (!ok) return res.status(404).json({ error: "Task not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("[tasks] delete error:", err);
    res.status(500).json({ error: "Failed to delete task" });
  }
});

// ─── Projects ─────────────────────────────────────────────────────────────────

router.get("/projects/:sessionId", async (req, res) => {
  try {
    const projects = await getProjects(req.params.sessionId);
    res.json(projects);
  } catch (err) {
    console.error("[projects] list error:", err);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

router.post("/projects", async (req, res) => {
  try {
    const { sessionId, name, ...rest } = req.body as Record<string, string>;
    if (!sessionId || !name) {
      return res.status(400).json({ error: "sessionId and name are required" });
    }
    const project = await createProject({ sessionId, name, ...rest } as Parameters<typeof createProject>[0]);
    res.status(201).json(project);
  } catch (err) {
    console.error("[projects] create error:", err);
    res.status(500).json({ error: "Failed to create project" });
  }
});

router.patch("/projects/:projectId", async (req, res) => {
  try {
    const { sessionId, ...updates } = req.body as Record<string, string>;
    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
    const project = await updateProject(sessionId, req.params.projectId, updates);
    if (!project) return res.status(404).json({ error: "Project not found" });
    res.json(project);
  } catch (err) {
    console.error("[projects] update error:", err);
    res.status(500).json({ error: "Failed to update project" });
  }
});

router.delete("/projects/:projectId", async (req, res) => {
  try {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) return res.status(400).json({ error: "sessionId query param required" });
    const ok = await deleteProject(sessionId, req.params.projectId);
    if (!ok) return res.status(404).json({ error: "Project not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("[projects] delete error:", err);
    res.status(500).json({ error: "Failed to delete project" });
  }
});

// ─── Daily Goals ──────────────────────────────────────────────────────────────

router.get("/goals/:sessionId", async (req, res) => {
  try {
    const date = req.query.date as string | undefined;
    const goals = await getGoals(req.params.sessionId, date);
    res.json(goals);
  } catch (err) {
    console.error("[goals] list error:", err);
    res.status(500).json({ error: "Failed to fetch goals" });
  }
});

router.post("/goals", async (req, res) => {
  try {
    const { sessionId, title, date } = req.body as Record<string, string>;
    if (!sessionId || !title || !date) {
      return res.status(400).json({ error: "sessionId, title, and date are required" });
    }
    const goal = await createGoal({ sessionId, title, date });
    res.status(201).json(goal);
  } catch (err) {
    console.error("[goals] create error:", err);
    res.status(500).json({ error: "Failed to create goal" });
  }
});

router.patch("/goals/:goalId", async (req, res) => {
  try {
    const { sessionId, done } = req.body as { sessionId: string; done: boolean };
    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
    const goal = await updateGoal(sessionId, req.params.goalId, done);
    if (!goal) return res.status(404).json({ error: "Goal not found" });
    res.json(goal);
  } catch (err) {
    console.error("[goals] update error:", err);
    res.status(500).json({ error: "Failed to update goal" });
  }
});

router.delete("/goals/:goalId", async (req, res) => {
  try {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) return res.status(400).json({ error: "sessionId query param required" });
    const ok = await deleteGoal(sessionId, req.params.goalId);
    if (!ok) return res.status(404).json({ error: "Goal not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("[goals] delete error:", err);
    res.status(500).json({ error: "Failed to delete goal" });
  }
});

export default router;
