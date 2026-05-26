/**
 * lib/dev/autofix.ts — Controlled low-risk self-fix engine (Phase 2A).
 *
 * SAFETY INVARIANTS (hard-coded, never configurable):
 *   1. Snapshot required before any write
 *   2. Auto-apply ONLY if riskLevel === "low"
 *   3. No file deletions (newContent must be non-empty)
 *   4. No dependency changes (package.json, lock files)
 *   5. No schema / database / auth / env modifications
 *   6. Rollback immediately if tsc --noEmit or health check fails
 *   7. Full rollback log with snapshotId + failure reason
 *
 * Phase 2A: Human approval required — no autonomous execution.
 * The apply button in the UI triggers applyImprovement(); nothing runs on its own.
 */

import path from "path";
import fs from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import { readFileSync, writeFileSync } from "fs";

import { PROJECT_ROOT } from "./tools";
import { createSnapshot } from "./snapshotStore";
import { getHealth } from "./health";
import {
  type ImprovementCategory,
  addImprovement, updateImprovement, getImprovement,
  type Improvement,
} from "./improvements";

const execAsync = promisify(exec);

// ─── Safety block-lists ────────────────────────────────────────────────────────

/** Substrings that make a file path off-limits for autofix */
const BLOCKED_FILE_SUBSTRINGS = [
  "package.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
  ".env",
  "schema",
  "migration",
  "auth.",
  "Auth.",
  "database",
  "/db/",
  ".sql",
  ".replit",
  ".git/",
  "node_modules/",
];

/** Only these categories may be applied via autofix */
const SAFE_CATEGORIES: ImprovementCategory[] = [
  "formatting",
  "unused-imports",
  "type-annotations",
  "lint",
  "readonly-typing",
  "null-checks",
  "ui-text",
];

function isFileAllowed(filePath: string): boolean {
  const lc = filePath.toLowerCase();
  return !BLOCKED_FILE_SUBSTRINGS.some(pat => lc.includes(pat));
}

function isCategoryAllowed(category: ImprovementCategory): boolean {
  return SAFE_CATEGORIES.includes(category);
}

// ─── History store ────────────────────────────────────────────────────────────

const HISTORY_FILE = "/tmp/jarvis_autofix_history.json";

export interface AutofixHistoryEntry {
  id: string;
  improvementId: string;
  improvementTitle: string;
  file: string;
  category: ImprovementCategory;
  riskLevel: "low";
  appliedAt: number;
  snapshotId: string;
  validationPassed: boolean;
  rolledBack: boolean;
  rollbackReason?: string;
  healthScoreBefore: number;
  healthScoreAfter: number;
}

let history: AutofixHistoryEntry[] = [];

function loadHistory(): void {
  try {
    history = JSON.parse(readFileSync(HISTORY_FILE, "utf8")) as AutofixHistoryEntry[];
  } catch { history = []; }
}

function saveHistory(): void {
  try {
    const trimmed = history.slice(-500);
    writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2), "utf8");
    history = trimmed;
  } catch { /* non-fatal */ }
}

loadHistory();

export function getAutofixHistory(): AutofixHistoryEntry[] {
  return [...history];
}

// ─── TypeScript validation ────────────────────────────────────────────────────

async function runTscCheck(
  filter: string,
): Promise<{ ok: boolean; errorCount: number }> {
  const cmd = `cd "${PROJECT_ROOT}" && pnpm --filter ${filter} exec tsc --noEmit 2>&1`;
  try {
    await execAsync(cmd, { timeout: 35_000, shell: "/bin/bash" });
    return { ok: true, errorCount: 0 };
  } catch (err: unknown) {
    const raw = (err as { stdout?: string }).stdout ?? String(err);
    const errorCount = (raw.match(/error TS/g) ?? []).length;
    return { ok: false, errorCount };
  }
}

// ─── Error classification ─────────────────────────────────────────────────────

interface Classification {
  category: ImprovementCategory;
  title: string;
  description: string;
}

function classifyTsError(code: number, message: string): Classification | null {
  // Unused local / imported variable (TS6133, TS6196)
  if (code === 6133 || code === 6196) {
    const m = /'([^']+)'/.exec(message);
    const name = m?.[1] ?? "symbol";
    return {
      category: "unused-imports",
      title: `Remove unused: '${name}'`,
      description: `'${name}' is declared but its value is never read. Safe to remove the declaration or import.`,
    };
  }
  // Missing return type (TS7010)
  if (code === 7010) {
    return {
      category: "type-annotations",
      title: "Add missing return type annotation",
      description: "Function is missing an explicit return type. Adding one improves type safety and editor support.",
    };
  }
  // Implicit any — parameter (TS7006, TS7031)
  if (code === 7006 || code === 7031) {
    const m = /Parameter '([^']+)'/.exec(message);
    const param = m?.[1] ?? "parameter";
    return {
      category: "type-annotations",
      title: `Add type for parameter '${param}'`,
      description: `Parameter '${param}' implicitly has an 'any' type. Adding an explicit type annotation improves safety.`,
    };
  }
  // Possibly null / undefined (TS2531, TS2532, TS18047, TS18048)
  if ([2531, 2532, 18047, 18048].includes(code)) {
    return {
      category: "null-checks",
      title: "Add null-safety check",
      description: "Object is possibly null or undefined. Adding a null check prevents a potential runtime error.",
    };
  }
  // Readonly violation (TS2540)
  if (code === 2540) {
    return {
      category: "readonly-typing",
      title: "Fix readonly property assignment",
      description: "Assignment to a readonly property. Fix by using the correct state-update or copy pattern.",
    };
  }
  return null;
}

