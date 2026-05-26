/**
 * lib/checkpointPreview.ts — Dry-run restore preview for checkpoints
 *
 * SAFE BY DESIGN:
 *   - No files are read, written, deleted, or checked out.
 *   - No `git checkout`, `git reset`, or `git restore` is ever called.
 *   - Analysis is metadata-only: file paths, extensions, git diff output.
 *   - Falls back gracefully when git is unavailable.
 *
 * Given a checkpoint, returns a RestorePreview describing:
 *   - filesAffected   — each file that would change on restore
 *   - estimatedRisk   — overall risk level (low | medium | high | critical)
 *   - dependencyImpact — whether package.json / lockfile would change
 *   - conflicts       — files modified since the checkpoint that would be overwritten
 *   - summary         — human-readable description
 */

import { execSync, spawnSync } from "child_process";
import path from "path";
import { existsSync, statSync } from "fs";
import { PROJECT_ROOT } from "./dev/tools";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FileRisk    = "low" | "medium" | "high" | "critical";
export type OverallRisk = "low" | "medium" | "high" | "critical";

export interface AffectedFile {
  path:       string;
  risk:       FileRisk;
  reason:     string;
  existsNow:  boolean;
  changeType: "modified" | "added" | "deleted" | "unknown";
}

export interface DependencyImpact {
  affected:  boolean;
  files:     string[];
  note:      string;
}

export interface ConflictEntry {
  path:         string;
  note:         string;
}

export interface RestorePreview {
  checkpointId:      string;
  commitHash?:       string;
  filesAffected:     AffectedFile[];
  estimatedRisk:     OverallRisk;
  dependencyImpact:  DependencyImpact;
  conflicts:         ConflictEntry[];
  summary:           string;
  warnings:          string[];
  generatedAt:       string;
}

// ─── File risk scoring ────────────────────────────────────────────────────────

interface RiskRule { pattern: RegExp; risk: FileRisk; reason: string }

const RISK_RULES: RiskRule[] = [
  { pattern: /pnpm-lock\.yaml|package-lock\.json|yarn\.lock/i,          risk: "critical", reason: "Lockfile change — all dependencies may shift."                     },
  { pattern: /^package\.json$/i,                                          risk: "critical", reason: "Root package.json — dependency set would change."                 },
  { pattern: /package\.json$/i,                                           risk: "high",     reason: "Workspace package.json — local deps may shift."                   },
  { pattern: /tsconfig.*\.json$/i,                                        risk: "high",     reason: "TypeScript config — compiler behaviour would change."             },
  { pattern: /vite\.config\.(ts|js|mjs)$/i,                              risk: "high",     reason: "Vite config — build pipeline would change."                       },
  { pattern: /\.env(\.\w+)?$/i,                                           risk: "high",     reason: "Environment file — secrets or config values would change."        },
  { pattern: /routes\/index\.ts$/i,                                       risk: "high",     reason: "Route registry — API surface would change."                       },
  { pattern: /\.(ts|tsx)$/i,                                              risk: "medium",   reason: "TypeScript source — logic or types would change."                 },
  { pattern: /\.(js|jsx|mjs|cjs)$/i,                                      risk: "medium",   reason: "JavaScript source — logic would change."                          },
  { pattern: /\.(css|scss|sass)$/i,                                       risk: "low",      reason: "Stylesheet — visual appearance would change."                     },
  { pattern: /\.(json)$/i,                                                 risk: "low",      reason: "JSON data file — config or data would change."                   },
  { pattern: /\.(md|txt|yaml|yml)$/i,                                     risk: "low",      reason: "Documentation or config — non-critical change."                   },
];

function riskForFile(filePath: string): { risk: FileRisk; reason: string } {
  const base = path.basename(filePath);
  for (const rule of RISK_RULES) {
    if (rule.pattern.test(base) || rule.pattern.test(filePath)) {
      return { risk: rule.risk, reason: rule.reason };
    }
  }
  return { risk: "low", reason: "File type not specifically categorised." };
}

