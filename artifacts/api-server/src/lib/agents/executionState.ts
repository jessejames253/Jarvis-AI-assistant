/**
 * lib/agents/executionState.ts — Phase 4B execution state manager.
 *
 * Manages the live run state of each orchestration:
 *  - run state (idle / running / paused / completed / failed)
 *  - the current active agent + task
 *  - a timeline of every orchestration event
 *  - final execution summary data
 *
 * Persisted to /tmp so state survives server restarts.
 */

import { randomUUID }              from "crypto";
import { readFileSync, writeFileSync } from "fs";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RunState =
  | "idle" | "running" | "paused" | "completed" | "failed";

export type TimelineEventType =
  | "plan_started"        | "plan_paused"       | "plan_resumed"
  | "plan_completed"      | "task_created"       | "task_started"
  | "task_completed"      | "task_failed"        | "handoff_sent"
  | "proposal_queued"     | "validation_started" | "validation_result"
  | "retry_attempted"     | "approval_requested" | "rollback_triggered";

export interface TimelineEvent {
  id:              string;
  orchestrationId: string;
  timestamp:       number;
  type:            TimelineEventType;
  taskId?:         string;
  agentId?:        string;
  message:         string;
  metadata?:       Record<string, unknown>;
}

export interface OrchestrationRun {
  orchestrationId: string;
  state:           RunState;
  currentAgentId?: string;
  activeTaskId?:   string;
  startedAt?:      number;
  completedAt?:    number;
  timeline:        TimelineEvent[];
}

// ─── Persistence ──────────────────────────────────────────────────────────────

const STATE_FILE = "/tmp/jarvis_execution_state.json";
const runs       = new Map<string, OrchestrationRun>();

function load(): void {
  try {
    const raw = JSON.parse(
      readFileSync(STATE_FILE, "utf8"),
    ) as Array<[string, OrchestrationRun]>;
    for (const [k, v] of raw) runs.set(k, v);
  } catch { /* fresh start */ }
}

function save(): void {
  try {
    writeFileSync(
      STATE_FILE,
      JSON.stringify(Array.from(runs.entries())),
      "utf8",
    );
  } catch { /* non-fatal */ }
}

load();

// ─── Run state ────────────────────────────────────────────────────────────────

export function getOrchestrationRun(
  orchestrationId: string,
): OrchestrationRun | undefined {
  return runs.get(orchestrationId);
}

export function getOrCreateRun(orchestrationId: string): OrchestrationRun {
  if (!runs.has(orchestrationId)) {
    runs.set(orchestrationId, {
      orchestrationId,
      state:    "idle",
      timeline: [],
    });
  }
  return runs.get(orchestrationId)!;
}

export function setRunState(
  orchestrationId: string,
  state: RunState,
): void {
  const run = getOrCreateRun(orchestrationId);
  run.state = state;
  if (state === "running" && !run.startedAt) run.startedAt = Date.now();
  if (state === "completed" || state === "failed")
    run.completedAt = Date.now();
  save();
}

export function setActiveTask(
  orchestrationId: string,
  taskId:   string | undefined,
  agentId:  string | undefined,
): void {
  const run = getOrCreateRun(orchestrationId);
  run.activeTaskId   = taskId;
  run.currentAgentId = agentId;
  save();
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

export function addTimelineEvent(
  orchestrationId: string,
  type: TimelineEventType,
  opts: {
    taskId?:   string;
    agentId?:  string;
    message?:  string;
    metadata?: Record<string, unknown>;
  } = {},
): TimelineEvent {
  const event: TimelineEvent = {
    id:              randomUUID(),
    orchestrationId,
    timestamp:       Date.now(),
    type,
    taskId:          opts.taskId,
    agentId:         opts.agentId,
    message:         opts.message ?? type.replace(/_/g, " "),
    metadata:        opts.metadata,
  };
  const run = getOrCreateRun(orchestrationId);
  run.timeline.push(event);
  // Cap to 500 events per orchestration
  if (run.timeline.length > 500)
    run.timeline.splice(0, run.timeline.length - 500);
  save();
  return event;
}

export function getTimeline(orchestrationId: string): TimelineEvent[] {
  return (runs.get(orchestrationId)?.timeline ?? [])
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp);
}

/** Reset a run (used in tests or when restarting a plan). */
export function resetRun(orchestrationId: string): void {
  runs.set(orchestrationId, {
    orchestrationId,
    state:    "idle",
    timeline: [],
  });
  save();
}

/** List all known orchestration IDs. */
export function listRuns(): string[] {
  return Array.from(runs.keys());
}
