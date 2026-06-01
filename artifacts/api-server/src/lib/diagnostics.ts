/**
 * lib/diagnostics.ts — Read-only self-healing build checker
 *
 * Scans the project for common failure patterns and returns structured
 * diagnostic issues with likely causes and suggested fixes.
 *
 * SAFETY CONTRACT:
 *   ✓ All checks are read-only — no files are written, no configs changed.
 *   ✓ No destructive shell commands. Read-only child_process calls only
 *     (pnpm --version, tsc --noEmit, node --version).
 *   ✓ All child_process calls have hard timeouts to avoid hanging the server.
 *   ✓ Every check is wrapped in try/catch — a failing check produces a
 *     "warning/unknown" result rather than crashing the whole report.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { execSync }  from "child_process";
import path          from "path";
import { PROJECT_ROOT } from "./dev/tools";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Confidence  = "high" | "medium" | "low";
export type Severity    = "error" | "warning" | "info";
export type CheckResult = "pass" | "fail" | "warn" | "skip";

export type IssueType =
  | "lockfile_mismatch"
  | "missing_env_var"
  | "build_artifact_missing"
  | "start_command_missing"
  | "port_binding_issue"
  | "typescript_errors"
  | "node_modules_missing"
  | "log_errors_detected";

export interface DiagnosticIssue {
  type:         IssueType;
  severity:     Severity;
  likelyCause:  string;
  suggestedFix: string;
  confidence:   Confidence;
  detail?:      string;
}

export interface DiagnosticsReport {
  ok:         boolean;
  checkedAt:  string;
  issueCount: number;
  errorCount: number;
  warnCount:  number;
  issues:     DiagnosticIssue[];
  checks:     Record<string, CheckResult>;
  runtimeInfo: {
    nodeVersion: string;
    pnpmVersion: string;
    platform:    string;
    arch:        string;
    uptimeSeconds: number;
  };
  /** Low-level path/env data to help debug false-positive checks. */
  debugInfo: {
    projectRoot:      string;
    cwd:              string;
    nodeEnv:          string;
    isProductionLike: boolean;
    isDevServer:      boolean;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeExec(cmd: string, timeoutMs = 8_000): string | null {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      timeout:  timeoutMs,
      stdio:    ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function safeReadJson<T>(filePath: string): T | null {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function safeReadText(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

// ─── Environment detection ────────────────────────────────────────────────────

/**
 * Returns true when running in any production-like container.
 * Covers: Replit Deployments, Coolify, Railway, Render, Fly.io, generic
 * NODE_ENV=production, or any bundled deployment where the monorepo source
 * tree is absent (the most reliable signal that deps were bundled, not installed).
 */
function isProductionLike(): boolean {
  // Explicit env-var signals first
  if (
    process.env["NODE_ENV"] === "production"      ||
    process.env["REPLIT_DEPLOYMENT"] === "1"      ||
    process.env["COOLIFY_CONTAINER_NAME"] != null ||
    process.env["COOLIFY_APP_ID"]         != null ||
    process.env["RAILWAY_ENVIRONMENT"]    != null ||
    process.env["RAILWAY_SERVICE_ID"]     != null ||
    process.env["RENDER_SERVICE_ID"]      != null ||
    process.env["FLY_APP_NAME"]           != null ||
    process.env["NIXPACKS_BUILD_CMD"]     != null ||
    process.env["DOKKU_APP_NAME"]         != null
  ) return true;

  // Structural signal: if the monorepo source tree is absent we're running as
  // a compiled bundle.  In dev the src directory always exists next to dist/.
  if (!existsSync(path.join(PROJECT_ROOT, "artifacts", "jarvas", "src"))) return true;
  if (!existsSync(path.join(PROJECT_ROOT, "pnpm-lock.yaml")))             return true;

  return false;
}

/**
 * Returns true when the process is running as a dev server via tsx or ts-node.
 * In this mode TypeScript source files run directly — no compiled dist/ bundle
 * exists and none is needed.  Checking for it would produce a false failure.
 *
 * Detection hierarchy (most-reliable first):
 *   1. NODE_ENV=development (explicit)
 *   2. __filename ends with .ts  (tsx/ts-node sets __filename to the source path)
 *   3. process.argv[1] contains tsx or ts-node markers
 */
function isDevServer(): boolean {
  if (process.env["NODE_ENV"] === "development") return true;
  // tsx sets __filename to the .ts source file path
  if (__filename.endsWith(".ts")) return true;
  const argv1 = process.argv[1] ?? "";
  return (
    argv1.includes("/tsx") ||
    argv1.includes("tsx/dist/") ||
    argv1.includes("/ts-node") ||
    argv1.includes("ts-node/dist/") ||
    argv1.endsWith(".ts")
  );
}

// ─── Individual checks ────────────────────────────────────────────────────────

/** 1. pnpm lockfile version compatibility check */
function checkLockfile(): { result: CheckResult; issue?: DiagnosticIssue } {
  // In a deployed/production container the lockfile is not present (deps are bundled)
  if (isProductionLike()) return { result: "skip" };

  const lockPath = path.join(PROJECT_ROOT, "pnpm-lock.yaml");

  if (!existsSync(lockPath)) {
    return {
      result: "fail",
      issue: {
        type:         "lockfile_mismatch",
        severity:     "error",
        likelyCause:  "pnpm-lock.yaml is missing from the project root.",
        suggestedFix: "Run `pnpm install` from the project root to regenerate the lockfile.",
        confidence:   "high",
        detail:       `Expected: ${lockPath}`,
      },
    };
  }

  // Read the lockfileVersion field from the YAML (simple regex — no YAML parser needed)
  const raw = safeReadText(lockPath) ?? "";
  const versionMatch = raw.match(/^lockfileVersion:\s*['"]?(\d+(?:\.\d+)?)['"]?/m);
  const lockfileVersion = versionMatch ? versionMatch[1] : null;

  const pnpmVersionRaw = safeExec("pnpm --version");
  const pnpmMajor      = pnpmVersionRaw ? parseInt(pnpmVersionRaw.split(".")[0]!, 10) : null;

  // pnpm v9+ uses lockfileVersion '9.0'; v8 uses '6.0'; v7 uses '5.4'
  // Flag as a mismatch only if the lockfile version is clearly from a much older pnpm
  const lockMajor = lockfileVersion ? parseFloat(lockfileVersion) : null;

  if (pnpmMajor !== null && lockMajor !== null) {
    // pnpm 9/10 → lockfileVersion 9.x  |  pnpm 8 → 6.x  |  pnpm 7 → 5.x
    const expectedLockMajor = pnpmMajor >= 9 ? 9 : pnpmMajor >= 8 ? 6 : 5;
    if (Math.floor(lockMajor) < expectedLockMajor) {
      return {
        result: "warn",
        issue: {
          type:         "lockfile_mismatch",
          severity:     "warning",
          likelyCause:  `lockfileVersion ${lockfileVersion} was generated by an older pnpm. Current pnpm is v${pnpmVersionRaw}.`,
          suggestedFix: "Run `pnpm install` to regenerate the lockfile with the current pnpm version.",
          confidence:   "medium",
          detail:       `lockfileVersion: ${lockfileVersion} | pnpm: ${pnpmVersionRaw}`,
        },
      };
    }
  }

  return { result: "pass" };
}

/** 2. Required environment variables */
const REQUIRED_ENV_VARS: Array<{ name: string; description: string; severity: Severity }> = [
  { name: "PORT",                                severity: "error",   description: "TCP port the API server binds to" },
  { name: "AI_INTEGRATIONS_ANTHROPIC_API_KEY",  severity: "error",   description: "Anthropic API key for Claude (all AI reasoning)" },
  { name: "AI_INTEGRATIONS_ANTHROPIC_BASE_URL", severity: "warning", description: "Anthropic API base URL (defaults to https://api.anthropic.com)" },
  { name: "DATABASE_URL",                        severity: "warning", description: "PostgreSQL connection string (required for conversations/memory)" },
  { name: "NODE_ENV",                            severity: "warning", description: "Runtime environment (development|production)" },
];

function checkEnvVars(): Array<{ result: CheckResult; issue?: DiagnosticIssue }> {
  return REQUIRED_ENV_VARS.map(({ name, description, severity }) => {
    const val = process.env[name];
    if (!val || !val.trim()) {
      return {
        result: severity === "error" ? "fail" : "warn" as CheckResult,
        issue: {
          type:         "missing_env_var" as IssueType,
          severity,
          likelyCause:  `Environment variable ${name} is not set. It provides: ${description}.`,
          suggestedFix: `Set ${name} in your .env file or hosting environment, then restart the server.`,
          confidence:   "high" as Confidence,
          detail:       `Variable: ${name}`,
        },
      };
    }
    return { result: "pass" as CheckResult };
  });
}

/** 3. Build artifact presence */
function checkBuildArtifact(): { result: CheckResult; issue?: DiagnosticIssue } {
  // In production the server IS the compiled artifact already running
  if (isProductionLike()) return { result: "pass" };
  // In dev (tsx/ts-node), source files run directly — no dist/ bundle is expected
  if (isDevServer()) return { result: "skip" };

  const distEntry = path.join(PROJECT_ROOT, "artifacts", "api-server", "dist", "index.mjs");

  if (!existsSync(distEntry)) {
    return {
      result: "fail",
      issue: {
        type:         "build_artifact_missing",
        severity:     "error",
        likelyCause:  "The compiled API server bundle (dist/index.mjs) does not exist. The build step has not been run or failed.",
        suggestedFix: "Run `pnpm --filter @workspace/api-server run build` from the project root.",
        confidence:   "high",
        detail:       `Expected: ${distEntry}`,
      },
    };
  }

  // Check if the artifact is stale (older than source files is a soft warning)
  try {
    const distMtime = statSync(distEntry).mtimeMs;
    const srcDir    = path.join(PROJECT_ROOT, "artifacts", "api-server", "src");
    const srcFiles  = readdirSync(srcDir, { recursive: true }) as string[];
    const staleSrc  = srcFiles
      .filter(f => f.endsWith(".ts"))
      .some(f => {
        try {
          return statSync(path.join(srcDir, f)).mtimeMs > distMtime;
        } catch { return false; }
      });

    if (staleSrc) {
      return {
        result: "warn",
        issue: {
          type:         "build_artifact_missing",
          severity:     "warning",
          likelyCause:  "Source files have been modified since the last build. The running server may be out of date.",
          suggestedFix: "Run `pnpm --filter @workspace/api-server run build` and restart the server.",
          confidence:   "medium",
          detail:       `Artifact: ${distEntry} | Source dir has newer .ts files`,
        },
      };
    }
  } catch {
    // Stale check is best-effort; skip on error
  }

  return { result: "pass" };
}

/** 4. Start command present in package.json */
function checkStartCommand(): { result: CheckResult; issue?: DiagnosticIssue } {
  const pkgPath = path.join(PROJECT_ROOT, "artifacts", "api-server", "package.json");
  const pkg     = safeReadJson<{ scripts?: Record<string, string> }>(pkgPath);

  if (!pkg) {
    return {
      result: "skip",
      issue: {
        type:         "start_command_missing",
        severity:     "warning",
        likelyCause:  "Could not read artifacts/api-server/package.json.",
        suggestedFix: "Ensure package.json exists and is valid JSON.",
        confidence:   "low",
      },
    };
  }

  if (!pkg.scripts?.["start"]) {
    return {
      result: "fail",
      issue: {
        type:         "start_command_missing",
        severity:     "error",
        likelyCause:  'No "start" script found in artifacts/api-server/package.json.',
        suggestedFix: 'Add `"start": "node --enable-source-maps ./dist/index.mjs"` to the scripts section.',
        confidence:   "high",
        detail:       `Available scripts: ${Object.keys(pkg.scripts ?? {}).join(", ") || "(none)"}`,
      },
    };
  }

  return { result: "pass" };
}

/** 5. Port binding sanity */
function checkPortBinding(): { result: CheckResult; issue?: DiagnosticIssue } {
  const raw = process.env["PORT"];

  if (!raw) {
    // Already caught by env var check — avoid duplicate report
    return { result: "skip" };
  }

  const port = Number(raw);

  if (Number.isNaN(port) || port <= 0 || port > 65535) {
    return {
      result: "fail",
      issue: {
        type:         "port_binding_issue",
        severity:     "error",
        likelyCause:  `PORT="${raw}" is not a valid TCP port number (must be 1–65535).`,
        suggestedFix: "Set PORT to a valid integer, e.g. PORT=8080.",
        confidence:   "high",
        detail:       `PORT=${raw}`,
      },
    };
  }

  if (port < 1024) {
    return {
      result: "warn",
      issue: {
        type:         "port_binding_issue",
        severity:     "warning",
        likelyCause:  `PORT=${port} is a privileged port (< 1024). Binding requires root on most Linux hosts.`,
        suggestedFix: "Use a port ≥ 1024 (e.g. 8080) and terminate TLS upstream with nginx or a load balancer.",
        confidence:   "medium",
        detail:       `PORT=${port}`,
      },
    };
  }

  return { result: "pass" };
}

/** 6. node_modules presence */
function checkNodeModules(): { result: CheckResult; issue?: DiagnosticIssue } {
  // In production containers deps are already installed into the bundle; skip
  if (isProductionLike()) return { result: "skip" };

  const nm = path.join(PROJECT_ROOT, "node_modules");

  if (!existsSync(nm)) {
    return {
      result: "fail",
      issue: {
        type:         "node_modules_missing",
        severity:     "error",
        likelyCause:  "node_modules directory is missing. Dependencies have not been installed.",
        suggestedFix: "Run `pnpm install` from the project root.",
        confidence:   "high",
        detail:       `Expected: ${nm}`,
      },
    };
  }

  // Spot-check 'express'. In a pnpm workspace it may live in either the
  // artifact's own node_modules OR in the hoisted workspace root.
  const criticalPkg     = path.join(PROJECT_ROOT, "artifacts", "api-server", "node_modules", "express");
  const rootCriticalPkg = path.join(PROJECT_ROOT, "node_modules", "express");
  if (!existsSync(criticalPkg) && !existsSync(rootCriticalPkg)) {
    return {
      result: "warn",
      issue: {
        type:         "node_modules_missing",
        severity:     "warning",
        likelyCause:  "Critical package 'express' is missing from both artifacts/api-server/node_modules and the workspace root node_modules.",
        suggestedFix: "Run `pnpm install` from the project root to complete dependency installation.",
        confidence:   "medium",
        detail:       `Checked: ${criticalPkg} and ${rootCriticalPkg}`,
      },
    };
  }

  return { result: "pass" };
}

/** 7. Scan log files in .jarvas-data/logs/ for error keywords */
const LOG_ERROR_PATTERNS: Array<{ regex: RegExp; type: IssueType; cause: string; fix: string }> = [
  {
    regex:  /ERR_MODULE_NOT_FOUND|Cannot find module/i,
    type:   "node_modules_missing",
    cause:  "A required Node.js module was not found at runtime.",
    fix:    "Run `pnpm install` from the project root. If the error persists, check the import path.",
  },
  {
    regex:  /lockfileVersion|frozen-lockfile|outdated lockfile/i,
    type:   "lockfile_mismatch",
    cause:  "The pnpm lockfile is outdated or incompatible with the current pnpm version.",
    fix:    "Run `pnpm install` (without --frozen-lockfile) to update it.",
  },
  {
    regex:  /EADDRINUSE|address already in use/i,
    type:   "port_binding_issue",
    cause:  "The target port is already in use by another process.",
    fix:    "Change the PORT env var or stop the conflicting process (`lsof -i :PORT`).",
  },
  {
    regex:  /build failed|tsc.*error|TypeScript.*error/i,
    type:   "typescript_errors",
    cause:  "The TypeScript build step produced compilation errors.",
    fix:    "Run `pnpm --filter @workspace/api-server exec tsc --noEmit` to see the full error list.",
  },
  {
    regex:  /is required but was not provided|environment variable.*required/i,
    type:   "missing_env_var",
    cause:  "A required environment variable is missing.",
    fix:    "Check .env.example and set all required variables before starting the server.",
  },
];

function checkLogFiles(): Array<{ result: CheckResult; issue?: DiagnosticIssue }> {
  const logsDir = path.join(PROJECT_ROOT, ".jarvas-data", "logs");

  if (!existsSync(logsDir)) return [];

  let files: string[];
  try {
    files = readdirSync(logsDir)
      .filter(f => f.endsWith(".log") || f.endsWith(".txt"))
      .map(f => path.join(logsDir, f));
  } catch {
    return [];
  }

  if (files.length === 0) return [];

  const results: Array<{ result: CheckResult; issue?: DiagnosticIssue }> = [];
  const seenTypes = new Set<string>();

  for (const file of files.slice(0, 5)) {        // cap at 5 files
    const content = safeReadText(file) ?? "";
    const lines   = content.split("\n").slice(-200); // last 200 lines only

    for (const { regex, type, cause, fix } of LOG_ERROR_PATTERNS) {
      if (seenTypes.has(type)) continue;

      const matchLine = lines.find(l => regex.test(l));
      if (matchLine) {
        seenTypes.add(type);
        results.push({
          result: "warn",
          issue: {
            type,
            severity:     "warning",
            likelyCause:  cause,
            suggestedFix: fix,
            confidence:   "medium",
            detail:       `Detected in ${path.basename(file)}: …${matchLine.slice(-120)}`,
          },
        });
      }
    }
  }

  return results;
}

/** 8. TypeScript compilation check (read-only, tsc --noEmit) */
function checkTypeScript(): { result: CheckResult; issue?: DiagnosticIssue } {
  const tsConfigPath = path.join(PROJECT_ROOT, "artifacts", "api-server", "tsconfig.json");

  if (!existsSync(tsConfigPath)) {
    return {
      result: "skip",
      issue: {
        type:         "typescript_errors",
        severity:     "info",
        likelyCause:  "tsconfig.json not found for api-server — TypeScript check skipped.",
        suggestedFix: "Ensure tsconfig.json exists in artifacts/api-server/.",
        confidence:   "low",
      },
    };
  }

  const output = safeExec(
    `cd "${PROJECT_ROOT}" && pnpm --filter @workspace/api-server exec tsc --noEmit 2>&1`,
    15_000,
  );

  if (output === null) {
    // Timed out or tsc not available
    return {
      result: "skip",
      issue: {
        type:         "typescript_errors",
        severity:     "info",
        likelyCause:  "TypeScript check timed out or tsc is not available.",
        suggestedFix: "Install devDependencies (`pnpm install`) and run `tsc --noEmit` manually.",
        confidence:   "low",
      },
    };
  }

  if (output.trim().length === 0) {
    return { result: "pass" };
  }

  // Count error lines
  const errorLines = output.split("\n").filter(l => /error TS\d+/i.test(l));

  return {
    result: "fail",
    issue: {
      type:         "typescript_errors",
      severity:     "error",
      likelyCause:  `TypeScript found ${errorLines.length} compilation error(s) in the api-server source.`,
      suggestedFix: "Run `pnpm --filter @workspace/api-server exec tsc --noEmit` for the full error list, then fix each reported error.",
      confidence:   "high",
      detail:       errorLines.slice(0, 5).join(" | ") || output.slice(0, 300),
    },
  };
}

// ─── Runtime info ─────────────────────────────────────────────────────────────

function getRuntimeInfo() {
  return {
    nodeVersion:   process.version,
    pnpmVersion:   safeExec("pnpm --version") ?? "unknown",
    platform:      process.platform,
    arch:          process.arch,
    uptimeSeconds: Math.round(process.uptime()),
  };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runDiagnostics(): Promise<DiagnosticsReport> {
  const issues:  DiagnosticIssue[] = [];
  const checks:  Record<string, CheckResult> = {};

  // Run all checks — each is isolated so a failure in one doesn't block others

  // 1. Lockfile
  const lockfileCheck = checkLockfile();
  checks["lockfile"] = lockfileCheck.result;
  if (lockfileCheck.issue) issues.push(lockfileCheck.issue);

  // 2. Env vars (one check per var)
  const envChecks = checkEnvVars();
  envChecks.forEach(({ result, issue }, i) => {
    checks[`env_var_${REQUIRED_ENV_VARS[i]!.name}`] = result;
    if (issue) issues.push(issue);
  });

  // 3. Build artifact
  const buildCheck = checkBuildArtifact();
  checks["build_artifact"] = buildCheck.result;
  if (buildCheck.issue) issues.push(buildCheck.issue);

  // 4. Start command
  const startCheck = checkStartCommand();
  checks["start_command"] = startCheck.result;
  if (startCheck.issue) issues.push(startCheck.issue);

  // 5. Port binding
  const portCheck = checkPortBinding();
  checks["port_binding"] = portCheck.result;
  if (portCheck.issue) issues.push(portCheck.issue);

  // 6. node_modules
  const nmCheck = checkNodeModules();
  checks["node_modules"] = nmCheck.result;
  if (nmCheck.issue) issues.push(nmCheck.issue);

  // 7. Log file scan
  const logChecks = checkLogFiles();
  logChecks.forEach(({ result, issue }, i) => {
    checks[`log_scan_${i}`] = result;
    if (issue) issues.push(issue);
  });

  // 8. TypeScript (slower — runs last)
  const tsCheck = checkTypeScript();
  checks["typescript"] = tsCheck.result;
  if (tsCheck.issue) issues.push(tsCheck.issue);

  const errorCount = issues.filter(i => i.severity === "error").length;
  const warnCount  = issues.filter(i => i.severity === "warning").length;

  return {
    ok:         errorCount === 0,
    checkedAt:  new Date().toISOString(),
    issueCount: issues.length,
    errorCount,
    warnCount,
    issues,
    checks,
    runtimeInfo: getRuntimeInfo(),
    debugInfo: {
      projectRoot:      PROJECT_ROOT,
      cwd:              process.cwd(),
      nodeEnv:          process.env["NODE_ENV"] ?? "not set",
      isProductionLike: isProductionLike(),
      isDevServer:      isDevServer(),
    },
  };
}
