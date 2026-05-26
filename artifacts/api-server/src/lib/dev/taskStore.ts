/**
 * lib/dev/taskStore.ts — Disk-persisted Dev Task store.
 *
 * Tasks survive API restarts, hot reloads, and browser refreshes.
 * Stored at /tmp/jarvis_tasks.json as a JSON array.
 */

import { readFileSync, writeFileSync } from "fs";

const TASKS_FILE = "/tmp/jarvis_tasks.json";

export type TaskStatus =
  | "queued" | "running" | "waiting_approval" | "applied"
  | "failed" | "rolled_back" | "cancelled" | "completed";

export interface TaskMessage {
  id: string;
  role: "user" | "agent" | "system";
  type: string;
  text?: string;
  patchId?: string;
  error?: string;
  createdAt: number;
}

export interface PatchRef {
  patchId: string;
  file: string;
  description: string;
  riskLevel?: "low" | "medium" | "high";
  status: "proposed" | "applied" | "rejected";
  snapshotId?: string;
}

export interface DevTask {
  id: string;
  title: string;
  prompt: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  messages: TaskMessage[];
  proposedPatches: PatchRef[];
  appliedPatches: PatchRef[];
  rollbackBackups: string[];
  lastError?: string;
  validationResult?: "passed" | "failed" | "skipped";
  gitCommitHash?: string;
}

// ─── In-memory store (synced to disk) ────────────────────────────────────────

let tasks: Map<string, DevTask> = new Map();

function loadFromDisk(): void {
  try {
    const raw = readFileSync(TASKS_FILE, "utf8");
    const arr = JSON.parse(raw) as DevTask[];
    tasks = new Map(arr.map(t => [t.id, t]));
  } catch { /* file not found or invalid */ }
}

function saveToDisk(): void {
  try {
    const arr = Array.from(tasks.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50); // keep last 50 tasks
    writeFileSync(TASKS_FILE, JSON.stringify(arr, null, 2), "utf8");
  } catch { /* non-fatal */ }
}

loadFromDisk();

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function getAllTasks(): DevTask[] {
  return Array.from(tasks.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getTask(id: string): DevTask | undefined {
  return tasks.get(id);
}

export function createTask(prompt: string, title?: string): DevTask {
  const id = crypto.randomUUID();
  const now = Date.now();
  const task: DevTask = {
    id,
    title: title ?? prompt.slice(0, 60).replace(/\n/g, " "),
    prompt,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    messages: [],
    proposedPatches: [],
    appliedPatches: [],
    rollbackBackups: [],
  };
  tasks.set(id, task);
  saveToDisk();
  return task;
}

export function updateTask(id: string, patch: Partial<DevTask>): DevTask | null {
  const task = tasks.get(id);
  if (!task) return null;
  const updated = { ...task, ...patch, id, updatedAt: Date.now() };
  tasks.set(id, updated);
  saveToDisk();
  return updated;
}

export function deleteTask(id: string): boolean {
  const existed = tasks.has(id);
  tasks.delete(id);
  if (existed) saveToDisk();
  return existed;
}

export function addMessage(taskId: string, msg: Omit<TaskMessage, "id" | "createdAt">): TaskMessage | null {
  const task = tasks.get(taskId);
  if (!task) return null;
  const message: TaskMessage = { ...msg, id: crypto.randomUUID(), createdAt: Date.now() };
  const messages = [...task.messages, message].slice(-150); // cap at 150 messages
  tasks.set(taskId, { ...task, messages, updatedAt: Date.now() });
  saveToDisk();
  return message;
}

export function addPatchToTask(taskId: string, patch: PatchRef): void {
  const task = tasks.get(taskId);
  if (!task) return;
  const proposed = [...task.proposedPatches.filter(p => p.patchId !== patch.patchId), patch];
  tasks.set(taskId, { ...task, proposedPatches: proposed, status: "waiting_approval", updatedAt: Date.now() });
  saveToDisk();
}

export function markPatchApplied(taskId: string, patchId: string, snapshotId?: string): void {
  const task = tasks.get(taskId);
  if (!task) return;
  const proposed = task.proposedPatches.find(p => p.patchId === patchId);
  if (!proposed) return;
  const updated: PatchRef = { ...proposed, status: "applied", snapshotId };
  tasks.set(taskId, {
    ...task,
    proposedPatches: task.proposedPatches.filter(p => p.patchId !== patchId),
    appliedPatches: [...task.appliedPatches, updated],
    status: "applied",
    updatedAt: Date.now(),
  });
  saveToDisk();
}
