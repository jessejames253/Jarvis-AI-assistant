/**
 * lib/agents/taskGraph.ts — Phase 4 dependency-aware task graph.
 *
 * Tasks are the atomic unit of work routed to a specific agent.
 * Dependencies form a DAG — a task is "ready" only when all deps are "done".
 * State is persisted to /tmp so it survives server restarts.
 */

import { randomUUID }              from "crypto";
import { readFileSync, writeFileSync } from "fs";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskStatus   = "pending" | "running" | "blocked" | "done" | "failed" | "cancelled";
export type TaskPriority = "critical" | "high" | "medium" | "low";

export interface Task {
  id:              string;
  title:           string;
  description:     string;
  /** ID of the agent responsible for this task. */
  agentId:         string;
  /** IDs of tasks that must be "done" before this one can run. */
  dependencies:    string[];
  status:          TaskStatus;
  priority:        TaskPriority;
  /** 0–100 risk score (higher = riskier). */
  riskScore:       number;
  retryCount:      number;
  maxRetries:      number;
  validationState?: "pending" | "passed" | "failed";
  /** Plain-text result stored after the task completes. */
  result?:         string;
  structuredResult?: Record<string, unknown>;
  error?:          string;
  createdAt:       number;
  startedAt?:      number;
  completedAt?:    number;
  /** Groups all tasks created by a single orchestrate() call. */
  orchestrationId?: string;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

const GRAPH_FILE = "/tmp/jarvis_task_graph.json";
let tasks: Map<string, Task> = new Map();

function load(): void {
  try {
    const raw = JSON.parse(readFileSync(GRAPH_FILE, "utf8")) as Array<[string, Task]>;
    tasks = new Map(raw);
  } catch {
    tasks = new Map();
  }
}

function save(): void {
  try {
    writeFileSync(GRAPH_FILE, JSON.stringify(Array.from(tasks.entries())), "utf8");
  } catch { /* non-fatal */ }
}

load();

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function createTask(params: {
  title:           string;
  description:     string;
  agentId:         string;
  dependencies?:   string[];
  priority?:       TaskPriority;
  riskScore?:      number;
  maxRetries?:     number;
  orchestrationId?: string;
}): Task {
  const task: Task = {
    id:              randomUUID(),
    title:           params.title,
    description:     params.description,
    agentId:         params.agentId,
    dependencies:    params.dependencies ?? [],
    status:          "pending",
    priority:        params.priority ?? "medium",
    riskScore:       params.riskScore ?? 0,
    retryCount:      0,
    maxRetries:      params.maxRetries ?? 2,
    createdAt:       Date.now(),
    orchestrationId: params.orchestrationId,
  };
  tasks.set(task.id, task);
  save();
  return task;
}

export function getTask(id: string): Task | undefined {
  return tasks.get(id);
}

export function updateTask(
  id: string,
  patch: Partial<Omit<Task, "id" | "createdAt">>,
): Task | null {
  const t = tasks.get(id);
  if (!t) return null;
  const updated: Task = { ...t, ...patch };
  tasks.set(id, updated);
  save();
  return updated;
}

export function deleteTask(id: string): boolean {
  const had = tasks.has(id);
  tasks.delete(id);
  save();
  return had;
}

export function listTasks(orchestrationId?: string): Task[] {
  const all = Array.from(tasks.values());
  return orchestrationId
    ? all.filter(t => t.orchestrationId === orchestrationId)
    : all;
}

export function getTaskGraph(): Task[] {
  return Array.from(tasks.values()).sort((a, b) => a.createdAt - b.createdAt);
}

// ─── Dependency helpers ───────────────────────────────────────────────────────

/**
 * Returns tasks whose dependencies are all "done" and whose status is "pending".
 * These are the tasks that can be run right now.
 */
export function getReadyTasks(): Task[] {
  return Array.from(tasks.values()).filter(t => {
    if (t.status !== "pending") return false;
    return t.dependencies.every(depId => tasks.get(depId)?.status === "done");
  });
}

/**
 * Returns tasks that are blocked because at least one dependency has failed.
 */
export function getBlockedTasks(): Task[] {
  return Array.from(tasks.values()).filter(t => {
    if (t.status !== "pending") return false;
    return t.dependencies.some(depId => tasks.get(depId)?.status === "failed");
  });
}

// ─── Bulk ops ─────────────────────────────────────────────────────────────────

export function clearTasks(orchestrationId?: string): number {
  let count = 0;
  if (orchestrationId) {
    for (const [id, t] of tasks.entries()) {
      if (t.orchestrationId === orchestrationId) { tasks.delete(id); count++; }
    }
  } else {
    count = tasks.size;
    tasks.clear();
  }
  save();
  return count;
}
