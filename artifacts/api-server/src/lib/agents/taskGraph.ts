/**
 * lib/agents/taskGraph.ts — Phase 4 / 4B dependency-aware task graph.
 *
 * Phase 4B extends TaskStatus with supervised execution states.
 * State is persisted to /tmp so it survives server restarts.
 */

import { randomUUID }              from "crypto";
import { readFileSync, writeFileSync } from "fs";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskStatus =
  | "pending"           // created, waiting for dependencies
  | "ready"             // all deps satisfied, awaiting execution trigger
  | "running"           // Claude call in progress
  | "waiting_approval"  // high-risk task — paused for human approval
  | "validating"        // TesterAgent is running validation commands
  | "passed"            // completed successfully (alias for "done")
  | "done"              // completed successfully (backward compat alias)
  | "failed"            // ran and failed (may be retried)
  | "skipped"           // bypassed due to upstream failure + user continue
  | "blocked"           // upstream dep failed and no continue was given
  | "rolled_back"       // applied change was rolled back
  | "cancelled";        // explicitly cancelled by user

export type TaskPriority = "critical" | "high" | "medium" | "low";

export interface Task {
  id:              string;
  title:           string;
  description:     string;
  /** ID of the agent responsible for this task. */
  agentId:         string;
  /** IDs of tasks that must be "done"/"passed" before this one can run. */
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

// ─── Terminal statuses (no further transitions expected) ──────────────────────

export const TERMINAL_STATUSES: TaskStatus[] = [
  "passed", "done", "failed", "skipped", "blocked", "rolled_back", "cancelled",
];

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function isSuccess(status: TaskStatus): boolean {
  return status === "done" || status === "passed";
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
  title:            string;
  description:      string;
  agentId:          string;
  dependencies?:    string[];
  priority?:        TaskPriority;
  riskScore?:       number;
  maxRetries?:      number;
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
 * A task is "ready" when all its dependencies are in a success state
 * (done or passed) and its own status is pending or ready.
 */
export function isTaskReady(task: Task): boolean {
  if (task.status !== "pending" && task.status !== "ready") return false;
  return task.dependencies.every(depId => {
    const dep = tasks.get(depId);
    return dep != null && isSuccess(dep.status);
  });
}

/**
 * Returns tasks whose dependencies are all done/passed and whose
 * status is pending or ready.
 */
export function getReadyTasks(): Task[] {
  return Array.from(tasks.values()).filter(isTaskReady);
}

/**
 * Returns tasks that are blocked because at least one dependency failed
 * (and has no retry left).
 */
export function getBlockedTasks(): Task[] {
  return Array.from(tasks.values()).filter(t => {
    if (t.status !== "pending" && t.status !== "ready") return false;
    return t.dependencies.some(depId => {
      const dep = tasks.get(depId);
      return dep?.status === "failed" || dep?.status === "blocked";
    });
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
