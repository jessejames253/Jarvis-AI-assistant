/**
 * lib/dev/autoFix.ts — Phase 3C Controlled Auto-Fix Engine.
 *
 * Detects TypeScript/build errors from validation output, classifies them by
 * type and risk level, auto-applies only deterministic "safe" fixes, and queues
 * everything else as a pending patch proposal for human / Dev Agent review.
 *
 * SAFETY INVARIANTS (hard-coded, never configurable):
 *   1. Auto-apply ONLY when risk === "safe"
 *   2. Exactly one file changed per auto-fix attempt
 *   3. No file deletions (newContent must remain non-empty)
 *   4. No blocked files (auth/payment/db/config/migration patterns)
 *   5. Patch must change fewer than 40 lines
 *   6. TypeScript validation must pass after every auto-apply
 *   7. Checkpoint (snapshot) created before every write
 *   8. Maximum 2 auto-fix attempts per analysis run
 *   9. All results stored — nothing is hidden from the user
 */

import path from "path";
import fs from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";

import { PROJECT_ROOT, pendingPatches, type PendingPatch } from "./tools";
import { createSnapshot } from "./snapshotStore";

const execAsync = promisify(exec);

// ─── Public types ─────────────────────────────────────────────────────────────

export type IssueType =
  | "unused-import"
  | "missing-import"
  | "invalid-css-style"
  | "missing-type"
  | "wrong-export-name"
  | "endpoint-route-mismatch"
  | "syntax-typo"
  | "unknown";

export type FixRisk = "safe" | "review" | "risky" | "blocked";

export interface DetectedIssue {
  id: string;
  type: IssueType;
  file: string;
  line?: number;
  col?: number;
  errorCode?: number;
  errorText: string;
  risk: FixRisk;
  confidence: number; // 0–100
}

export interface AutoFixProposal {
  issueId: string;
  issue: DetectedIssue;
  description: string;
  file: string;
  /** Set when queued into the pending-patch store. */
  patchId?: string;
  testCommand: string;
  status: "auto-applied" | "queued" | "blocked" | "skipped" | "failed";
  validationPassed?: boolean;
  snapshotId?: string;
  reason?: string;
  confidence: number;
  appliedAt?: number;
}

export interface AutoFixResult {
  proposals: AutoFixProposal[];
  autoApplied: number;
  queued: number;
  blocked: number;
  attempts: number;
  finalValidationPassed?: boolean;
  ranAt: number;
}

// ─── In-memory last-result store ─────────────────────────────────────────────

let lastResult: AutoFixResult | null = null;

export function getLastAutoFixResult(): AutoFixResult | null {
  return lastResult;
}

// ─── Blocked file patterns ────────────────────────────────────────────────────

/** Substrings (case-insensitive) that make a file path off-limits for autofix. */
export const BLOCKED_FILE_PATTERNS = [
  "package.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
  ".env",
  "schema",
  "migration",
  "auth.",
  "/auth/",
  "database",
  "/db/",
  ".sql",
  "payment",
  "stripe",
  ".replit",
  ".git/",
  "node_modules/",
  "tsconfig.json",
  ".config.",
  "vite.config",
  "build.mjs",
  "drizzle",
];

export function isBlockedFile(filePath: string): boolean {
  const lc = filePath.toLowerCase();
  return BLOCKED_FILE_PATTERNS.some(p => lc.includes(p.toLowerCase()));
}

// ─── Classification ───────────────────────────────────────────────────────────

interface Classification {
  type: IssueType;
  risk: FixRisk;
  confidence: number;
}

/**
 * Classify a TypeScript error into a type, risk level, and confidence score.
 * Pure function — no I/O.
 */
