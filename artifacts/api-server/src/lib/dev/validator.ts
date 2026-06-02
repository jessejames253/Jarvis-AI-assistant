/**
 * lib/dev/validator.ts — Post-patch validation pipeline.
 *
 * Detects available scripts from package.json and runs them.
 * Results are streamed as structured events and returned as a summary.
 */

import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { PROJECT_ROOT } from "./tools";

const execAsync = promisify(exec);

interface CheckResult {
  name: string;
  passed: boolean;
  output: string;
  durationMs: number;
}

interface ValidationResult {
  project: string;
  passed: boolean;
  checks: CheckResult[];
  summary: string;
}

async function getAvailableScripts(project: string): Promise<string[]> {
  try {
    const pkgPath = path.join(PROJECT_ROOT, "artifacts", project, "package.json");
    const raw = await fs.readFile(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    return Object.keys(pkg.scripts ?? {});
  } catch {
    return [];
  }
}

async function runScript(project: string, script: string, timeout = 45000): Promise<{ passed: boolean; output: string; durationMs: number }> {
  const start = Date.now();
  // Do NOT pipe through `head` — that masks the real exit code (bash exits with
  // the last command's code, which would always be 0 from `head`).
  const cmd = `cd "${PROJECT_ROOT}" && pnpm --filter @workspace/${project} run ${script} 2>&1`;
  try {
    const { stdout } = await execAsync(cmd, { timeout, maxBuffer: 512 * 1024, shell: "/bin/bash" });
    const output = stdout.trim();
    // Only fail on genuine TypeScript compiler errors (exit-0 means tsc passed,
    // but double-check for "error TS" in case the script wraps tsc with pipefail).
    const hasTypeErrors = output.includes("error TS");
    return { passed: !hasTypeErrors, output: output.slice(0, 1200), durationMs: Date.now() - start };
  } catch (err: unknown) {
    // Non-zero exit — process genuinely failed.
    const raw = (err as { stdout?: string }).stdout ?? String(err);
    const out = raw.trim().slice(0, 1200);
    return { passed: false, output: out, durationMs: Date.now() - start };
  }
}

// Priority order for checks
const CHECK_PRIORITY = ["typecheck", "check", "lint", "build", "test"];

export async function runValidation(
  project: "jarvas" | "api-server",
  send: (d: object) => void,
): Promise<ValidationResult> {
  send({ type: "dev:validation_started", project });

  const available = await getAvailableScripts(project);
  const toRun = CHECK_PRIORITY.filter(s => available.includes(s));

  if (toRun.length === 0) {
    const result: ValidationResult = { project, passed: true, checks: [], summary: "No validation scripts found — skipped." };
    send({ type: "dev:validation_done", ...result });
    return result;
  }

  const checks: CheckResult[] = [];
  let allPassed = true;

  for (const script of toRun) {
    send({ type: "dev:check_started", check: script, project });
    const { passed, output, durationMs } = await runScript(project, script);
    const check: CheckResult = { name: script, passed, output, durationMs };
    checks.push(check);
    allPassed = allPassed && passed;
    send({ type: passed ? "dev:check_passed" : "dev:check_failed", check: script, project, output, durationMs });
    if (!passed) break; // stop on first failure
  }

  const failedCheck = checks.find(c => !c.passed);
  let summary: string;
  if (allPassed) {
    summary = `✓ All ${checks.length} check(s) passed (${checks.map(c => c.name).join(", ")})`;
  } else {
    // Include the first meaningful error lines so the user sees what actually broke.
    const errorLines = (failedCheck?.output ?? "")
      .split("\n")
      .filter(l => l.includes("error TS") || l.trim().startsWith("error"))
      .slice(0, 3)
      .join(" | ")
      .trim();
    summary = `✗ ${failedCheck?.name} failed${errorLines ? `: ${errorLines}` : ""}`;
  }

  const result: ValidationResult = { project, passed: allPassed, checks, summary };
  send({ type: "dev:validation_done", project, passed: allPassed, summary });
  return result;
}
