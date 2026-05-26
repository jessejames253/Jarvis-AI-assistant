/**
 * lib/dev/improvements.ts — Persistent improvement registry (Phase 2A).
 *
 * Stores proposed code improvements at /tmp/jarvis_improvements.json.
 * Each improvement has a category, risk level, status, optional patch data,
 * and an autoFixable flag (true only when riskLevel === "low").
 *
 * No autonomous execution — all applies require human approval.
 */

import { readFileSync, writeFileSync } from "fs";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ImprovementCategory =
  | "formatting"
  | "unused-imports"
  | "type-annotations"
  | "lint"
  | "readonly-typing"
  | "null-checks"
  | "ui-text";

export type RiskLevel = "low" | "medium" | "high";

export type ImprovementStatus =
  | "proposed"     // created, awaiting human review
  | "approved"     // human approved, ready to apply
  | "applying"     // apply in progress
  | "applied"      // successfully applied + validated
  | "failed"       // apply failed, rolled back
  | "rejected";    // human rejected

/** Patch data required to apply an improvement */
export interface ImprovementPatch {
  file: string;
  /** Exact file content at scan time — used to verify no drift before write */
  oldContent: string;
  newContent: string;
}

export interface Improvement {
  id: string;
  title: string;
  description: string;
  category: ImprovementCategory;
  riskLevel: RiskLevel;
  status: ImprovementStatus;
  /** Source files this improvement touches */
  files: string[];
  /** true only when riskLevel === "low" and category is autofix-safe */
  autoFixable: boolean;
  patch?: ImprovementPatch;
  createdAt: number;
  updatedAt: number;
  appliedAt?: number;
  snapshotId?: string;
  failureReason?: string;
}

// ─── Persistent store ─────────────────────────────────────────────────────────

const STORE_FILE = "/tmp/jarvis_improvements.json";
let improvements: Improvement[] = [];

function load(): void {
  try {
    improvements = JSON.parse(readFileSync(STORE_FILE, "utf8")) as Improvement[];
  } catch { improvements = []; }
}

function save(): void {
  try {
    // Keep last 500 entries; prune old applied/rejected ones to stay tidy
    const trimmed = improvements.slice(-500);
    writeFileSync(STORE_FILE, JSON.stringify(trimmed, null, 2), "utf8");
    improvements = trimmed;
  } catch { /* non-fatal */ }
}

load();

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function getImprovements(): Improvement[] {
  return [...improvements];
}

export function getImprovement(id: string): Improvement | undefined {
  return improvements.find(i => i.id === id);
}

export function addImprovement(
  data: Omit<Improvement, "id" | "createdAt" | "updatedAt">,
): Improvement {
  // De-duplicate: same title + first file + non-terminal status → return existing
  const existing = improvements.find(
    i =>
      i.title === data.title &&
      i.files[0] === data.files[0] &&
      !["applied", "rejected", "failed"].includes(i.status),
  );
  if (existing) return existing;

  const improvement: Improvement = {
    ...data,
    id: `imp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  improvements.push(improvement);
  save();
  return improvement;
}

export function updateImprovement(
  id: string,
  updates: Partial<Improvement>,
): Improvement | null {
  const idx = improvements.findIndex(i => i.id === id);
  if (idx === -1) return null;
  improvements[idx] = { ...improvements[idx], ...updates, updatedAt: Date.now() };
  save();
  return improvements[idx];
}

export function removeImprovement(id: string): boolean {
  const before = improvements.length;
  improvements = improvements.filter(i => i.id !== id);
  if (improvements.length !== before) { save(); return true; }
  return false;
}

/** Remove improvements that are in terminal states (applied / rejected) */
export function pruneTerminal(): void {
  improvements = improvements.filter(
    i => !["applied", "rejected"].includes(i.status),
  );
  save();
}
