/**
 * lib/autonomy/suggestions.ts — Storage + types for ImprovementSuggestion
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import path           from "path";
import { PROJECT_ROOT } from "../dev/tools";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AnalysisCategory =
  | "task_backlog"
  | "failed_execution"
  | "repeated_warnings"
  | "low_completion_agent"
  | "missing_validation"
  | "empty_data_store"
  | "route_without_panel"
  | "panel_without_actions";

export type SuggestionSeverity = "critical" | "high" | "medium" | "low";
export type SuggestionStatus   = "open" | "converted" | "dismissed";

export interface SuggestedWorkOrder {
  title:          string;
  objective:      string;
  inputs:         string[];
  expectedOutput: string;
  riskLevel:      "high" | "medium" | "low";
}

export interface ImprovementSuggestion {
  id:                   string;
  category:             AnalysisCategory;
  severity:             SuggestionSeverity;
  title:                string;
  reasoning:            string;
  estimatedImpact:      string;
  recommendedAgent:     string;
  suggestedWorkOrder:   SuggestedWorkOrder;
  autoExecutable:       boolean;
  detectedAt:           string;
  status:               SuggestionStatus;
  convertedWorkOrderId?: string;
}

export interface AnalysisRun {
  ranAt:       string;
  scanSummary: string;
  count:       number;
}

// ─── Storage paths ────────────────────────────────────────────────────────────

const AUTONOMY_DIR  = path.join(PROJECT_ROOT, ".jarvas-data", "autonomy");
const SUGGEST_FILE  = path.join(AUTONOMY_DIR, "suggestions.json");
const META_FILE     = path.join(AUTONOMY_DIR, "analysis-meta.json");

function ensureDir(): void {
  if (!existsSync(AUTONOMY_DIR)) mkdirSync(AUTONOMY_DIR, { recursive: true });
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function loadSuggestions(): ImprovementSuggestion[] {
  try { return JSON.parse(readFileSync(SUGGEST_FILE, "utf-8")) as ImprovementSuggestion[]; }
  catch { return []; }
}

export function saveSuggestions(suggestions: ImprovementSuggestion[]): void {
  ensureDir();
  writeFileSync(SUGGEST_FILE, JSON.stringify(suggestions, null, 2) + "\n", "utf-8");
}

export function loadAnalysisMeta(): AnalysisRun | null {
  try { return JSON.parse(readFileSync(META_FILE, "utf-8")) as AnalysisRun; }
  catch { return null; }
}

export function saveAnalysisMeta(meta: AnalysisRun): void {
  ensureDir();
  writeFileSync(META_FILE, JSON.stringify(meta, null, 2) + "\n", "utf-8");
}

/** Replace all open suggestions with freshly generated ones, preserve converted/dismissed. */
export function mergeSuggestions(fresh: Omit<ImprovementSuggestion, "id" | "detectedAt" | "status">[]): ImprovementSuggestion[] {
  const existing = loadSuggestions();
  const preserved = existing.filter(s => s.status !== "open");
  const stamped: ImprovementSuggestion[] = fresh.map(s => ({
    ...s,
    id:          randomUUID(),
    detectedAt:  new Date().toISOString(),
    status:      "open" as SuggestionStatus,
  }));
  const merged = [...stamped, ...preserved];
  saveSuggestions(merged);
  return merged;
}

export function updateSuggestion(
  id:     string,
  patch:  Partial<ImprovementSuggestion>,
): ImprovementSuggestion | null {
  const suggestions = loadSuggestions();
  const idx = suggestions.findIndex(s => s.id === id);
  if (idx === -1) return null;
  suggestions[idx] = { ...suggestions[idx], ...patch };
  saveSuggestions(suggestions);
  return suggestions[idx];
}
