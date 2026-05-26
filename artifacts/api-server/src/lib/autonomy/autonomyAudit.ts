/**
 * lib/autonomy/autonomyAudit.ts — Phase 6 autonomy audit trail.
 *
 * Every autonomy action is logged here — why it started, which agent
 * was involved, what memory evidence was used, permission checks,
 * patch decisions, validation results, user approvals, rollback events,
 * and final outcome.
 *
 * Persisted to /tmp via PersistentStore.
 * Maximum 5 000 entries (oldest evicted first, except critical entries).
 */

import { randomUUID }      from "crypto";
import { PersistentStore } from "../memory/memoryStore";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuditEventType =
  | "cycle_started"      | "cycle_completed"    | "cycle_stopped"
  | "cycle_paused"       | "cycle_resumed"      | "cycle_failed"
  | "task_started"       | "task_completed"     | "task_failed"
  | "patch_proposed"     | "patch_applied"      | "patch_rejected"
  | "patch_rolled_back"
  | "approval_requested" | "approval_granted"   | "approval_denied"
  | "budget_exceeded"    | "policy_blocked"
  | "validation_passed"  | "validation_failed"
  | "autofix_attempted"  | "autofix_succeeded"  | "autofix_failed"
  | "checkpoint_created" | "rollback_executed"
  | "memory_retrieved"   | "permission_checked";

export interface AuditEntry {
  id:                string;
  cycleId:           string;
  type:              AuditEventType;
  timestamp:         number;
  agentId?:          string;
  taskId?:           string;
  reasoning:         string;
  memoryEvidence?:   string[];
  permissionChecks?: string[];
  metadata?:         Record<string, unknown>;
  /** Critical entries (rollback, policy_blocked, approval_*) survive compression. */
  critical?:         boolean;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const store = new PersistentStore<AuditEntry>("/tmp/jarvis_autonomy_audit.json", 5000);

// ─── Write API ────────────────────────────────────────────────────────────────

export function logAudit(
  params: Omit<AuditEntry, "id" | "timestamp">,
): AuditEntry {
  const entry: AuditEntry = {
    ...params,
    id:        randomUUID(),
    timestamp: Date.now(),
    critical:  params.type === "rollback_executed"  ||
               params.type === "policy_blocked"      ||
               params.type === "approval_requested"  ||
               params.type === "approval_granted"    ||
               params.type === "approval_denied"     ||
               params.type === "cycle_stopped"       ||
               !!params.critical,
  };
  return store.set(entry);
}

// ─── Read API ────────────────────────────────────────────────────────────────

export function getAuditLog(
  filter?: {
    cycleId?: string;
    type?:    AuditEventType;
    agentId?: string;
    taskId?:  string;
  },
  limit = 100,
): AuditEntry[] {
  let results = store.all();

  if (filter) {
    if (filter.cycleId) results = results.filter(e => e.cycleId === filter.cycleId);
    if (filter.type)    results = results.filter(e => e.type    === filter.type);
    if (filter.agentId) results = results.filter(e => e.agentId === filter.agentId);
    if (filter.taskId)  results = results.filter(e => e.taskId  === filter.taskId);
  }

  return results
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

export function getCycleAudit(cycleId: string): AuditEntry[] {
  return store.filter(e => e.cycleId === cycleId)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function getRecentAudit(limit = 50): AuditEntry[] {
  return store.all()
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

export function searchAudit(query: string, limit = 30): AuditEntry[] {
  const q = query.toLowerCase();
  return store.filter(e =>
    e.reasoning.toLowerCase().includes(q) ||
    (e.metadata ? JSON.stringify(e.metadata).toLowerCase().includes(q) : false),
  )
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

export function totalAuditEntries(): number { return store.count(); }

export function getCriticalAuditEntries(limit = 100): AuditEntry[] {
  return store.filter(e => !!e.critical)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}
