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

import { Router }   from "express";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path          from "path";
import { runDiagnostics } from "../lib/diagnostics";
import { PROJECT_ROOT }   from "../lib/dev/tools";

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

/**
 * GET /api/system/logs
 * Reads all .log and .txt files from .jarvas-data/logs/ (last 500 lines, max 50 KB each).
 * Returns an empty files array when the directory has no log files.
 * Never throws — always 200; errors are surfaced inside the response body.
 */
const LOG_DIR      = path.join(PROJECT_ROOT, ".jarvas-data", "logs");
const MAX_LINES    = 500;
const MAX_BYTES    = 50 * 1024;

router.get("/system/logs", (_req, res) => {
  try {
    if (!existsSync(LOG_DIR)) {
      res.json({ ok: true, files: [] });
      return;
    }

    const entries = readdirSync(LOG_DIR).filter(n =>
      (n.endsWith(".log") || n.endsWith(".txt")) && n !== ".gitkeep",
    );

    const files = entries.map(name => {
      const full   = path.join(LOG_DIR, name);
      const stat   = statSync(full);
      let raw = "";
      try {
        const bytes = stat.size > MAX_BYTES ? stat.size - MAX_BYTES : 0;
        const buf   = readFileSync(full);
        raw         = buf.slice(bytes).toString("utf8");
      } catch { raw = ""; }

      const lines = raw.split("\n").filter(l => l.trim().length > 0).slice(-MAX_LINES);
      return {
        name,
        sizeBytes:    stat.size,
        lastModified: stat.mtime.toISOString(),
        lines,
      };
    });

    // Sort newest-modified first
    files.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

    res.json({ ok: true, files });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.json({ ok: false, files: [], error: message });
  }
});

export default router;
