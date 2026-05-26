/**
 * lib/autoLoop.ts — Autonomous Dev Loop v1 (SAFE MODE)
 *
 * SAFETY CONTRACT (never break these):
 *   - AUTO MODE is OFF by default and must be explicitly enabled by the user.
 *   - Only approved LOW-risk actions are ever processed.
 *   - Blocked operations: file deletion, package.json edits, dependency installs,
 *     git danger commands, deployment commands, shell execution.
 *   - Every real execution auto-creates a checkpoint first (via executionEngine).
 *   - Safety lockout engages after LOCKOUT_THRESHOLD consecutive failures.
 *   - Lockout requires explicit manual reset — auto loop never self-unlocks.
 *   - No true background process: tick() is triggered by the frontend while the
 *     user has the panel open, preserving human oversight.
 *
 * State persisted in: {PROJECT_ROOT}/.jarvas-data/auto-loop/state.json
 * Activity log in:    {PROJECT_ROOT}/.jarvas-data/auto-loop/activity.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { PROJECT_ROOT } from "./dev/tools";
import { listActions, type AgentAction }          from "./agentActions";
import { runDryRun }                              from "./agentActionExecutor";
import { buildPlan, runExecution,
         ExecutionBlockedError, ExecutionGateError } from "./executionEngine";
import { createExecution, updateExecution,
         listExecutions }                         from "./executionRecords";

// ─── Constants ────────────────────────────────────────────────────────────────

export const MAX_QUEUE          = 3;
export const MAX_RETRIES        = 2;
export const LOCKOUT_THRESHOLD  = 3;   // consecutive failures before lockout
const ACTIVITY_MAX              = 200; // events to keep on disk
const ACTIVITY_DISPLAY          = 50;  // events returned per API call

// ─── File paths ───────────────────────────────────────────────────────────────

const AL_DIR       = path.join(PROJECT_ROOT, ".jarvas-data", "auto-loop");
const STATE_FILE   = path.join(AL_DIR, "state.json");
const ACTIVITY_FILE = path.join(AL_DIR, "activity.json");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AutoLoopState {
  enabled:          boolean;
  lockedOut:        boolean;
  lockoutReason?:   string;
  consecutiveFails: number;
  processing:       boolean;
  retries:          Record<string, number>; // actionId → retry count
  executionIds:     string[];               // all execution IDs created by auto loop
  lastProcessedAt?: string;
  updatedAt:        string;
}

export type ActivityType = "info" | "success" | "warning" | "error" | "lockout";

export interface ActivityEvent {
  id:            string;
  timestamp:     string;
  type:          ActivityType;
  message:       string;
  actionId?:     string;
  executionId?:  string;
}

export interface TickResult {
  processed: number;
  skipped:   number;
  events:    ActivityEvent[];
  lockedOut: boolean;
}

// ─── Forbidden patterns (double-gate on top of executionEngine) ───────────────

const FORBIDDEN: { pattern: RegExp; reason: string }[] = [
  { pattern: /\b(delete|remove|unlink|rmdir|rm\s)\b/i,              reason: "file deletion" },
  { pattern: /package\.json/i,                                       reason: "package.json modification" },
  { pattern: /\b(npm|pnpm|yarn)\s+(install|add|remove|update)\b/i,  reason: "dependency install" },
  { pattern: /git\s+(reset|rebase|push|checkout|restore|clean)\b/i, reason: "destructive git command" },
  { pattern: /\b(deploy|heroku|vercel|fly|netlify|render)\b/i,      reason: "deployment command" },
  { pattern: /\b(execSync|exec|spawn|eval|shell)\b/i,               reason: "shell execution" },
];

function isForbidden(action: AgentAction): boolean {
  const text = `${action.title} ${action.description}`;
  return FORBIDDEN.some(({ pattern }) => pattern.test(text));
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

function ensureDir(): void {
  if (!existsSync(AL_DIR)) mkdirSync(AL_DIR, { recursive: true });
}

const DEFAULT_STATE: AutoLoopState = {
  enabled:          false,
  lockedOut:        false,
  consecutiveFails: 0,
  processing:       false,
  retries:          {},
  executionIds:     [],
  updatedAt:        new Date().toISOString(),
};

export function getState(): AutoLoopState {
  ensureDir();
  if (!existsSync(STATE_FILE)) return { ...DEFAULT_STATE };
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8")) as AutoLoopState;
  } catch { return { ...DEFAULT_STATE }; }
}

function setState(patch: Partial<AutoLoopState>): AutoLoopState {
  ensureDir();
  const next = { ...getState(), ...patch, updatedAt: new Date().toISOString() };
  writeFileSync(STATE_FILE, JSON.stringify(next, null, 2) + "\n", "utf-8");
  return next;
}

function readActivity(): ActivityEvent[] {
  ensureDir();
  if (!existsSync(ACTIVITY_FILE)) return [];
  try {
    return JSON.parse(readFileSync(ACTIVITY_FILE, "utf-8")) as ActivityEvent[];
  } catch { return []; }
}

function appendActivity(event: ActivityEvent): void {
  ensureDir();
  const all = readActivity();
  const trimmed = [...all, event].slice(-ACTIVITY_MAX);
  writeFileSync(ACTIVITY_FILE, JSON.stringify(trimmed, null, 2) + "\n", "utf-8");
}

function makeEvent(type: ActivityType, message: string, extra?: Partial<ActivityEvent>): ActivityEvent {
  return { id: randomUUID(), timestamp: new Date().toISOString(), type, message, ...extra };
}

// ─── Public state API ─────────────────────────────────────────────────────────

export function listActivity(limit = ACTIVITY_DISPLAY): ActivityEvent[] {
  return readActivity().slice(-limit).reverse();
}

export function enable(): AutoLoopState {
  const state = getState();
  if (state.lockedOut) {
    throw new Error("Cannot enable: auto loop is locked out. Reset the lockout first.");
  }
  const next = setState({ enabled: true, processing: false });
  appendActivity(makeEvent("info", "AUTO MODE enabled by user."));
  return next;
}

export function disable(): AutoLoopState {
  const next = setState({ enabled: false, processing: false });
  appendActivity(makeEvent("info", "AUTO MODE disabled by user."));
  return next;
}

export function resetLockout(): AutoLoopState {
  const next = setState({ lockedOut: false, lockoutReason: undefined, consecutiveFails: 0 });
  appendActivity(makeEvent("warning", "Safety lockout cleared by user. Monitor closely."));
  return next;
}

// ─── Checkpoint system availability check ─────────────────────────────────────

function checkpointSystemAvailable(): boolean {
  try {
    ensureDir(); // can we write to .jarvas-data/?
    const cpDir = path.join(PROJECT_ROOT, ".jarvas-data", "checkpoints");
    if (!existsSync(cpDir)) mkdirSync(cpDir, { recursive: true });
    return true;
  } catch { return false; }
}

// ─── Compute eligible queue ───────────────────────────────────────────────────

export function computeQueue(): AgentAction[] {
  const state   = getState();
  const actions = listActions({ status: "approved" });

  return actions
    .filter(a => a.riskLevel === "low")
    .filter(a => !isForbidden(a))
    .filter(a => (state.retries[a.id] ?? 0) <= MAX_RETRIES)
    .filter(a => {
      const execs = listExecutions({ actionId: a.id });
      return !execs.some(e => e.status === "completed" && !e.dryRun);
    })
    .slice(0, MAX_QUEUE);
}

// ─── Main tick ────────────────────────────────────────────────────────────────

export async function tick(): Promise<TickResult> {
  const state = getState();
  const events: ActivityEvent[] = [];
  const log = (type: ActivityType, message: string, extra?: Partial<ActivityEvent>) => {
    const ev = makeEvent(type, message, extra);
    events.push(ev);
    appendActivity(ev);
    return ev;
  };

  // Gate 1: must be enabled
  if (!state.enabled) {
    return { processed: 0, skipped: 0, events: [], lockedOut: false };
  }

  // Gate 2: lockout check
  if (state.lockedOut) {
    return { processed: 0, skipped: 0, events: [], lockedOut: true };
  }

  // Gate 3: prevent concurrent ticks
  if (state.processing) {
    log("info", "Tick skipped: a processing cycle is already running.");
    return { processed: 0, skipped: 1, events, lockedOut: false };
  }

  // Gate 4: checkpoint system must be available
  if (!checkpointSystemAvailable()) {
    log("lockout", "Safety lockout: checkpoint system is unavailable.");
    setState({ lockedOut: true, lockoutReason: "Checkpoint system unavailable" });
    return { processed: 0, skipped: 0, events, lockedOut: true };
  }

  // Mark processing
  setState({ processing: true });

  let processed = 0;
  let skipped   = 0;

  try {
    const queue = computeQueue();

    if (queue.length === 0) {
      log("info", "No eligible actions in queue. Waiting for new approved low-risk actions.");
      return { processed: 0, skipped: 0, events, lockedOut: false };
    }

    log("info", `Processing ${queue.length} eligible action(s).`);

    for (const action of queue) {
      const retryNum = state.retries[action.id] ?? 0;
      const attempt  = retryNum + 1;
      const attemptStr = retryNum > 0 ? ` (retry ${retryNum}/${MAX_RETRIES})` : "";
      log("info", `Starting: "${action.title}"${attemptStr}`, { actionId: action.id });

      try {
        // Pre-check 1: conceptual dry-run (agentActionExecutor)
        const dryRunResult = runDryRun(action);
        if (dryRunResult.verdict === "blocked") {
          log("warning",
            `Skipping "${action.title}": conceptual dry-run verdict is BLOCKED — ${dryRunResult.summary}`,
            { actionId: action.id });
          skipped++;
          continue;
        }
        log("info", `Dry-run passed (${dryRunResult.verdict}): "${action.title}"`, { actionId: action.id });

        // Pre-check 2: execution plan must be a supported op type
        const plan = buildPlan(action);
        if (plan.operationType === "unsupported") {
          log("warning",
            `Skipping "${action.title}": cannot determine a safe operation type.`,
            { actionId: action.id });
          skipped++;
          continue;
        }
        log("info", `Execution plan: ${plan.operationType.replace(/_/g, " ")} → ${plan.targetPath}`, { actionId: action.id });

        // Create execution record (queued → running)
        const record = createExecution({
          actionId:      action.id,
          actionTitle:   action.title,
          operationType: plan.operationType,
          dryRun:        false,
        });
        updateExecution(record.id, { status: "running" });

        // Execute (auto-checkpoint is created inside runExecution)
        const result = await runExecution(
          { id: action.id, title: action.title, description: action.description,
            riskLevel: action.riskLevel, status: action.status },
          false,
        );

        // Mark completed
        const completed = updateExecution(record.id, {
          operationType: result.operationType,
          status:        "completed",
          completedAt:   new Date().toISOString(),
          checkpointId:  result.checkpointId,
          affectedFiles: result.affectedFiles,
          report:        result.report,
        });

        // Update auto-loop state
        const currentState = getState();
        setState({
          consecutiveFails: 0,
          executionIds:     [...currentState.executionIds, record.id],
          retries:          { ...currentState.retries, [action.id]: 0 },
        });

        log("success",
          `Completed: "${action.title}" · ${result.operationType.replace(/_/g, " ")} · ckpt ${result.checkpointId?.slice(0, 8) ?? "—"}`,
          { actionId: action.id, executionId: completed.id });

        processed++;

      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        const type    = err instanceof ExecutionBlockedError ? "error" :
                        err instanceof ExecutionGateError    ? "warning" : "error";

        log(type, `Failed: "${action.title}" — ${message}`, { actionId: action.id });

        // Update retry + consecutive fail count
        const currentState = getState();
        const newRetries   = (currentState.retries[action.id] ?? 0) + 1;
        const newConsFails = currentState.consecutiveFails + 1;

        setState({
          consecutiveFails: newConsFails,
          retries: { ...currentState.retries, [action.id]: newRetries },
        });

        // Try to mark the running record as failed
        try {
          const running = listExecutions({ actionId: action.id })
            .find(e => e.status === "running" || e.status === "queued");
          if (running) {
            updateExecution(running.id, {
              status: "failed", completedAt: new Date().toISOString(),
              error: message, report: `Auto-loop execution failed: ${message}`,
            });
          }
        } catch { /* ignore */ }

        skipped++;

        // Check lockout threshold
        if (newConsFails >= LOCKOUT_THRESHOLD) {
          const reason = `${LOCKOUT_THRESHOLD} consecutive failures. Last: ${message}`;
          setState({ lockedOut: true, lockoutReason: reason });
          log("lockout", `Safety lockout engaged: ${reason}`);
          break;
        }
      }
    }

  } finally {
    setState({ processing: false, lastProcessedAt: new Date().toISOString() });
  }

  const finalState = getState();
  return { processed, skipped, events, lockedOut: finalState.lockedOut };
}
