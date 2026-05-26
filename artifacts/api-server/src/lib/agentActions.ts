/**
 * lib/agentActions.ts — Agent Action Approval store
 *
 * Reads from / writes to:
 *   {PROJECT_ROOT}/.jarvas-data/tasks/pending-actions.json
 *
 * Safety rules:
 *   - Actions are NEVER deleted — only status transitions are allowed.
 *   - Approved/rejected actions are immutable (no further status change).
 *   - Writes are atomic in-memory first, then serialised to disk.
 *   - IDs must be unique; createAction() rejects duplicates.
 *   - Approval/rejection ONLY updates `status` and `updatedAt` — no side-effects.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { PROJECT_ROOT } from "./dev/tools";

// ─── File path ────────────────────────────────────────────────────────────────

const ACTIONS_DIR  = path.join(PROJECT_ROOT, ".jarvas-data", "tasks");
const ACTIONS_FILE = path.join(ACTIONS_DIR, "pending-actions.json");

// ─── Types ────────────────────────────────────────────────────────────────────

export type RiskLevel     = "low" | "medium" | "high";
export type ActionStatus  = "pending" | "approved" | "rejected";
export type ExecutionMode = "dry-run" | "manual";

export type { DryRunResult } from "./agentActionExecutor";

export interface AgentAction {
  id:               string;
  title:            string;
  description:      string;
  riskLevel:        RiskLevel;
  proposedBy:       string;
  status:           ActionStatus;
  createdAt:        string;
  updatedAt:        string;
  // Execution fields (set after a dry-run; undefined until then)
  executionMode?:   ExecutionMode;
  executedAt?:      string;
  executionResult?: import("./agentActionExecutor").DryRunResult;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function ensureDir(): void {
  if (!existsSync(ACTIONS_DIR)) {
    mkdirSync(ACTIONS_DIR, { recursive: true });
  }
}

function readRaw(): AgentAction[] {
  ensureDir();
  if (!existsSync(ACTIONS_FILE)) return [];
  try {
    const raw = readFileSync(ACTIONS_FILE, "utf-8").trim();
    if (!raw) return [];
    return JSON.parse(raw) as AgentAction[];
  } catch {
    return [];
  }
}

function writeRaw(actions: AgentAction[]): void {
  ensureDir();
  writeFileSync(ACTIONS_FILE, JSON.stringify(actions, null, 2) + "\n", "utf-8");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * List all actions, optionally filtered by status.
 * Returns newest-first.
 */
export function listActions(filter?: { status?: ActionStatus }): AgentAction[] {
  let actions = readRaw();
  if (filter?.status) {
    actions = actions.filter(a => a.status === filter.status);
  }
  return [...actions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/**
 * Create a new pending action.
 * `id` is auto-generated if not provided.
 * Throws if an action with the same id already exists.
 */
export function createAction(data: {
  id?:         string;
  title:       string;
  description: string;
  riskLevel?:  RiskLevel;
  proposedBy?: string;
}): AgentAction {
  const actions = readRaw();
  const id      = data.id ?? randomUUID();

  if (actions.some(a => a.id === id)) {
    throw new Error(`Action with id "${id}" already exists.`);
  }

  const now = new Date().toISOString();
  const action: AgentAction = {
    id,
    title:       data.title,
    description: data.description,
    riskLevel:   data.riskLevel  ?? "medium",
    proposedBy:  data.proposedBy ?? "agent",
    status:      "pending",
    createdAt:   now,
    updatedAt:   now,
  };

  writeRaw([...actions, action]);
  return action;
}

/**
 * Approve a pending action.
 * Only transitions pending → approved.
 * Throws if action not found or already resolved.
 */
export function approveAction(id: string): AgentAction {
  return _transition(id, "approved");
}

/**
 * Reject a pending action.
 * Only transitions pending → rejected.
 * Throws if action not found or already resolved.
 */
export function rejectAction(id: string): AgentAction {
  return _transition(id, "rejected");
}

/**
 * Record the result of a dry-run on an approved action.
 * Only approved actions may be dry-run.
 * Sets executionMode, executedAt, executionResult, and updatedAt.
 * Throws if the action is not found or is not approved.
 */
export function recordDryRun(
  id:     string,
  result: import("./agentActionExecutor").DryRunResult,
): AgentAction {
  const actions = readRaw();
  const idx     = actions.findIndex(a => a.id === id);

  if (idx === -1) {
    throw new Error(`Action "${id}" not found.`);
  }

  const action = actions[idx];
  if (action.status !== "approved") {
    throw new Error(
      `Action "${id}" must be approved before a dry-run can be recorded (current status: ${action.status}).`,
    );
  }

  const now     = new Date().toISOString();
  const updated: AgentAction = {
    ...action,
    executionMode:   "dry-run",
    executedAt:      now,
    executionResult: result,
    updatedAt:       now,
  };

  const all = actions.map((a, i) => (i === idx ? updated : a));
  writeRaw(all);
  return updated;
}

function _transition(id: string, next: "approved" | "rejected"): AgentAction {
  const actions = readRaw();
  const idx     = actions.findIndex(a => a.id === id);

  if (idx === -1) {
    throw new Error(`Action "${id}" not found.`);
  }

  const action = actions[idx];
  if (action.status !== "pending") {
    throw new Error(
      `Action "${id}" is already ${action.status} and cannot be ${next}.`,
    );
  }

  const updated: AgentAction = {
    ...action,
    status:    next,
    updatedAt: new Date().toISOString(),
  };

  const all = actions.map((a, i) => (i === idx ? updated : a));
  writeRaw(all);
  return updated;
}