export function classifyIssue(
  errorCode: number,
  errorText: string,
  file: string,
): Classification {
  if (isBlockedFile(file)) {
    return { type: "unknown", risk: "blocked", confidence: 100 };
  }

  // ── unused import / declared-but-never-read (TS6133, TS6196)
  if (errorCode === 6133 || errorCode === 6196) {
    return { type: "unused-import", risk: "safe", confidence: 92 };
  }

  // ── cannot find module (TS2307) → missing import
  if (errorCode === 2307) {
    return { type: "missing-import", risk: "review", confidence: 78 };
  }

  // ── object literal property not in type (TS2353) — common for invalid CSS props
  if (errorCode === 2353) {
    const hasCssContext = /style|CSSProperties/i.test(errorText);
    return {
      type: hasCssContext ? "invalid-css-style" : "missing-type",
      risk: hasCssContext ? "safe" : "review",
      confidence: hasCssContext ? 82 : 60,
    };
  }

  // ── cannot find name / namespace (TS2304, TS2694) → missing type or import
  if (errorCode === 2304 || errorCode === 2694) {
    return { type: "missing-type", risk: "review", confidence: 70 };
  }

  // ── module has no exported member (TS2614) → wrong export name
  if (errorCode === 2614) {
    return { type: "wrong-export-name", risk: "review", confidence: 73 };
  }

  // ── property does not exist on type (TS2339) → often wrong export/import name
  if (errorCode === 2339) {
    return { type: "wrong-export-name", risk: "review", confidence: 58 };
  }

  // ── type mismatch (TS2322, TS2345) → needs human judgment
  if (errorCode === 2322 || errorCode === 2345) {
    return { type: "missing-type", risk: "review", confidence: 55 };
  }

  // ── syntax errors (TS1005, TS1128, TS1109) — dangerous to auto-fix
  if ([1005, 1109, 1128, 1161].includes(errorCode)) {
    return { type: "syntax-typo", risk: "risky", confidence: 48 };
  }

  return { type: "unknown", risk: "blocked", confidence: 30 };
}

// ─── Fix generators (pure, no I/O) ───────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remove an unused import symbol from TypeScript file content.
 * Handles named destructured imports, default imports, and namespace imports.
 * Returns the new file content, or null if no safe change can be made.
 */
export function generateUnusedImportFix(
  content: string,
  symbolName: string,
): string | null {
  const lines = content.split("\n");

  // Find the import line containing this symbol
  const importLineIdx = lines.findIndex(line => {
    if (!/^\s*import[\s{*]/.test(line)) return false;
    return new RegExp(`\\b${escapeRegex(symbolName)}\\b`).test(line);
  });

  if (importLineIdx === -1) return null;

  const importLine = lines[importLineIdx];

  // Case A: named destructured  →  import { A, Symbol, B } from '...'
  const namedMatch = /import\s*\{([^}]+)\}\s*from/.exec(importLine);
  if (namedMatch) {
    const original = namedMatch[1];
    const names = original
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .filter(s => {
        // Handle "Symbol as Alias" — remove if either matches
        const [base, alias] = s.split(/\s+as\s+/).map(p => p.trim());
        return base !== symbolName && alias !== symbolName;
      });

    if (names.length === 0) {
      lines.splice(importLineIdx, 1);
    } else {
      lines[importLineIdx] = importLine.replace(original, ` ${names.join(", ")} `);
    }
    return lines.join("\n");
  }

  // Case B: default  →  import Symbol from '...'
  // Case C: namespace  →  import * as Symbol from '...'
  const singleMatch = /^\s*import\s+(?:\*\s+as\s+)?(\w+)\s+from/.exec(importLine);
  if (singleMatch && singleMatch[1] === symbolName) {
    lines.splice(importLineIdx, 1);
    return lines.join("\n");
  }

  // Case D: side-effect or re-export  →  import 'module' or export { X } from '...'
  // Don't touch these
  return null;
}

/**
 * Remove an invalid CSS property from a JSX `style={{...}}` expression at the given line.
 * Returns the new file content, or null if no safe change can be made.
 */
export function generateCssPropFix(
  content: string,
  propName: string,
  errorLine: number,
): string | null {
  const lines = content.split("\n");
  const idx = errorLine - 1;
  if (idx < 0 || idx >= lines.length) return null;

  const line = lines[idx];
  const propRegex = new RegExp(`\\b${escapeRegex(propName)}\\s*:\\s*[^,}\\n]+,?\\s*`);
  if (!propRegex.test(line)) return null;

  const fixed = line
    .replace(propRegex, "")
    .replace(/,\s*\}/, " }")
    .trimEnd();

  if (fixed === line) return null;

  if (!fixed.trim() || fixed.trim() === "{}") {
    lines.splice(idx, 1);
  } else {
    lines[idx] = fixed;
  }
  return lines.join("\n");
}

