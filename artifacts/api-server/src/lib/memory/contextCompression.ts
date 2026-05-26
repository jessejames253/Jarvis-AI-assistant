/**
 * lib/memory/contextCompression.ts — Phase 5 memory compression + retrieval.
 *
 * TWO responsibilities:
 *
 * 1. COMPRESSION — Keeps memory stores from growing unbounded:
 *    - Groups duplicate/repetitive events by type + day
 *    - Replaces N identical events with ONE summarized entry
 *    - Always preserves: rollbacks, critical decisions, architecture events
 *    - Compresses: duplicate TS errors, repeated validation logs
 *
 * 2. CONTEXT RETRIEVAL — Agents call getRelevantMemory() before running:
 *    - Returns a compact string with relevant history + patterns + decisions
 *    - Filtered by affected files, issue type, and task category
 *    - Read-only — agents cannot write to memory through this interface
 *    - Risk history is always included when files match known hot paths
 */

import { getAllEvents, replaceHistory, addHistoryEvent } from "./projectHistory";
import { getAllDecisions, replaceDecisions }              from "./decisionLog";
import { getRecommendations, getAllPatterns }             from "./patternLearning";
import { getRecentHistory, getByFile, getRollbackHistory } from "./projectHistory";
import { getRecentDecisions, getDecisions }              from "./decisionLog";
import type { HistoryEvent }                             from "./projectHistory";
import type { DecisionEntry }                            from "./decisionLog";

// ─── Retrieval types ──────────────────────────────────────────────────────────

export interface RelevantMemory {
  /** Plain text summary for injection into agent system prompts. */
  summary:         string;
  /** Structured breakdown for UI display. */
  recommendations: string[];
  recentHistory:   Array<{ type: string; description: string; timestamp: number }>;
  recentDecisions: Array<{ type: string; reasoning: string; timestamp: number }>;
  riskWarnings:    string[];
  hasRollbackHistory: boolean;
}

// ─── Context Retrieval ────────────────────────────────────────────────────────

/**
 * Build a relevant memory block for agent pre-context injection.
 *
 * SAFETY: this function is read-only — it never modifies any store.
 */
export function getRelevantMemory(context: {
  files?:         string[];
  issueType?:     string;
  taskCategory?:  string;
  agentId?:       string;
  maxItems?:      number;
}): RelevantMemory {
  const max = context.maxItems ?? 5;

  // ── History relevant to files ──────────────────────────────────────────────
  let historyItems: HistoryEvent[] = [];
  if (context.files?.length) {
    for (const file of context.files) {
      historyItems.push(...getByFile(file, 5));
    }
    // De-duplicate by id
    const seen = new Set<string>();
    historyItems = historyItems.filter(h => seen.has(h.id) ? false : (seen.add(h.id), true));
  } else {
    historyItems = getRecentHistory(max);
  }
  historyItems = historyItems.slice(0, max);

  // ── Rollback history for files ────────────────────────────────────────────
  const rollbacks = getRollbackHistory(5);
  const fileRollbacks = context.files?.length
    ? rollbacks.filter(r => r.affectedFiles?.some(f => context.files!.some(q => f.includes(q) || q.includes(f))) ?? false)
    : rollbacks.slice(0, 3);

  // ── Decisions ─────────────────────────────────────────────────────────────
  const decisions: DecisionEntry[] = context.files?.length || context.issueType
    ? getRecentDecisions(max)
    : getRecentDecisions(3);

  // ── Patterns / recommendations ─────────────────────────────────────────────
  const recommendations = getRecommendations({ files: context.files, issueType: context.issueType });

  // ── Risk warnings (rollback history for matched files) ────────────────────
  const riskWarnings: string[] = [];
  if (fileRollbacks.length > 0) {
    riskWarnings.push(
      `${fileRollbacks.length} rollback(s) recorded for affected files — proceed carefully`,
    );
    for (const rb of fileRollbacks.slice(0, 3)) {
      riskWarnings.push(`  Rollback: ${rb.description}${rb.resolution ? ` → ${rb.resolution}` : ""}`);
    }
  }

  // ── Build plain-text summary ───────────────────────────────────────────────
  const parts: string[] = [];

  if (riskWarnings.length > 0) {
    parts.push(`RISK HISTORY:\n${riskWarnings.join("\n")}`);
  }

  if (recommendations.length > 0) {
    parts.push(`PATTERN RECOMMENDATIONS:\n${recommendations.slice(0, 4).map(r => `• ${r}`).join("\n")}`);
  }

  if (historyItems.length > 0) {
    const histLines = historyItems
      .map(h => `[${h.type}] ${h.description}${h.errorMessage ? ` — ${h.errorMessage.slice(0, 120)}` : ""}`)
      .join("\n");
    parts.push(`RECENT HISTORY:\n${histLines}`);
  }

  if (decisions.length > 0) {
    const decLines = decisions.slice(0, 3).map(d => `[${d.type}] ${d.reasoning.slice(0, 150)}`).join("\n");
    parts.push(`RECENT DECISIONS:\n${decLines}`);
  }

  return {
    summary:         parts.join("\n\n"),
    recommendations,
    recentHistory:   historyItems.map(h => ({ type: h.type, description: h.description, timestamp: h.timestamp })),
    recentDecisions: decisions.map(d => ({ type: d.type, reasoning: d.reasoning, timestamp: d.timestamp })),
    riskWarnings,
    hasRollbackHistory: fileRollbacks.length > 0,
  };
}

