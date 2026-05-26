/**
 * lib/memory/patternLearning.ts — Phase 5 pattern detection and recommendations.
 *
 * Analyses the project history to identify:
 *   - Repeated fixes (same description / file succeeds consistently)
 *   - Repeated failures (same file fails 2+ times)
 *   - Unstable files (high churn / multiple rollbacks)
 *   - High-risk modules (frequent validation failures)
 *   - Common dependency chains that caused rollbacks
 *   - Successful patch patterns worth repeating
 *
 * Produces:
 *   - Confidence boosts for well-proven approaches
 *   - Risk adjustments for historically unstable areas
 *   - Architectural recommendations surfaced to agents and UI
 */

import { randomUUID }           from "crypto";
import { PersistentStore }      from "./memoryStore";
import type { HistoryEvent }    from "./projectHistory";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PatternType =
  | "recurring_fix"       // Same fix succeeded multiple times
  | "recurring_failure"   // Same file / pattern keeps failing
  | "unstable_file"       // File has high number of rollbacks
  | "high_risk_module"    // Module repeatedly causes validation failures
  | "dep_chain_risk"      // Dependency chain previously caused rollback
  | "successful_patch";   // Patch pattern that consistently passes

export interface Pattern {
  id:              string;
  type:            PatternType;
  description:     string;
  affectedFiles?:  string[];
  occurrenceCount: number;
  /** 0-100: how confident we are this pattern is real. */
  confidence:      number;
  /** Increase (+) or decrease (-) baseline risk by this amount. */
  riskAdjustment:  number;
  recommendation:  string;
  firstSeen:       number;
  lastSeen:        number;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const store = new PersistentStore<Pattern>("/tmp/jarvis_patterns.json", 500);

// ─── Analysis ─────────────────────────────────────────────────────────────────

/** Run pattern analysis over a full history array and persist results. */
export function analyzeHistory(history: HistoryEvent[]): Pattern[] {
  const fileFailCounts  = new Map<string, number>();
  const fileRollbacks   = new Map<string, number>();
  const fixDescriptions = new Map<string, number>();

  for (const ev of history) {
    for (const f of ev.affectedFiles ?? []) {
      if (ev.type === "fix_failure" || ev.type === "validation_failed" || ev.type === "ts_error") {
        fileFailCounts.set(f, (fileFailCounts.get(f) ?? 0) + 1);
      }
      if (ev.type === "rollback") {
        fileRollbacks.set(f, (fileRollbacks.get(f) ?? 0) + 1);
      }
    }
    if (ev.type === "fix_success" && ev.description) {
      fixDescriptions.set(ev.description, (fixDescriptions.get(ev.description) ?? 0) + 1);
    }
  }

  const now = Date.now();
  const newPatterns: Pattern[] = [];

  // Recurring failures (≥ 2 failures on same file)
  for (const [file, count] of fileFailCounts.entries()) {
    if (count >= 2) {
      newPatterns.push({
        id:              randomUUID(),
        type:            "recurring_failure",
        description:     `File repeatedly fails validation`,
        affectedFiles:   [file],
        occurrenceCount: count,
        confidence:      Math.min(95, 40 + count * 15),
        riskAdjustment:  +Math.min(30, count * 8),
        recommendation:  `⚠ "${shortName(file)}" has failed ${count} times — treat with caution and run extra validation before patching`,
        firstSeen:       now,
        lastSeen:        now,
      });
    }
  }

  // Unstable files (≥ 1 rollback)
  for (const [file, count] of fileRollbacks.entries()) {
    newPatterns.push({
      id:              randomUUID(),
      type:            "unstable_file",
      description:     `File required rollback`,
      affectedFiles:   [file],
      occurrenceCount: count,
      confidence:      Math.min(95, 60 + count * 15),
      riskAdjustment:  +Math.min(40, count * 12),
      recommendation:  `⛔ "${shortName(file)}" has been rolled back ${count} time(s) — elevated risk, approval required for any patch`,
      firstSeen:       now,
      lastSeen:        now,
    });
  }

  // Successful recurring fixes (≥ 2 identical success descriptions)
  for (const [desc, count] of fixDescriptions.entries()) {
    if (count >= 2) {
      newPatterns.push({
        id:              randomUUID(),
        type:            "successful_patch",
        description:     desc,
        occurrenceCount: count,
        confidence:      Math.min(90, 50 + count * 10),
        riskAdjustment:  -Math.min(15, count * 5),
        recommendation:  `✓ This fix pattern has succeeded ${count} times — safe to apply with standard review`,
        firstSeen:       now,
        lastSeen:        now,
      });
    }
  }

  // Persist all new patterns
  store.clear();
  for (const p of newPatterns) store.set(p);

  return newPatterns;
}

/** Add or update a single pattern from a new event (incremental). */
export function updatePatternFromEvent(event: HistoryEvent): void {
  const files = event.affectedFiles ?? [];
  if (files.length === 0) return;

  if (event.type === "rollback") {
    for (const file of files) {
      const existing = store.filter(p => p.type === "unstable_file" && (p.affectedFiles?.includes(file) ?? false))[0];
      if (existing) {
        store.patch(existing.id, {
          occurrenceCount: existing.occurrenceCount + 1,
          confidence:      Math.min(95, existing.confidence + 10),
          riskAdjustment:  Math.min(60, existing.riskAdjustment + 12),
          lastSeen:        Date.now(),
          recommendation:  `⛔ "${shortName(file)}" has been rolled back ${existing.occurrenceCount + 1} time(s) — elevated risk, approval required`,
        });
      } else {
        store.set({
          id: randomUUID(), type: "unstable_file",
          description:     `File required rollback`,
          affectedFiles:   [file], occurrenceCount: 1, confidence: 60,
          riskAdjustment:  12,
          recommendation:  `⛔ "${shortName(file)}" was rolled back — caution advised`,
          firstSeen: Date.now(), lastSeen: Date.now(),
        });
      }
    }
  }

  if (event.type === "fix_failure" || event.type === "ts_error") {
    for (const file of files) {
      const existing = store.filter(p => p.type === "recurring_failure" && (p.affectedFiles?.includes(file) ?? false))[0];
      if (existing) {
        store.patch(existing.id, {
          occurrenceCount: existing.occurrenceCount + 1,
          confidence:      Math.min(95, existing.confidence + 8),
          riskAdjustment:  Math.min(40, existing.riskAdjustment + 8),
          lastSeen:        Date.now(),
          recommendation:  `⚠ "${shortName(file)}" has failed ${existing.occurrenceCount + 1} times`,
        });
      }
    }
  }
}

// ─── Read API ─────────────────────────────────────────────────────────────────

export function getAllPatterns(): Pattern[] {
  return store.all().sort((a, b) => b.confidence - a.confidence);
}

export function getPatternsByType(type: PatternType): Pattern[] {
  return store.filter(p => p.type === type).sort((a, b) => b.confidence - a.confidence);
}

/** Get recommendations relevant to a set of files or issue type. */
export function getRecommendations(context: {
  files?:     string[];
  issueType?: string;
}): string[] {
  const all = store.all();
  const relevant: string[] = [];

  for (const p of all) {
    const matchesFile = context.files?.some(f =>
      p.affectedFiles?.some(pf => pf.includes(f) || f.includes(pf)) ?? false,
    );
    if (matchesFile || !context.files?.length) {
      relevant.push(p.recommendation);
    }
  }

  return [...new Set(relevant)].slice(0, 8);
}

export function searchPatterns(query: string): Pattern[] {
  const q = query.toLowerCase();
  return store.filter(
    p => p.description.toLowerCase().includes(q) ||
         p.recommendation.toLowerCase().includes(q) ||
         (p.affectedFiles?.some(f => f.toLowerCase().includes(q)) ?? false),
  );
}

export function totalPatterns(): number { return store.count(); }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shortName(path: string): string {
  return path.split("/").slice(-2).join("/");
}
