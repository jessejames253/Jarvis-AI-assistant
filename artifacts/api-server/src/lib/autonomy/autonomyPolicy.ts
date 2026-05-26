/**
 * lib/autonomy/autonomyPolicy.ts — Phase 6 autonomy safety policy.
 *
 * Hard gates that block the autonomy controller from touching protected files.
 * These rules CANNOT be overridden by memory evidence, confidence scores,
 * or any other factor — they are absolute safety boundaries.
 *
 * Protected categories:
 *   - Authentication / authorisation
 *   - Payment / billing systems
 *   - Database migrations
 *   - Environment / config files
 *   - Package / lock files
 *   - Secrets / keys / certificates
 *   - Deployment settings
 *   - Permission system source
 *   - Rollback / checkpoint infrastructure
 */

// ─── Blocked patterns ─────────────────────────────────────────────────────────

interface BlockRule {
  pattern: RegExp;
  reason:  string;
}

const BLOCKED_PATTERNS: BlockRule[] = [
  { pattern: /auth/i,                    reason: "Authentication files are protected" },
  { pattern: /payment|stripe|billing/i,  reason: "Payment files are protected" },
  { pattern: /migration/i,               reason: "Database migration files are protected" },
  { pattern: /\.env($|\.)/,             reason: "Environment files are protected" },
  { pattern: /package\.json/,           reason: "Package manifest is protected" },
  { pattern: /pnpm-lock/,               reason: "Lock files are protected" },
  { pattern: /secret/i,                 reason: "Secret files are protected" },
  { pattern: /deploy/i,                 reason: "Deployment files are protected" },
  { pattern: /permissions\.ts/,         reason: "Permission system files are protected" },
  { pattern: /rollback/i,               reason: "Rollback infrastructure is protected" },
  { pattern: /checkpoint/i,             reason: "Checkpoint infrastructure is protected" },
  { pattern: /\.key$/,                  reason: "Key files are protected" },
  { pattern: /\.pem$/,                  reason: "Certificate files are protected" },
  { pattern: /\.cert$/,                 reason: "Certificate files are protected" },
  { pattern: /replit\.nix|\.replit/,    reason: "Replit configuration is protected" },
];

/** Exact paths that are always blocked, regardless of pattern matching. */
const BLOCKED_EXACT: string[] = [
  "src/lib/agents/permissions.ts",
  "artifacts/api-server/src/lib/agents/permissions.ts",
  "lib/agents/permissions.ts",
  "src/lib/autonomy/autonomyPolicy.ts",
  "artifacts/api-server/src/lib/autonomy/autonomyPolicy.ts",
];

// ─── Public API ───────────────────────────────────────────────────────────────

export interface BlockResult {
  blocked: boolean;
  reason?: string;
}

export function isFileBlocked(filePath: string): BlockResult {
  const normalised = filePath.replace(/\\/g, "/");

  // Exact path check first
  for (const exact of BLOCKED_EXACT) {
    if (normalised.endsWith(exact) || normalised === exact) {
      return { blocked: true, reason: "This file is on the protected exact-path list" };
    }
  }

  // Pattern check
  for (const rule of BLOCKED_PATTERNS) {
    if (rule.pattern.test(normalised)) {
      return { blocked: true, reason: rule.reason };
    }
  }

  return { blocked: false };
}

export interface FilePolicyReport {
  allowed:  string[];
  blocked:  Array<{ file: string; reason: string }>;
  allSafe:  boolean;
}

/** Validate a set of files and return which are allowed / blocked. */
export function validateFiles(files: string[]): FilePolicyReport {
  const allowed: string[]                           = [];
  const blocked: Array<{ file: string; reason: string }> = [];

  for (const f of files) {
    const result = isFileBlocked(f);
    if (result.blocked) {
      blocked.push({ file: f, reason: result.reason ?? "Policy blocked" });
    } else {
      allowed.push(f);
    }
  }

  return { allowed, blocked, allSafe: blocked.length === 0 };
}

/**
 * Assert that a task description doesn't obviously reference blocked areas.
 * This is a heuristic check — file-level checks via validateFiles() are stricter.
 */
export function isTaskDescriptionSafe(description: string): BlockResult {
  const lower = description.toLowerCase();
  const riskyTerms: Array<{ term: string; reason: string }> = [
    { term: "permission",   reason: "Task mentions permissions system" },
    { term: "auth",         reason: "Task mentions authentication" },
    { term: "payment",      reason: "Task mentions payment system" },
    { term: "migration",    reason: "Task mentions database migration" },
    { term: "secret",       reason: "Task mentions secrets" },
    { term: "deploy",       reason: "Task mentions deployment" },
    { term: "rollback",     reason: "Task mentions rollback infrastructure" },
    { term: "checkpoint",   reason: "Task mentions checkpoint system" },
  ];

  for (const { term, reason } of riskyTerms) {
    if (lower.includes(term)) {
      return { blocked: true, reason };
    }
  }

  return { blocked: false };
}

export function listBlockedPatterns(): Array<{ pattern: string; reason: string }> {
  return BLOCKED_PATTERNS.map(r => ({ pattern: r.pattern.toString(), reason: r.reason }));
}

export function listBlockedExactPaths(): string[] {
  return [...BLOCKED_EXACT];
}