// ─── Compression ─────────────────────────────────────────────────────────────

export interface CompressionResult {
  originalCount:  number;
  compressedCount: number;
  removed:        number;
  preservedCritical: number;
}

/**
 * Compress project history:
 *  - Keep ALL critical / rollback events
 *  - For each (type + day) bucket, keep at most 3 events — replace the rest
 *    with a single count summary entry
 */
export function compressHistory(): CompressionResult {
  const all = getAllEvents();
  const originalCount = all.length;

  const critical   = all.filter(e => e.critical || e.isRollback);
  const compressible = all.filter(e => !e.critical && !e.isRollback);

  // Group by type + day-bucket
  const buckets = new Map<string, HistoryEvent[]>();
  for (const e of compressible) {
    const day = new Date(e.timestamp).toISOString().slice(0, 10);
    const key = `${e.type}::${day}`;
    const list = buckets.get(key) ?? [];
    list.push(e);
    buckets.set(key, list);
  }

  const kept: HistoryEvent[] = [...critical];
  for (const [key, events] of buckets.entries()) {
    if (events.length <= 3) {
      kept.push(...events);
    } else {
      // Keep most recent 2
      const sorted = events.sort((a, b) => b.timestamp - a.timestamp);
      kept.push(sorted[0], sorted[1]);
      // Add a summary entry
      const [type, day] = key.split("::");
      kept.push({
        id:          `compress-${key}-${Date.now()}`,
        type:        type as HistoryEvent["type"],
        timestamp:   sorted[sorted.length - 1].timestamp,
        description: `[Compressed] ${events.length - 2} additional "${type}" events on ${day}`,
        critical:    false,
        metadata:    { compressed: true, originalCount: events.length },
      });
    }
  }

  replaceHistory(kept);

  return {
    originalCount,
    compressedCount: kept.length,
    removed:         originalCount - kept.length,
    preservedCritical: critical.length,
  };
}

/**
 * Compress decision log:
 *  - Keep ALL critical decisions (rollback, approval)
 *  - For routine decisions, keep the most recent 500
 */
export function compressDecisions(): { originalCount: number; compressedCount: number } {
  const all     = getAllDecisions();
  const critical = all.filter(d => d.critical);
  const routine  = all.filter(d => !d.critical).sort((a, b) => b.timestamp - a.timestamp).slice(0, 500);

  const kept = [...critical, ...routine];
  replaceDecisions(kept);

  return { originalCount: all.length, compressedCount: kept.length };
}

/** Run both compression passes and return a combined report. */
export function runFullCompression(): {
  history: CompressionResult;
  decisions: { originalCount: number; compressedCount: number };
} {
  return {
    history:   compressHistory(),
    decisions: compressDecisions(),
  };
}

/** Search across all memory in a unified way. */
export function searchAllMemory(query: string): {
  history:     Array<{ type: string; description: string; timestamp: number }>;
  decisions:   Array<{ type: string; reasoning: string; timestamp: number }>;
  patterns:    Array<{ type: string; recommendation: string; confidence: number }>;
} {
  const q = query.toLowerCase();

  const history = getRecentHistory(200)
    .filter(h =>
      h.description.toLowerCase().includes(q) ||
      (h.errorMessage?.toLowerCase().includes(q) ?? false),
    )
    .slice(0, 20)
    .map(h => ({ type: h.type, description: h.description, timestamp: h.timestamp }));

  const decisions = getRecentDecisions(100)
    .filter(d =>
      d.reasoning.toLowerCase().includes(q) ||
      (d.outcome?.toLowerCase().includes(q) ?? false),
    )
    .slice(0, 20)
    .map(d => ({ type: d.type, reasoning: d.reasoning, timestamp: d.timestamp }));

  const patterns = getAllPatterns()
    .filter(p =>
      p.description.toLowerCase().includes(q) ||
      p.recommendation.toLowerCase().includes(q),
    )
    .slice(0, 10)
    .map(p => ({ type: p.type, recommendation: p.recommendation, confidence: p.confidence }));

  return { history, decisions, patterns };
}
