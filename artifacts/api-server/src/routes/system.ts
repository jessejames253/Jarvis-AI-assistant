/**
 * routes/system.ts — System diagnostics API
 *
 * GET /api/system/diagnostics
 *   Runs a full read-only health scan and returns a structured report.
 *   Safe to call at any time — makes no changes to any file or config.
 *
 * Response shape:
 *   {
 *     ok:         boolean          // false if any "error" severity issues found
 *     checkedAt:  string           // ISO timestamp
 *     issueCount: number
 *     errorCount: number
 *     warnCount:  number
 *     issues: [{
 *       type:         string       // machine-readable issue type
 *       severity:     string       // "error" | "warning" | "info"
 *       likelyCause:  string       // human-readable diagnosis
 *       suggestedFix: string       // actionable remediation
 *       confidence:   string       // "high" | "medium" | "low"
 *       detail?:      string       // extra context (file paths, raw output)
 *     }]
 *     checks:     Record<string, "pass"|"fail"|"warn"|"skip">
 *     runtimeInfo: { nodeVersion, pnpmVersion, platform, arch, uptimeSeconds }
 *   }
 */

import { Router } from "express";
import { runDiagnostics } from "../lib/diagnostics";

const router = Router();

router.get("/system/diagnostics", async (_req, res) => {
  try {
    const report = await runDiagnostics();
    // Always 200 — the `ok` field in the body conveys health status.
    // A 5xx would mean the diagnostic route itself failed, not the project.
    res.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({
      ok:         false,
      checkedAt:  new Date().toISOString(),
      issueCount: 1,
      errorCount: 1,
      warnCount:  0,
      issues: [{
        type:         "build_artifact_missing",
        severity:     "error",
        likelyCause:  "The diagnostics runner itself threw an unexpected error.",
        suggestedFix: "Check server logs for the stack trace.",
        confidence:   "low",
        detail:       message,
      }],
      checks:      { diagnostics_runner: "fail" },
      runtimeInfo: {
        nodeVersion:   process.version,
        pnpmVersion:   "unknown",
        platform:      process.platform,
        arch:          process.arch,
        uptimeSeconds: Math.round(process.uptime()),
      },
    });
  }
});

export default router;