const RISK_ORDER: Record<OverallRisk, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function escalate(a: OverallRisk, b: OverallRisk): OverallRisk {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

// ─── Git helpers ──────────────────────────────────────────────────────────────

function tryGit(args: string[]): string | undefined {
  try {
    const r = spawnSync("git", args, {
      cwd:     PROJECT_ROOT,
      timeout: 6000,
      encoding: "utf8",
    });
    if (r.status === 0) return (r.stdout as string).trim();
    return undefined;
  } catch { return undefined; }
}

/** Files that differ between the checkpoint commit and HEAD (metadata only) */
function diffedFiles(commitHash: string): string[] {
  const out = tryGit(["diff", "--name-only", `${commitHash}..HEAD`]);
  if (!out) return [];
  return out.split("\n").filter(Boolean);
}

/** Files with uncommitted changes right now */
function dirtyFiles(): string[] {
  const out = tryGit(["status", "--porcelain"]);
  if (!out) return [];
  return out.split("\n").map(l => l.slice(3).trim()).filter(Boolean);
}

function classifyChangeType(filePath: string, commitHash: string): "modified" | "added" | "deleted" | "unknown" {
  const status = tryGit(["diff", "--name-status", `${commitHash}..HEAD`, "--", filePath]);
  if (!status) return "unknown";
  const letter = status.charAt(0).toUpperCase();
  if (letter === "M") return "modified";
  if (letter === "A") return "added";
  if (letter === "D") return "deleted";
  return "unknown";
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export function runRestorePreview(checkpoint: {
  id:           string;
  commitHash?:  string;
  changedFiles: string[];
}): RestorePreview {
  const generatedAt = new Date().toISOString();
  const warnings:    string[] = [];

  // ── Files that would change on restore ────────────────────────────────────

  let fileSet: string[] = [];
  let resolvedViaGit = false;

  if (checkpoint.commitHash) {
    const gitFiles = diffedFiles(checkpoint.commitHash);
    if (gitFiles.length > 0) {
      fileSet = gitFiles;
      resolvedViaGit = true;
    } else {
      // Diff returned empty — either the repo is clean or the commit is HEAD
      fileSet = checkpoint.changedFiles;
      warnings.push("Git diff returned no changes from this checkpoint to HEAD. The workspace may already be at this commit.");
    }
  } else {
    fileSet = checkpoint.changedFiles;
    warnings.push("No commit hash recorded for this checkpoint — file list is based on the snapshot taken at creation time. Some entries may be stale.");
  }

  if (fileSet.length === 0) {
    warnings.push("No changed files detected — this checkpoint appears identical to the current HEAD.");
  }

  const filesAffected: AffectedFile[] = fileSet.map(f => {
    const abs = path.join(PROJECT_ROOT, f);
    const { risk, reason } = riskForFile(f);
    const existsNow  = existsSync(abs);
    const changeType = resolvedViaGit && checkpoint.commitHash
      ? classifyChangeType(f, checkpoint.commitHash)
      : "unknown";
    return { path: f, risk, reason, existsNow, changeType };
  });

  // ── Overall risk ──────────────────────────────────────────────────────────

  let estimatedRisk: OverallRisk = "low";
  for (const f of filesAffected) {
    estimatedRisk = escalate(estimatedRisk, f.risk as OverallRisk);
  }
  if (filesAffected.length > 20) {
    estimatedRisk = escalate(estimatedRisk, "high");
    warnings.push(`Large scope: ${filesAffected.length} files would change.`);
  }

  // ── Dependency impact ─────────────────────────────────────────────────────

  const DEP_PATTERNS = [/pnpm-lock/, /package-lock/, /yarn\.lock/, /package\.json/];
  const depFiles = fileSet.filter(f => DEP_PATTERNS.some(p => p.test(f)));
  const dependencyImpact: DependencyImpact = {
    affected: depFiles.length > 0,
    files:    depFiles,
    note: depFiles.length > 0
      ? `Restoring would alter ${depFiles.length} dependency file(s). Run \`pnpm install\` after restore to sync node_modules.`
      : "No dependency files (package.json / lockfile) in this checkpoint's diff.",
  };

  // ── Conflicts: dirty files that overlap with the restore set ─────────────

  const dirty = dirtyFiles();
  const conflicts: ConflictEntry[] = dirty
    .filter(f => fileSet.includes(f))
    .map(f => ({
      path: f,
      note: "This file has uncommitted local changes that would be overwritten by a restore.",
    }));

  if (dirty.length > 0 && conflicts.length === 0) {
    warnings.push(`You have ${dirty.length} uncommitted file(s), but none overlap with this checkpoint's diff.`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  const riskLabel = { low: "low", medium: "moderate", high: "elevated", critical: "critical" }[estimatedRisk];
  const summary = [
    `Restoring checkpoint would affect ${filesAffected.length} file(s) with ${riskLabel} overall risk.`,
    conflicts.length > 0 ? `${conflicts.length} conflict(s) detected — uncommitted local changes would be lost.` : "No local conflicts detected.",
    dependencyImpact.affected ? "Dependency files are in scope — a `pnpm install` will be needed after restore." : "",
  ].filter(Boolean).join(" ");

  return {
    checkpointId:     checkpoint.id,
    commitHash:       checkpoint.commitHash,
    filesAffected,
    estimatedRisk,
    dependencyImpact,
    conflicts,
    summary,
    warnings,
    generatedAt,
  };
}