// ─── Scan ─────────────────────────────────────────────────────────────────────

interface ParsedError {
  file: string;
  line: number;
  col: number;
  code: number;
  message: string;
}

async function parseTscOutput(
  filter: string,
): Promise<ParsedError[]> {
  const cmd = `cd "${PROJECT_ROOT}" && pnpm --filter ${filter} exec tsc --noEmit 2>&1`;
  let raw = "";
  try {
    await execAsync(cmd, { timeout: 35_000, shell: "/bin/bash" });
    return [];
  } catch (err: unknown) {
    raw = (err as { stdout?: string }).stdout ?? String(err);
  }
  if (!raw.trim()) return [];

  const errorRegex = /^([^(\n]+)\((\d+),(\d+)\):\s+error TS(\d+):\s+(.+)$/gm;
  const results: ParsedError[] = [];
  let match: RegExpExecArray | null;
  while ((match = errorRegex.exec(raw)) !== null) {
    const [, filePart, lineStr, colStr, codeStr, msg] = match;
    const file = filePart.trim();
    if (!file || !isFileAllowed(file)) continue;
    results.push({
      file,
      line: parseInt(lineStr, 10),
      col: parseInt(colStr, 10),
      code: parseInt(codeStr, 10),
      message: msg,
    });
  }
  return results;
}

/**
 * Scan both packages for low-risk TypeScript errors and add them to the
 * improvement store. Returns newly created improvements (duplicates skipped).
 */
export async function scanForImprovements(): Promise<Improvement[]> {
  const packages = [
    { filter: "@workspace/jarvas" },
    { filter: "@workspace/api-server" },
  ];

  const created: Improvement[] = [];

  for (const { filter } of packages) {
    const errors = await parseTscOutput(filter);
    const seenFiles = new Map<string, number>(); // file → count

    for (const err of errors) {
      // Cap improvements per file to avoid noise from heavily broken files
      const count = seenFiles.get(err.file) ?? 0;
      if (count >= 4) continue;
      seenFiles.set(err.file, count + 1);

      const classification = classifyTsError(err.code, err.message);
      if (!classification) continue;

      const { category, title, description } = classification;

      // Verify the file exists and is readable
      const abs = path.resolve(PROJECT_ROOT, err.file);
      try { await fs.access(abs); } catch { continue; }

      const imp = addImprovement({
        title,
        description: `${description}\n\nLocation: \`${err.file}:${err.line}:${err.col}\`\nTS${err.code}: ${err.message}`,
        category,
        riskLevel: "low",
        status: "proposed",
        files: [err.file],
        autoFixable: true,
        // No patch data yet — patch must be authored separately before apply
      });

      if (!created.find(c => c.id === imp.id)) {
        created.push(imp);
      }
    }
  }

  return created;
}

// ─── Apply pipeline ────────────────────────────────────────────────────────────

export interface ApplyResult {
  ok: boolean;
  rolledBack?: boolean;
  snapshotId?: string;
  healthBefore?: number;
  healthAfter?: number;
  error?: string;
}

/**
 * Apply an improvement through the guarded pipeline.
 *
 * Pipeline: safety checks → snapshot → write patch → tsc × 2 → health check
 *           → commit to history  OR  rollback + log failure
 *
 * The improvement must have status "proposed" or "approved" AND a patch object.
 * Human must trigger this explicitly via the API — never called autonomously.
 */
export async function applyImprovement(id: string): Promise<ApplyResult> {
  const imp = getImprovement(id);
  if (!imp) return { ok: false, error: `Improvement ${id} not found` };

  // ── Safety gate 1: terminal states
  if (imp.status === "applied") return { ok: false, error: "Already applied" };
  if (imp.status === "rejected") return { ok: false, error: "Rejected — cannot apply" };
  if (imp.status === "applying") return { ok: false, error: "Already in progress" };

  // ── Safety gate 2: riskLevel must be "low" — hard guard, no override
  if (imp.riskLevel !== "low") {
    return {
      ok: false,
      error: `Safety block: riskLevel is '${imp.riskLevel}'. Only 'low' risk improvements can be applied via autofix.`,
    };
  }

  // ── Safety gate 3: category must be in the safe allow-list
  if (!isCategoryAllowed(imp.category)) {
    return {
      ok: false,
      error: `Safety block: category '${imp.category}' is not in the allowed autofix category list.`,
    };
  }

  // ── Safety gate 4: patch data must exist
  if (!imp.patch) {
    return {
      ok: false,
      error: "No patch data attached to this improvement. Cannot apply without a concrete patch.",
    };
  }

  const { file, oldContent, newContent } = imp.patch;

  // ── Safety gate 5: file must not be in blocked list
  if (!isFileAllowed(file)) {
    return {
      ok: false,
      error: `Safety block: '${file}' matches a blocked file pattern (deps, auth, schema, env).`,
    };
  }

  // ── Safety gate 6: no file deletions (content must remain non-trivially non-empty)
  if (!newContent.trim()) {
    return {
      ok: false,
      error: "Safety block: resulting content is empty — file deletions are not allowed.",
    };
  }

  // ── Mark as applying
  updateImprovement(id, { status: "applying" });

  // ── Capture health score before
  let scoreBefore = 100;
  try {
    const hBefore = await getHealth(true);
    scoreBefore = hBefore.score;
  } catch { /* use default */ }

  // ── Snapshot (required before any write)
  const snap = await createSnapshot({ patchId: id, file, taskId: undefined });
  const snapshotId = snap.id;

  // ── Read current content and verify no drift
  const abs = path.resolve(PROJECT_ROOT, file);
  let currentContent: string;
  try {
    currentContent = await fs.readFile(abs, "utf8");
  } catch (err) {
    updateImprovement(id, {
      status: "failed",
      failureReason: `Cannot read file before apply: ${String(err)}`,
    });
    return { ok: false, snapshotId, error: `Cannot read file: ${String(err)}` };
  }

  if (currentContent !== oldContent) {
    updateImprovement(id, {
      status: "failed",
      failureReason: "File has changed since improvement was scanned — patch no longer applies cleanly.",
    });
    return {
      ok: false,
      snapshotId,
      error: "File changed since scan. Re-scan to get a fresh improvement.",
    };
  }

  // ── Write patch
  try {
    await fs.writeFile(abs, newContent, "utf8");
  } catch (err) {
    updateImprovement(id, { status: "failed", failureReason: `Write failed: ${String(err)}` });
    return { ok: false, snapshotId, error: `Write failed: ${String(err)}` };
  }

  // ── TypeScript validation (both packages)
  const [feTsc, beTsc] = await Promise.all([
    runTscCheck("@workspace/jarvas"),
    runTscCheck("@workspace/api-server"),
  ]);

  if (!feTsc.ok || !beTsc.ok) {
    // Rollback immediately
    await fs.writeFile(abs, currentContent, "utf8").catch(() => {});
    const reason = `TypeScript validation failed — frontend errors: ${feTsc.errorCount}, backend errors: ${beTsc.errorCount}`;
    updateImprovement(id, { status: "failed", failureReason: reason });

    const entry: AutofixHistoryEntry = {
      id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      improvementId: id,
      improvementTitle: imp.title,
      file,
      category: imp.category,
      riskLevel: "low",
      appliedAt: Date.now(),
      snapshotId,
      validationPassed: false,
      rolledBack: true,
      rollbackReason: reason,
      healthScoreBefore: scoreBefore,
      healthScoreAfter: scoreBefore,
    };
    history.push(entry);
    saveHistory();

    return { ok: false, rolledBack: true, snapshotId, error: reason, healthBefore: scoreBefore, healthAfter: scoreBefore };
  }

  // ── Health check after
  let scoreAfter = scoreBefore;
  try {
    const hAfter = await getHealth(true);
    scoreAfter = hAfter.score;
  } catch { /* use scoreBefore */ }

  // Rollback if health dropped significantly (> 10 points)
  if (scoreAfter < scoreBefore - 10) {
    await fs.writeFile(abs, currentContent, "utf8").catch(() => {});
    const reason = `Health score dropped from ${scoreBefore} to ${scoreAfter} — rolled back`;
    updateImprovement(id, { status: "failed", failureReason: reason });

    const entry: AutofixHistoryEntry = {
      id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      improvementId: id,
      improvementTitle: imp.title,
      file,
      category: imp.category,
      riskLevel: "low",
      appliedAt: Date.now(),
      snapshotId,
      validationPassed: false,
      rolledBack: true,
      rollbackReason: reason,
      healthScoreBefore: scoreBefore,
      healthScoreAfter: scoreAfter,
    };
    history.push(entry);
    saveHistory();

    return { ok: false, rolledBack: true, snapshotId, error: reason, healthBefore: scoreBefore, healthAfter: scoreAfter };
  }

  // ── Success — commit to history
  updateImprovement(id, { status: "applied", appliedAt: Date.now(), snapshotId });

  const entry: AutofixHistoryEntry = {
    id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    improvementId: id,
    improvementTitle: imp.title,
    file,
    category: imp.category,
    riskLevel: "low",
    appliedAt: Date.now(),
    snapshotId,
    validationPassed: true,
    rolledBack: false,
    healthScoreBefore: scoreBefore,
    healthScoreAfter: scoreAfter,
  };
  history.push(entry);
  saveHistory();

  return { ok: true, snapshotId, healthBefore: scoreBefore, healthAfter: scoreAfter };
}
