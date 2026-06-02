/**
 * lib/dev/health.ts — Build Health Guardian (read-only, Phase 1)
 *
 * Runs tsc --noEmit for both frontend (jarvas) and backend (api-server),
 * computes a 0-100 health score, and caches results for 30 seconds.
 *
 * Score formula:
 *   100 base
 *   − 5 per frontend TS error  (max −40)
 *   − 2 per backend TS error   (max −20)
 *   floor at 0
 *
 * Never writes any files. Purely observational.
 */

import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";

const execAsync = promisify(exec);

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TsCheckResult {
  ok: boolean;
  errorCount: number;
  /** First 12 error summary lines */
  errors: string[];
  durationMs: number;
}

export interface HealthResult {
  /** 0–100 composite health score */
  score: number;
  label: "healthy" | "degraded" | "failing";
  typescript: {
    frontend: TsCheckResult;
    backend: TsCheckResult;
  };
  lastChecked: number;
  /** true when served from the 30-second cache */
  cached: boolean;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 30_000;
let _cache: { result: HealthResult; expiry: number } | null = null;

// ─── TypeScript check ─────────────────────────────────────────────────────────

async function runTsc(filter: string): Promise<TsCheckResult> {
  const start = Date.now();
  const cmd = `cd "${PROJECT_ROOT}" && pnpm --filter ${filter} exec tsc --noEmit 2>&1`;
  try {
    await execAsync(cmd, { timeout: 35_000, shell: "/bin/bash" });
    return { ok: true, errorCount: 0, errors: [], durationMs: Date.now() - start };
  } catch (err: unknown) {
    const raw = (err as { stdout?: string }).stdout ?? String(err);
    const errorLines = raw
      .split("\n")
      .filter(l => l.includes("error TS"))
      .map(l => l.trim())
      .slice(0, 12);
    const errorCount = (raw.match(/error TS/g) ?? []).length;
    return {
      ok: false,
      errorCount,
      errors: errorLines,
      durationMs: Date.now() - start,
    };
  }
}

// ─── Score + label ────────────────────────────────────────────────────────────

function computeScore(fe: TsCheckResult, be: TsCheckResult): number {
  let score = 100;
  score -= Math.min(fe.errorCount * 5, 40);
  score -= Math.min(be.errorCount * 2, 20);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreLabel(score: number): HealthResult["label"] {
  if (score >= 90) return "healthy";
  if (score >= 70) return "degraded";
  return "failing";
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Immediately clears the health cache so the next read triggers a fresh tsc run. */
export function invalidateHealthCache(): void {
  _cache = null;
}

export async function getHealth(forceRefresh = false): Promise<HealthResult> {
  const now = Date.now();
  if (!forceRefresh && _cache && _cache.expiry > now) {
    return { ..._cache.result, cached: true };
  }

  const [frontend, backend] = await Promise.all([
    runTsc("@workspace/jarvas"),
    runTsc("@workspace/api-server"),
  ]);

  const score = computeScore(frontend, backend);
  const result: HealthResult = {
    score,
    label: scoreLabel(score),
    typescript: { frontend, backend },
    lastChecked: now,
    cached: false,
  };

  _cache = { result, expiry: now + CACHE_TTL_MS };
  return result;
}
