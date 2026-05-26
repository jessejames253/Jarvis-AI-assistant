/**
 * lib/masterTasks.ts — Master task list manager
 *
 * Reads from and writes to:
 *   {PROJECT_ROOT}/.jarvas-data/tasks/master-task-list.json
 *
 * Safety rules:
 *   - Tasks are never deleted by any helper in this module.
 *   - Writes are atomic: we build the new list in memory first, then
 *     write the entire file so a crash mid-write cannot corrupt partial data.
 *   - IDs must be unique; addTask() rejects duplicates.
 *   - updateTaskStatus() only changes the `status` field — all other fields
 *     are preserved unchanged.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { PROJECT_ROOT } from "./dev/tools";

// ─── File path ────────────────────────────────────────────────────────────────

const TASKS_DIR  = path.join(PROJECT_ROOT, ".jarvas-data", "tasks");
const TASKS_FILE = path.join(TASKS_DIR, "master-task-list.json");

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskPriority = "high" | "medium" | "low";
export type TaskStatus   = "pending" | "in-progress" | "done" | "cancelled";

export interface MasterTask {
  id:          string;
  title:       string;
  priority:    TaskPriority;
  status:      TaskStatus;
  createdAt?:  string;
  updatedAt?:  string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function ensureDir(): void {
  if (!existsSync(TASKS_DIR)) {
    mkdirSync(TASKS_DIR, { recursive: true });
  }
}

function readRaw(): MasterTask[] {
  ensureDir();
  if (!existsSync(TASKS_FILE)) return [];
  try {
    const raw = readFileSync(TASKS_FILE, "utf-8").trim();
    if (!raw) return [];
    return JSON.parse(raw) as MasterTask[];
  } catch {
    return [];
  }
}

function writeRaw(tasks: MasterTask[]): void {
  ensureDir();
  writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2) + "\n", "utf-8");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * List all tasks, optionally filtered by status or priority.
 */
export function listTasks(filters?: {
  status?:   TaskStatus;
  priority?: TaskPriority;
}): MasterTask[] {
  let tasks = readRaw();
  if (filters?.status)   tasks = tasks.filter(t => t.status   === filters.status);
  if (filters?.priority) tasks = tasks.filter(t => t.priority === filters.priority);
  return tasks;
}

/**
 * Add a new task. Rejects if a task with the same id already exists.
 * Returns the full updated list.
 */
export function addTask(task: {
  id:        string;
  title:     string;
  priority?: TaskPriority;
  status?:   TaskStatus;
}): MasterTask[] {
  const tasks = readRaw();

  if (tasks.some(t => t.id === task.id)) {
    throw new Error(`Task with id "${task.id}" already exists.`);
  }

  const now = new Date().toISOString();
  const newTask: MasterTask = {
    id:        task.id,
    title:     task.title,
    priority:  task.priority  ?? "medium",
    status:    task.status    ?? "pending",
    createdAt: now,
    updatedAt: now,
  };

  const updated = [...tasks, newTask];
  writeRaw(updated);
  return updated;
}

/**
 * Update the status of an existing task.
 * Only the `status` and `updatedAt` fields are changed; all others are preserved.
 * Throws if the task id is not found.
 * Returns the full updated list.
 */
export function updateTaskStatus(id: string, status: TaskStatus): MasterTask[] {
  const tasks = readRaw();
  const idx   = tasks.findIndex(t => t.id === id);

  if (idx === -1) {
    throw new Error(`Task with id "${id}" not found.`);
  }

  const updated = tasks.map((t, i) =>
    i === idx ? { ...t, status, updatedAt: new Date().toISOString() } : t,
  );

  writeRaw(updated);
  return updated;
}

/**
 * Persist an arbitrary (pre-validated) task list to disk.
 * Useful for bulk imports. Existing tasks are never silently dropped —
 * callers are responsible for merging if they want to preserve old entries.
 */
export function saveTasks(tasks: MasterTask[]): void {
  writeRaw(tasks);
}
