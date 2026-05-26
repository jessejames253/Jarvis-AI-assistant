/**
 * routes/masterTasks.ts — REST API for the Jarvis master task list
 *
 * All routes operate on the shared .jarvas-data/tasks/master-task-list.json file.
 * Tasks are NEVER deleted through this API.
 *
 * GET    /api/master-tasks            — list all tasks (optional ?status= / ?priority=)
 * POST   /api/master-tasks            — add a new task
 * PATCH  /api/master-tasks/:id/status — update a task's status only
 */

import { Router } from "express";
import {
  listTasks, addTask, updateTaskStatus,
  type TaskPriority, type TaskStatus,
} from "../lib/masterTasks";

const router = Router();

// ── GET /api/master-tasks ─────────────────────────────────────────────────────

router.get("/master-tasks", (_req, res) => {
  try {
    const { status, priority } = _req.query as {
      status?:   string;
      priority?: string;
    };

    const tasks = listTasks({
      status:   status   as TaskStatus   | undefined,
      priority: priority as TaskPriority | undefined,
    });

    res.json({ ok: true, tasks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ ok: false, error: message });
  }
});

// ── POST /api/master-tasks ────────────────────────────────────────────────────

router.post("/master-tasks", (req, res) => {
  try {
    const { id, title, priority, status } = req.body as {
      id?:        string;
      title?:     string;
      priority?:  TaskPriority;
      status?:    TaskStatus;
    };

    if (!id || typeof id !== "string" || !id.trim()) {
      res.status(400).json({ ok: false, error: "id is required and must be a non-empty string." });
      return;
    }
    if (!title || typeof title !== "string" || !title.trim()) {
      res.status(400).json({ ok: false, error: "title is required and must be a non-empty string." });
      return;
    }

    const VALID_PRIORITIES = ["high", "medium", "low"] as const;
    const VALID_STATUSES   = ["pending", "in-progress", "done", "cancelled"] as const;

    if (priority && !VALID_PRIORITIES.includes(priority)) {
      res.status(400).json({ ok: false, error: `priority must be one of: ${VALID_PRIORITIES.join(", ")}.` });
      return;
    }
    if (status && !VALID_STATUSES.includes(status)) {
      res.status(400).json({ ok: false, error: `status must be one of: ${VALID_STATUSES.join(", ")}.` });
      return;
    }

    const tasks = addTask({ id: id.trim(), title: title.trim(), priority, status });
    res.status(201).json({ ok: true, tasks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const isConflict = message.includes("already exists");
    res.status(isConflict ? 409 : 500).json({ ok: false, error: message });
  }
});

// ── PATCH /api/master-tasks/:id/status ────────────────────────────────────────

router.patch("/master-tasks/:id/status", (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body as { status?: TaskStatus };

    const VALID_STATUSES = ["pending", "in-progress", "done", "cancelled"] as const;

    if (!status || !VALID_STATUSES.includes(status)) {
      res.status(400).json({
        ok: false,
        error: `status is required and must be one of: ${VALID_STATUSES.join(", ")}.`,
      });
      return;
    }

    const tasks = updateTaskStatus(id, status);
    res.json({ ok: true, tasks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const isNotFound = message.includes("not found");
    res.status(isNotFound ? 404 : 500).json({ ok: false, error: message });
  }
});

export default router;