// ─── TSC error parser (pure) ──────────────────────────────────────────────────

export interface ParsedTscError {
  file: string;
  line: number;
  col: number;
  code: number;
  message: string;
}

/**
 * Parse TSC output into structured error objects.
 * Pure function — no I/O.
 */
export function parseTscErrors(output: string): ParsedTscError[] {
  const errorRegex = /^([^(\n]+)\((\d+),(\d+)\):\s+error TS(\d+):\s+(.+)$/gm;
  const results: ParsedTscError[] = [];
  let match: RegExpExecArray | null;
  while ((match = errorRegex.exec(output)) !== null) {
    const [, filePart, lineStr, colStr, codeStr, msg] = match;
    const file = filePart.trim();
    if (!file) continue;
    results.push({
      file,
      line: parseInt(lineStr, 10),
      col: parseInt(colStr, 10),
      code: parseInt(codeStr, 10),
      message: msg.trim(),
    });
  }
  return results;
}

// ─── Changed-line counter (pure) ──────────────────────────────────────────────

export function countChangedLines(oldContent: string, newContent: string): number {
  const o = oldContent.split("\n");
  const n = newContent.split("\n");
  let count = 0;
  const len = Math.max(o.length, n.length);
  for (let i = 0; i < len; i++) {
    if (o[i] !== n[i]) count++;
  }
  return count;
}

// ─── TSC runner ───────────────────────────────────────────────────────────────

async function runTsc(
  project: "jarvas" | "api-server",
): Promise<{ ok: boolean; output: string }> {
  const cmd = `cd "${PROJECT_ROOT}" && pnpm --filter @workspace/${project} exec tsc --noEmit 2>&1`;
  try {
    const { stdout } = await execAsync(cmd, { timeout: 40_000, shell: "/bin/bash" });
    return { ok: true, output: stdout };
  } catch (err: unknown) {
    return { ok: false, output: (err as { stdout?: string }).stdout ?? String(err) };
  }
}

// ─── Guarded apply pipeline ────────────────────────────────────────────────────

interface GuardedApplyResult {
  ok: boolean;
  snapshotId?: string;
  validationPassed?: boolean;
  error?: string;
}

async function applyGuardedFix(
  file: string,
  oldContent: string,
  newContent: string,
  project: "jarvas" | "api-server",
  patchId: string,
): Promise<GuardedApplyResult> {
  // Gate 1 — no deletions
  if (!newContent.trim()) {
    return { ok: false, error: "Safety: newContent is empty — file deletions are not allowed" };
  }

  // Gate 2 — line limit (≤ 40 changed lines)
  const changed = countChangedLines(oldContent, newContent);
  if (changed > 40) {
    return { ok: false, error: `Safety: patch changes ${changed} lines (max 40 for auto-fix)` };
  }

  // Gate 3 — blocked file check
  if (isBlockedFile(file)) {
    return { ok: false, error: `Safety: '${file}' matches a blocked-file pattern` };
  }

  // Gate 4 — create snapshot (required before any write)
  let snapshotId: string | undefined;
  try {
    const snap = await createSnapshot({ patchId, file, taskId: undefined });
    snapshotId = snap.id;
  } catch (err) {
    return { ok: false, error: `Cannot create snapshot: ${String(err)}` };
  }

  // Gate 5 — write new content
  const abs = path.resolve(PROJECT_ROOT, file);
  try {
    await fs.writeFile(abs, newContent, "utf8");
  } catch (err) {
    return { ok: false, snapshotId, error: `Write failed: ${String(err)}` };
  }

  // Gate 6 — validate (TypeScript must pass)
  const { ok: passed, output } = await runTsc(project);
  if (!passed) {
    // Immediate rollback
    await fs.writeFile(abs, oldContent, "utf8").catch(() => {});
    return {
      ok: false,
      snapshotId,
      validationPassed: false,
      error: `TS failed after auto-fix — rolled back. ${output.slice(0, 300)}`,
    };
  }

  return { ok: true, snapshotId, validationPassed: true };
}

// ─── Review patch creator ─────────────────────────────────────────────────────

/**
 * Queue a review-required issue into the pending-patch store.
 * Uses a top-of-file marker comment as the visible diff — safe to discard.
 */
async function createReviewPatch(
  err: ParsedTscError,
  project: "jarvas" | "api-server",
): Promise<string | null> {
  const abs = path.resolve(PROJECT_ROOT, err.file);
  let fileContent: string;
  try {
    fileContent = await fs.readFile(abs, "utf8");
  } catch {
    return null;
  }

  const markerKey = `AUTOFIX-REVIEW(TS${err.code} L${err.line})`;
  if (fileContent.includes(markerKey)) return null; // already queued

  // Insert a review-only block comment at the very top of the file.
  // This is a comment, not code — it will not introduce TS errors.
  const marker = [
    `/*`,
    ` * ${markerKey}: ${err.message.slice(0, 120)}`,
    ` * File: ${err.file}:${err.line}:${err.col}`,
    ` * Action needed: Fix this TypeScript error. Remove this comment once fixed.`,
    ` */`,
  ].join("\n");

  const newContent = `${marker}\n${fileContent}`;
  const patchId = `autofix-review-${randomUUID().slice(0, 8)}`;
  const testCommand = `pnpm --filter @workspace/${project} run typecheck`;

  const patch: PendingPatch = {
    patchId,
    file: err.file,
    description: `[AutoFix Review] TS${err.code}: ${err.message.slice(0, 100)} — Review and fix manually or ask Dev Agent`,
    oldContent: fileContent,
    newContent,
    createdAt: Date.now(),
    riskLevel: "medium",
    uiImpact: "unknown",
    logicImpact: "unknown",
    safeToTest: false,
    testCommand,
  };

  pendingPatches.set(patchId, patch);
  return patchId;
}

// ─── Main analysis entrypoint ─────────────────────────────────────────────────

/**
 * Run auto-fix analysis on validation output.
 *
 * Behaviour per risk level:
 *   safe    → generate deterministic fix → apply through guarded pipeline
 *   review  → queue as a pending-patch proposal for human / Dev Agent review
 *   risky   → report only (no patch, no apply)
 *   blocked → report only (file is in the protected list)
 *
 * Safety limits:
 *   - One auto-fix per file per attempt
 *   - Maximum `maxAttempts` (default 2) rounds
 *   - Fresh TSC run between rounds
 *
 * @param validationOutput  Raw TSC / build output from a failed check.
 * @param project           Which package triggered the failure.
 * @param maxAttempts       Hard cap on self-fix loops. Default: 2.
 */
export async function runAutoFixAnalysis(
  validationOutput: string,
  project: "jarvas" | "api-server",
  maxAttempts = 2,
): Promise<AutoFixResult> {
  const proposals: AutoFixProposal[] = [];
  let autoApplied = 0;
  let queued = 0;
  let blocked = 0;
  let attempts = 0;
  let currentOutput = validationOutput;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    attempts++;

    const errors = parseTscErrors(currentOutput);
    if (errors.length === 0) break;

    let appliedThisRound = 0;
    // One fix per file per round to prevent cascades
    const fixedFiles = new Set<string>();

    for (const err of errors) {
      const { type, risk, confidence } = classifyIssue(err.code, err.message, err.file);
      const testCommand = `pnpm --filter @workspace/${project} run typecheck`;

      const issue: DetectedIssue = {
        id: randomUUID(),
        type,
        file: err.file,
        line: err.line,
        col: err.col,
        errorCode: err.code,
        errorText: err.message,
        risk,
        confidence,
      };

      // ── Blocked ──────────────────────────────────────────────────────────────
      if (risk === "blocked") {
        proposals.push({
          issueId: issue.id,
          issue,
          description: `Blocked: '${err.file}' is in a protected file category`,
          file: err.file,
          testCommand,
          status: "blocked",
          reason: "File matches a blocked pattern (auth/payment/db/config/migration)",
          confidence,
        });
        blocked++;
        continue;
      }

      // ── Risky — report only, never auto-apply ─────────────────────────────
      if (risk === "risky") {
        proposals.push({
          issueId: issue.id,
          issue,
          description: `Risky issue (${type}) at ${err.file}:${err.line} — ask Dev Agent to fix`,
          file: err.file,
          testCommand,
          status: "skipped",
          reason: "Risk level is 'risky' — requires human review",
          confidence,
        });
        continue;
      }

      // ── Review — queue as pending patch ──────────────────────────────────────
      if (risk === "review") {
        const patchId = await createReviewPatch(err, project);
        if (patchId) {
          proposals.push({
            issueId: issue.id,
            issue,
            description: `Queued for review: TS${err.code} at ${err.file}:${err.line} — fix required`,
            file: err.file,
            patchId,
            testCommand,
            status: "queued",
            confidence,
          });
          queued++;
        } else {
          proposals.push({
            issueId: issue.id,
            issue,
            description: `TS${err.code} at ${err.file}:${err.line} — already queued or file unreadable`,
            file: err.file,
            testCommand,
            status: "skipped",
            reason: "Already queued or file not readable",
            confidence,
          });
        }
        continue;
      }

      // ── Safe — attempt deterministic auto-fix ────────────────────────────────
      if (fixedFiles.has(err.file)) {
        proposals.push({
          issueId: issue.id,
          issue,
          description: `Skipped: another auto-fix already applied to ${err.file} this round`,
          file: err.file,
          testCommand,
          status: "skipped",
          reason: "One auto-fix per file per attempt",
          confidence,
        });
        continue;
      }

      const abs = path.resolve(PROJECT_ROOT, err.file);
      let fileContent: string;
      try {
        fileContent = await fs.readFile(abs, "utf8");
      } catch (readErr) {
        proposals.push({
          issueId: issue.id,
          issue,
          description: `Cannot read ${err.file}`,
          file: err.file,
          testCommand,
          status: "failed",
          reason: String(readErr),
          confidence,
        });
        continue;
      }

      // Generate the patch
      let newContent: string | null = null;
      let description = "";

      if (type === "unused-import") {
        const symbolMatch = /'([^']+)'/.exec(err.message);
        const symbol = symbolMatch?.[1];
        if (symbol) {
          newContent = generateUnusedImportFix(fileContent, symbol);
          description = `Remove unused import '${symbol}' from ${err.file}:${err.line}`;
        }
      } else if (type === "invalid-css-style") {
        const propMatch = /'([^']+)'/.exec(err.message);
        const prop = propMatch?.[1];
        if (prop) {
          newContent = generateCssPropFix(fileContent, prop, err.line);
          description = `Remove invalid CSS style prop '${prop}' at ${err.file}:${err.line}`;
        }
      }

      if (!newContent || newContent === fileContent) {
        proposals.push({
          issueId: issue.id,
          issue,
          description: `No deterministic fix available for TS${err.code} in ${err.file}`,
          file: err.file,
          testCommand,
          status: "skipped",
          reason: "Could not generate a safe patch for this error pattern",
          confidence,
        });
        continue;
      }

      // Apply through the guarded pipeline
      const patchId = `autofix-safe-${randomUUID().slice(0, 8)}`;
      const applyResult = await applyGuardedFix(err.file, fileContent, newContent, project, patchId);

      if (applyResult.ok) {
        fixedFiles.add(err.file);
        appliedThisRound++;
        autoApplied++;
        proposals.push({
          issueId: issue.id,
          issue,
          description,
          file: err.file,
          testCommand,
          status: "auto-applied",
          validationPassed: applyResult.validationPassed,
          snapshotId: applyResult.snapshotId,
          confidence,
          appliedAt: Date.now(),
        });
      } else {
        proposals.push({
          issueId: issue.id,
          issue,
          description,
          file: err.file,
          testCommand,
          status: "failed",
          validationPassed: false,
          snapshotId: applyResult.snapshotId,
          reason: applyResult.error,
          confidence,
        });
      }
    }

    // Stop looping if nothing was applied this round
    if (appliedThisRound === 0) break;

    // Re-run TSC for fresh errors on next attempt
    if (attempt + 1 < maxAttempts) {
      const fresh = await runTsc(project);
      currentOutput = fresh.output;
    }
  }

  // Final validation state after all rounds
  let finalValidationPassed: boolean | undefined;
  if (autoApplied > 0) {
    const finalTsc = await runTsc(project);
    finalValidationPassed = finalTsc.ok;
  }

  const result: AutoFixResult = {
    proposals,
    autoApplied,
    queued,
    blocked,
    attempts,
    finalValidationPassed,
    ranAt: Date.now(),
  };

  lastResult = result;
  return result;
}
