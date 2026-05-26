/**
 * lib/memory/decisionLog.ts — Phase 5 decision reasoning log.
 *
 * Tracks the WHY behind every significant agent action:
 *   - why a patch was approved
 *   - why a rollback occurred
 *   - why a task failed
 *   - why a retry happened
 *   - agent reasoning summaries
 *   - risk rationale
 *
 * Maximum 1 000 entries. Critical decisions (rollback, approval) are
 * flagged and preserved through compression cycles.
 *
 * SAFETY: read-only for agents — no agent may delete or modify decisions.
 */

import { randomUUID }    from "crypto";
import { PersistentStore } from "./memoryStore";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DecisionType =
  | "patch_approved"     // Human or auto-approved a patch
  | "patch_rejected"     // Patch was rejected before application
  | "rollback"           // A rollback was triggered
  | "task_failed"        // Agent task failed with reasoning
  | "retry"              // Task retry was initiated
  | "agent_reasoning"    // General agent reasoning summary
  | "risk_assessment"    // Risk scoring decision
  | "plan_started"       // Orchestration plan started
  | "plan_completed"     // Orchestration plan completed
  | "approval_required"; // Approval gate triggered

export interface DecisionEntry {
  id:            string;
  type:          DecisionType;
  timestamp:     number;
  agentId?:      string;
  taskId?:       string;
  patchId?:      string;
  orchestrationId?: string;
  reasoning:     string;
  riskRationale?: string;
  outcome?:      string;
  /** Critical decisions (rollback / approval) must survive compression. */
  critical?:     boolean;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const store = new PersistentStore<DecisionEntry>("/tmp/jarvis_decision_log.json", 1000);

// ─── Write API ────────────────────────────────────────────────────────────────

export function logDecision(
  params: Omit<DecisionEntry, "id" | "timestamp">,
): DecisionEntry {
  const entry: DecisionEntry = {
    ...params,
    id:        randomUUID(),
    timestamp: Date.now(),
    critical:  params.type === "rollback" ||
               params.type === "patch_approved" ||
               params.type === "approval_required" ||
               !!params.critical,
  };
  return store.set(entry);
}

// ─── Read API ────────────────────────────────────────────────────────────────

export function getDecisions(filter?: {
  type?:            DecisionType;
  agentId?:         string;
  taskId?:          string;
  patchId?:         string;
  orchestrationId?: string;
  critical?:        boolean;
}, limit = 50): DecisionEntry[] {
  let results = store.all();

  if (filter) {
    if (filter.type)            results = results.filter(d => d.type           === filter.type);
    if (filter.agentId)         results = results.filter(d => d.agentId        === filter.agentId);
    if (filter.taskId)          results = results.filter(d => d.taskId         === filter.taskId);
    if (filter.patchId)         results = results.filter(d => d.patchId        === filter.patchId);
    if (filter.orchestrationId) results = results.filter(d => d.orchestrationId === filter.orchestrationId);
    const critVal = filter.critical;
    if (critVal != null) results = results.filter(d => !!d.critical === critVal);
  }

  return results
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

export function getRecentDecisions(limit = 20): DecisionEntry[] {
  return store.all()
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

export function getCriticalDecisions(limit = 50): DecisionEntry[] {
  return store.filter(d => !!d.critical)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

export function searchDecisions(query: string, limit = 20): DecisionEntry[] {
  const q = query.toLowerCase();
  return store.filter(
    d => d.reasoning.toLowerCase().includes(q)              ||
         (d.outcome?.toLowerCase().includes(q) ?? false)     ||
         (d.riskRationale?.toLowerCase().includes(q) ?? false),
  )
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

export function totalDecisions(): number { return store.count(); }

export function getAllDecisions(): DecisionEntry[] { return store.all(); }

/** Bulk replace decisions — used by compression only. */
export function replaceDecisions(entries: DecisionEntry[]): void {
  store.clear();
  for (const e of entries) store.set(e);
}
