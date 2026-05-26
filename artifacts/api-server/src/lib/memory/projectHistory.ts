/**
 * lib/memory/projectHistory.ts — Phase 5 project event history.
 *
 * Stores a timestamped log of all significant project events:
 *   - successful and failed fixes / patches
 *   - rollback events (with reason)
 *   - recurring TypeScript and runtime errors
 *   - validation outcomes
 *   - prior architecture decisions
 *   - common workflows
 *   - user-approved patterns
 *
 * Maximum 2 000 events (oldest evicted first).
 * Rollback events are never evicted — they are preserved permanently.
 *
 * SAFETY: memory retrieval is read-only for agents — no writes via agent context.
 */

import { randomUUID }    from "crypto";
import { PersistentStore } from "./memoryStore";

// ─── Types ────────────────────────────────────────────────────────────────────

export type HistoryEventType =
  | "fix_success"         // A code fix was applied and passed validation
  | "fix_failure"         // A code fix failed or was rejected
  | "rollback"            // A change was rolled back
  | "ts_error"            // TypeScript compile error detected
  | "runtime_error"       // Runtime error recorded
  | "validation_passed"   // Full validation pipeline passed
  | "validation_failed"   // Full validation pipeline failed
  | "architecture_decision" // A structural project decision was made
  | "workflow_run"        // A multi-agent plan was executed
  | "user_approved_pattern"; // User explicitly approved a pattern

export interface HistoryEvent {
  id:            string;
  type:          HistoryEventType;
  timestamp:     number;
  description:   string;
  affectedFiles?: string[];
  errorMessage?:  string;
  resolution?:    string;
  patchId?:       string;
  agentId?:       string;
  orchestrationId?: string;
  /** Rollback events must be preserved indefinitely. */
  isRollback?:   boolean;
  /** High-severity events that must survive compression. */
  critical?:     boolean;
  metadata?:     Record<string, unknown>;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const store = new PersistentStore<HistoryEvent>("/tmp/jarvis_project_history.json", 2000);

// ─── Write API ────────────────────────────────────────────────────────────────

export function addHistoryEvent(
  params: Omit<HistoryEvent, "id" | "timestamp">,
): HistoryEvent {
  const event: HistoryEvent = {
    ...params,
    id:        randomUUID(),
    timestamp: Date.now(),
    isRollback: params.type === "rollback" ? true : params.isRollback,
    critical:  params.type === "rollback" ||
               params.type === "architecture_decision" ||
               params.critical,
  };
  return store.set(event);
}

// ─── Read API ────────────────────────────────────────────────────────────────

export function getRecentHistory(limit = 50): HistoryEvent[] {
  return store.all()
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

export function getByType(type: HistoryEventType, limit = 50): HistoryEvent[] {
  return store.filter(e => e.type === type)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

export function getByFile(filePath: string, limit = 30): HistoryEvent[] {
  return store.filter(e => e.affectedFiles?.some(f => f.includes(filePath)) ?? false)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

export function getRollbackHistory(limit = 50): HistoryEvent[] {
  return store.filter(e => e.isRollback === true || e.type === "rollback")
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

export function getByAgent(agentId: string, limit = 50): HistoryEvent[] {
  return store.filter(e => e.agentId === agentId)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

export function getByOrchestration(orchestrationId: string): HistoryEvent[] {
  return store.filter(e => e.orchestrationId === orchestrationId)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function searchHistory(query: string, limit = 30): HistoryEvent[] {
  const q = query.toLowerCase();
  return store.filter(e =>
    e.description.toLowerCase().includes(q) ||
    (e.errorMessage?.toLowerCase().includes(q) ?? false) ||
    (e.resolution?.toLowerCase().includes(q) ?? false) ||
    (e.affectedFiles?.some(f => f.toLowerCase().includes(q)) ?? false),
  )
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

/** Count events per type — useful for pattern analysis. */
export function getEventCounts(): Record<HistoryEventType, number> {
  const counts = {} as Record<HistoryEventType, number>;
  for (const e of store.all()) {
    counts[e.type] = (counts[e.type] ?? 0) + 1;
  }
  return counts;
}

/** All events touching a set of files. */
export function getEventsForFiles(files: string[]): HistoryEvent[] {
  return store.filter(e =>
    e.affectedFiles?.some(f => files.some(q => f.includes(q) || q.includes(f))) ?? false,
  ).sort((a, b) => b.timestamp - a.timestamp);
}

export function totalEvents(): number {
  return store.count();
}

/** Retrieve the raw store for compression utilities. */
export function getAllEvents(): HistoryEvent[] {
  return store.all();
}

/** Replace the full history (used by compression only). */
export function replaceHistory(events: HistoryEvent[]): void {
  store.clear();
  for (const e of events) store.set(e);
}
