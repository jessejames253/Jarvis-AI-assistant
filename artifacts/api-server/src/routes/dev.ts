/**
 * routes/dev.ts — Dev Agent SSE + patch management endpoints.
 *
 * POST /dev/stream   — streams dev agent work as SSE events
 * POST /dev/apply    — applies an approved patch (user-initiated only)
 *                      creates snapshot, runs validation, updates task
 * POST /dev/rollback — restores the last backup of a file
 * GET  /dev/files    — list project files (for file browser UI)
 * GET  /dev/file     — read a single project file (for file browser UI)
 */

import { Router } from "express";
import path from "path";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { runDevAgent } from "../lib/dev/agent";
import {
  applyPatch, isApplied, rollbackFile, listProjectFilesRest, readProjectFileRest,
  PROJECT_ROOT, deletePatch, SERVER_STARTED_AT, RECOVERED_PATCH_COUNT,
  pendingPatches, getProjectRootDiagnostics,
} from "../lib/dev/tools";
import { createSnapshot } from "../lib/dev/snapshotStore";
import {
  createTask, updateTask, addMessage, addPatchToTask, markPatchApplied,
  clearTasks,
} from "../lib/dev/taskStore";
import { runValidation } from "../lib/dev/validator";
import { runAutoFixAnalysis, getLastAutoFixResult } from "../lib/dev/autoFixEngine";
import { invalidateHealthCache } from "../lib/dev/health";

const router = Router();

// ─── POST /dev/stream ─────────────────────────────────────────────────────────

router.post("/dev/stream", async (req, res) => {
  const {
    message,
    taskId: providedTaskId,
    autoApprove = false,
  } = req.body as { message?: string; taskId?: string; autoApprove?: boolean };
  if (!message?.trim()) { res.status(400).json({ error: "message is required" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let cancelled = false;
  res.on("close", () => { cancelled = true; });

  const send = (data: object) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Create or reuse task
  let taskId = providedTaskId;
  if (!taskId) {
    const task = createTask(message.trim());
    taskId = task.id;
    send({ type: "dev:task_created", taskId, title: task.title });
  } else {
    updateTask(taskId, { status: "running" });
  }
  send({ type: "dev:task_started", taskId });

  // Save user message
  addMessage(taskId, { role: "user", type: "user_message", text: message.trim() });

  // Wrap send to also save agent messages to task.
  // When autoApprove=true, patches flagged safeToTest are applied immediately
  // without requiring a user round-trip — the result is streamed back inline.
  const taskSend = async (data: Record<string, unknown>) => {
    send(data);
    const t = data.type as string;
    if (t === "dev:token") return; // don't save individual tokens
    if (t === "dev:done") {
      const text = (data.response as string) ?? "";
      if (text.trim()) addMessage(taskId!, { role: "agent", type: "agent_text", text });
    } else if (t === "dev:patch_proposed") {
      addMessage(taskId!, { role: "agent", type: "patch_proposed", patchId: data.patchId as string });
      addPatchToTask(taskId!, {
        patchId: data.patchId as string,
        file: data.file as string,
        description: data.description as string,
        riskLevel: data.riskLevel as "low" | "medium" | "high" | undefined,
        status: "proposed",
      });

      // ── Auto-apply safe patches when autoApprove mode is active ──────────
      if (autoApprove && data.safeToTest === true) {
        const patchId = data.patchId as string;
        send({ type: "dev:auto_applying", patchId, file: data.file, reason: "safeToTest=true + autoApprove mode" });

        const { pendingPatches } = await import("../lib/dev/tools");
        const patchEntry = pendingPatches.get(patchId);

        // Create snapshot before apply
        let snapshotId: string | undefined;
        if (patchEntry) {
          const snap = await createSnapshot({ patchId, file: patchEntry.file, taskId: taskId! });
          snapshotId = snap.id;
        }

        const applyResult = await applyPatch(patchId);
        if (!applyResult.ok) {
          send({ type: "dev:auto_apply_failed", patchId, error: applyResult.error });
        } else {
          markPatchApplied(taskId!, patchId, snapshotId);

          // Run validation and stream results
          const validationSend = (d: Record<string, unknown>) => send(d);
          const validation = await runValidation("jarvas", validationSend);
          updateTask(taskId!, {
            status: validation.passed ? "applied" : "failed",
            validationResult: validation.passed ? "passed" : "failed",
          });
          send({
            type: "dev:auto_applied",
            patchId,
            file: data.file,
            snapshotId,
            validationPassed: validation.passed,
            validationSummary: validation.summary,
          });
        }
      }
    } else if (t === "dev:error") {
      addMessage(taskId!, { role: "system", type: "error", error: data.error as string });
      updateTask(taskId!, { status: "failed", lastError: data.error as string });
    }
  };

  try {
    await runDevAgent(message.trim(), (d) => { void taskSend(d as Record<string, unknown>); }, () => cancelled);
    // If we proposed patches (and didn't auto-apply), leave status as waiting_approval
    const task = (await import("../lib/dev/taskStore")).getTask(taskId);
    if (task && task.status === "running") {
      updateTask(taskId, { status: "completed" });
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    send({ type: "dev:error", error });
    updateTask(taskId, { status: "failed", lastError: error });
  } finally {
    // Return the taskId so the frontend can persist it
    send({ type: "done", taskId });
    if (!res.writableEnded) res.end();
  }
});

// ─── POST /dev/apply ──────────────────────────────────────────────────────────

router.post("/dev/apply", async (req, res) => {
  const { patchId, taskId, project } = req.body as {
    patchId?: string; taskId?: string; project?: string;
  };
  if (!patchId) { res.status(400).json({ error: "patchId is required" }); return; }

  // Import pendingPatches to get file path for snapshot
  const { pendingPatches } = await import("../lib/dev/tools");
  const patch = pendingPatches.get(patchId);

  // Create snapshot before apply
  let snapshotId: string | undefined;
  if (patch) {
    const snap = await createSnapshot({ patchId, file: patch.file, taskId });
    snapshotId = snap.id;
  }

  const result = await applyPatch(patchId);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  // Patch was already applied in a previous request (duplicate click / tab remount).
  // Return success immediately so the UI shows "already applied" instead of an error.
  if (result.alreadyApplied) {
    res.json({ ok: true, alreadyApplied: true });
    return;
  }

  // Mark patch applied in task store
  if (taskId && patchId) {
    markPatchApplied(taskId, patchId, snapshotId);
  }

  // Run validation
  const validationEvents: object[] = [];
  const validationSend = (d: object) => validationEvents.push(d);
  const proj = (project ?? "jarvas") as "jarvas" | "api-server";
  const validation = await runValidation(proj, validationSend);

  // Invalidate the health cache so the BUILD tab reflects the post-apply state
  // immediately rather than serving the 30-second stale result.
  invalidateHealthCache();
  console.log(`[dev/apply] patchId=${patchId} validation=${validation.passed ? "passed" : "failed"} — health cache invalidated`);

  // Update task with validation result
  if (taskId) {
    updateTask(taskId, {
      status: validation.passed ? "applied" : "failed",
      validationResult: validation.passed ? "passed" : "failed",
    });
  }

  // ── Phase 3C: Auto-Fix Engine ─────────────────────────────────────────────
  // Run auto-fix analysis only on failure.
  // Safe fixes are applied automatically (max 2 attempts).
  // Review/risky issues are queued as pending patches for human approval.
  let autoFixResult = null;
  if (!validation.passed) {
    const failedOutput = validation.checks.find(c => !c.passed)?.output ?? "";
    autoFixResult = await runAutoFixAnalysis(failedOutput, proj, 2);
  }

  res.json({
    ok: true,
    backupPath: result.backupPath,
    snapshotId,
    taskId,
    validation: {
      passed: validation.passed,
      summary: validation.summary,
      checks: validation.checks,
    },
    validationEvents,
    autoFixResult,
  });
});

// ─── POST /dev/snapshots/:id/restore ─────────────────────────────────────────
// Restore a file to its pre-patch state using a saved snapshot.
// Creates a backup of the current file before restoring, then runs validation.
// This is the clean rollback path when a snapshotId is known after apply.

router.post("/dev/snapshots/:id/restore", async (req, res): Promise<void> => {
  const { id } = req.params as { id: string };
  try {
    const { restoreSnapshot, getSnapshot } = await import("../lib/dev/snapshotStore");
    const snap = getSnapshot(id);
    if (!snap) { res.status(404).json({ ok: false, error: "Snapshot not found" }); return; }

    // Back up the current file before restoring (so rollback itself is reversible)
    const { default: fs } = await import("fs/promises");
    const { default: path } = await import("path");
    const abs = path.resolve(PROJECT_ROOT, snap.file);
    try {
      await fs.copyFile(abs, `${abs}.devbak.${Date.now()}`);
    } catch { /* new file — no backup needed */ }

    const result = await restoreSnapshot(id);
    if (!result.ok) { res.status(400).json({ ok: false, error: result.error }); return; }

    // Run validation after restore so the user can see the health impact
    const validationEvents: object[] = [];
    const { runValidation } = await import("../lib/dev/validator");
    const project = snap.file.startsWith("artifacts/api-server") ? "api-server" : "jarvas";
    const validation = await runValidation(project as "jarvas" | "api-server", (d) => validationEvents.push(d));

    res.json({ ok: true, file: snap.file, validation: { passed: validation.passed, summary: validation.summary }, validationEvents });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ─── POST /dev/rollback ───────────────────────────────────────────────────────

router.post("/dev/rollback", async (req, res) => {
  const { file } = req.body as { file?: string };
  if (!file?.trim()) { res.status(400).json({ error: "file is required" }); return; }

  const result = await rollbackFile(file.trim());
  if (!result.ok) { res.status(400).json({ error: result.error }); return; }

  res.json({ ok: true, restoredFrom: result.restoredFrom });
});

// ─── GET /dev/patches ─────────────────────────────────────────────────────────

// POST /api/dev/patches — register a patch from Jarvis chat or any external source
router.post("/dev/patches", async (req, res): Promise<void> => {
  const {
    file,
    description,
    oldContent = "",
    newContent,
    riskLevel  = "medium",
  } = req.body as {
    file?: string; description?: string; oldContent?: string;
    newContent?: string; riskLevel?: string;
  };

  if (!file?.trim() || !newContent?.trim()) {
    res.status(400).json({ error: "file and newContent are required" });
    return;
  }

  const { registerPatch } = await import("../lib/dev/tools");
  const patch = registerPatch({
    file:        file.trim(),
    description: description?.trim() ?? "Code change proposed by Jarvis",
    oldContent,
    newContent,
    riskLevel:   riskLevel as "low" | "medium" | "high",
  });

  console.log("[DEV] POST /api/dev/patches — registered:", patch.patchId, "for", file);
  res.json({
    ok:          true,
    patchId:     patch.patchId,
    file:        patch.file,
    description: patch.description,
    riskLevel:   patch.riskLevel,
  });
});

router.get("/dev/patches", (_req, res) => {
  try {
    // Filter out any patch that was applied in this process run.
    // This is belt-and-suspenders: applyPatch already deletes from the Map,
    // but isApplied() catches any edge case where the Map retained a stale entry.
    const patches = Array.from(pendingPatches.values()).filter(p => !isApplied(p.patchId));
    console.log(`[GET /dev/patches] returning ${patches.length} patch(es) (map size: ${pendingPatches.size})`);
    res.json({ ok: true, patches });
  } catch (err) {
    res.json({ ok: true, patches: [] });
  }
});

// ─── DELETE /dev/patches/:id ──────────────────────────────────────────────────
// Persistently reject a patch — removes it from the queue and saves to disk.
// Called by the frontend rejectPatch() lib so rejections survive page refreshes.

router.delete("/dev/patches/:id", (req, res) => {
  const { id } = req.params as { id: string };
  if (!id) { res.status(400).json({ ok: false, error: "patch id required" }); return; }
  const existed = deletePatch(id);
  res.json({ ok: true, existed });
});

// ─── GET /dev/server-status ───────────────────────────────────────────────────
// Returns when this server process started and how many patches were recovered
// from disk. The frontend polls this to detect restarts and show banners.

router.get("/dev/server-status", (_req, res) => {
  try {
    res.json({
      ok: true,
      startedAt: SERVER_STARTED_AT,
      recoveredPatchCount: RECOVERED_PATCH_COUNT,
    });
  } catch {
    res.json({ ok: true, startedAt: 0, recoveredPatchCount: 0 });
  }
});

// ─── GET /dev/health ──────────────────────────────────────────────────────────
// Returns a 0–100 health score plus TypeScript error details for both packages.
// Results are cached for 30 seconds. Add ?refresh=1 to force a fresh check.
// Read-only — never writes any files.

router.get("/dev/health", async (req, res): Promise<void> => {
  const force = req.query.refresh === "1";
  try {
    const { getHealth } = await import("../lib/dev/health");
    const health = await getHealth(force);
    res.json({ ok: true, ...health });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ─── GET /dev/context ─────────────────────────────────────────────────────────
// Aggregates health, patches, improvements, tasks, git, rollbacks, and errors
// into a single snapshot for the frontend ContextPill and Dev Agent prompts.
// Add ?refresh=1 to force a fresh health check (other reads are always fresh).
// Read-only — never writes or executes.

router.get("/dev/context", async (req, res): Promise<void> => {
  const force = req.query.refresh === "1";
  try {
    const { getDevContext, suggestTasksFromContext } = await import("../lib/dev/context");
    const ctx = await getDevContext(force);
    const suggestions = suggestTasksFromContext(ctx);
    res.json({ ok: true, context: ctx, suggestions });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ─── POST /dev/autofix ────────────────────────────────────────────────────────
// Scans both packages for low-risk TypeScript errors and adds them to the
// improvement store. Returns newly created improvements (duplicates skipped).

router.post("/dev/autofix", async (_req, res): Promise<void> => {
  try {
    const { scanForImprovements } = await import("../lib/dev/autofix");
    const created = await scanForImprovements();
    res.json({ ok: true, created: created.length, improvements: created });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ─── GET /dev/autofix/history ─────────────────────────────────────────────────

router.get("/dev/autofix/history", async (_req, res): Promise<void> => {
  try {
    const { getAutofixHistory } = await import("../lib/dev/autofix");
    res.json({ ok: true, history: getAutofixHistory() });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ─── GET /dev/improvements ────────────────────────────────────────────────────

router.get("/dev/improvements", async (_req, res): Promise<void> => {
  try {
    const { getImprovements } = await import("../lib/dev/improvements");
    res.json({ ok: true, improvements: getImprovements() });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ─── POST /dev/improvements ───────────────────────────────────────────────────
// Add a manually authored improvement entry.

router.post("/dev/improvements", async (req, res): Promise<void> => {
  const body = req.body as {
    title?: string;
    description?: string;
    category?: string;
    riskLevel?: string;
    files?: string[];
    patch?: { file: string; oldContent: string; newContent: string };
  };
  if (!body.title?.trim()) {
    res.status(400).json({ ok: false, error: "title is required" });
    return;
  }
  try {
    const { addImprovement } = await import("../lib/dev/improvements");
    const imp = addImprovement({
      title: body.title.trim(),
      description: body.description?.trim() ?? "",
      category: (body.category ?? "lint") as import("../lib/dev/improvements").ImprovementCategory,
      riskLevel: (body.riskLevel ?? "medium") as import("../lib/dev/improvements").RiskLevel,
      status: "proposed",
      files: body.files ?? [],
      autoFixable: body.riskLevel === "low",
      patch: body.patch,
    });
    res.json({ ok: true, improvement: imp });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ─── PATCH /dev/improvements/:id ──────────────────────────────────────────────

router.patch("/dev/improvements/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const updates = req.body as Partial<import("../lib/dev/improvements").Improvement>;
  try {
    const { updateImprovement } = await import("../lib/dev/improvements");
    const updated = updateImprovement(id, updates);
    if (!updated) {
      res.status(404).json({ ok: false, error: "Improvement not found" });
      return;
    }
    res.json({ ok: true, improvement: updated });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ─── POST /dev/improvements/:id/apply ────────────────────────────────────────
// Guarded apply pipeline: safety checks → snapshot → write → tsc × 2 → health
// → commit to history OR rollback + log failure.
// Human must trigger this explicitly — never autonomous.

router.post("/dev/improvements/:id/apply", async (req, res): Promise<void> => {
  const { id } = req.params;
  try {
    const { applyImprovement } = await import("../lib/dev/autofix");
    const result = await applyImprovement(id);
    if (!result.ok) {
      res.status(result.rolledBack ? 422 : 400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ─── GET /dev/autofix/latest ──────────────────────────────────────────────────
// Returns the result of the most recent auto-fix analysis run.

router.get("/dev/autofix/latest", (_req, res) => {
  try {
    const result = getLastAutoFixResult();
    res.json({ ok: true, result: result ?? null });
  } catch {
    res.json({ ok: true, result: null });
  }
});

// ─── GET /dev/diagnostics ─────────────────────────────────────────────────────
// Reports resolved project root, cwd, __dirname, marker checks, ripgrep path,
// and file-access validation so the user/agent can see exactly what the server
// sees at runtime.

router.get("/dev/diagnostics", async (_req, res): Promise<void> => {
  try {
    const diag = await getProjectRootDiagnostics();

    // Verify we can actually list files
    let listSample: string[] = [];
    let listError: string | null = null;
    try {
      listSample = (await listProjectFilesRest("", 1)).slice(0, 20);
    } catch (e) {
      listError = String(e);
    }

    // Verify key source files are readable
    const probeFiles = [
      "artifacts/api-server/src/lib/dev/tools.ts",
      "artifacts/jarvas/src/pages/Chat.tsx",
    ];
    const fileAccess: Record<string, boolean> = {};
    for (const f of probeFiles) {
      try {
        const result = await readProjectFileRest(f, 1);
        fileAccess[f] = result.ok;
      } catch {
        fileAccess[f] = false;
      }
    }

    res.json({
      ok: true,
      projectRoot: diag.projectRoot,
      cwd: diag.cwd,
      dirname: diag.dirname,
      markers: diag.markers,
      rgPath: diag.rgPath,
      jarvisDir: diag.jarvisDir,
      listSample,
      listError,
      fileAccess,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ─── GET /dev/debug ───────────────────────────────────────────────────────────
// Single endpoint that surfaces every runtime variable needed to diagnose
// "filesystem unavailable" / wrong root / stale bundle issues in production.
// Designed to be called from the live Jarvis UI even before other routes work.

router.get("/dev/debug", (_req, res) => {
  const checkList = [
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "artifacts",
    "artifacts/api-server/src",
    "artifacts/api-server/dist",
    "artifacts/jarvas/src",
    "artifacts/jarvas/dist",
    "lib",
    "node_modules",
    ".jarvis",
    ".jarvas-data",
  ];
  const markers: Record<string, boolean> = {};
  for (const rel of checkList) {
    try { markers[rel] = existsSync(path.join(PROJECT_ROOT, rel)); }
    catch { markers[rel] = false; }
  }

  res.json({
    ok:               true,
    timestamp:        new Date().toISOString(),
    serverStartedAt:  new Date(SERVER_STARTED_AT).toISOString(),
    uptimeSeconds:    Math.round((Date.now() - SERVER_STARTED_AT) / 1000),
    env: {
      NODE_ENV:          process.env["NODE_ENV"]      ?? "not set",
      PORT:              process.env["PORT"]           ?? "not set",
      PROJECT_ROOT_ENV:  process.env["PROJECT_ROOT"]  ?? "not set (auto-detected)",
    },
    paths: {
      projectRoot: PROJECT_ROOT,
      cwd:         process.cwd(),
      dirname:     __dirname,
    },
    markers,
    routes: {
      "GET /api/dev/debug":          true,
      "GET /api/dev/logs":           true,
      "GET /api/dev/files":          true,
      "DELETE /api/dev/tasks":       true,
      "GET /api/system/diagnostics": true,
      "POST /api/dev/stream":        true,
    },
  });
});

// ─── GET /dev/logs ────────────────────────────────────────────────────────────
// The frontend DEV → LOGS tab calls GET /api/dev/logs.
// We read from .jarvas-data/logs/ if it exists; fall back to a friendly message
// so the tab never shows HTTP 404.

const DEV_LOG_DIR   = path.join(PROJECT_ROOT, ".jarvas-data", "logs");
const LOG_MAX_LINES = 300;
const LOG_MAX_BYTES = 40 * 1024;

router.get("/dev/logs", (_req, res) => {
  try {
    if (!existsSync(DEV_LOG_DIR)) {
      res.json({
        ok:     true,
        lines:  ["[INFO] No log directory found at .jarvas-data/logs/. Application logs are written here when available."],
        source: "fallback",
        note:   `Checked: ${DEV_LOG_DIR}`,
      });
      return;
    }

    const entries = readdirSync(DEV_LOG_DIR).filter(
      n => (n.endsWith(".log") || n.endsWith(".txt")) && n !== ".gitkeep",
    );

    if (entries.length === 0) {
      res.json({
        ok:     true,
        lines:  ["[INFO] Log directory exists but contains no log files yet."],
        source: "fallback",
        note:   "No .log or .txt files in .jarvas-data/logs/",
      });
      return;
    }

    // Sort newest-modified first then collect lines from the top 3 files
    const sorted = entries
      .map(n => {
        try { return { name: n, mtime: statSync(path.join(DEV_LOG_DIR, n)).mtimeMs }; }
        catch { return { name: n, mtime: 0 }; }
      })
      .sort((a, b) => b.mtime - a.mtime);

    const allLines: string[] = [];
    for (const { name } of sorted.slice(0, 3)) {
      const full = path.join(DEV_LOG_DIR, name);
      try {
        const sz  = statSync(full).size;
        const off = sz > LOG_MAX_BYTES ? sz - LOG_MAX_BYTES : 0;
        const raw = readFileSync(full).slice(off).toString("utf8");
        const fLines = raw.split("\n").filter(l => l.trim().length > 0).slice(-LOG_MAX_LINES);
        allLines.push(`=== ${name} ===`);
        allLines.push(...fLines);
      } catch { /* skip unreadable file */ }
    }

    if (allLines.length === 0) {
      res.json({ ok: true, lines: ["[INFO] Log files exist but are empty."], source: "fallback" });
      return;
    }

    res.json({ ok: true, lines: allLines.slice(-LOG_MAX_LINES), source: "file" });
  } catch (err) {
    res.json({
      ok:     true,
      lines:  [`[WARN] Could not read log files: ${String(err)}. Check your hosting platform for deployment logs.`],
      source: "fallback",
    });
  }
});

// ─── DELETE /dev/tasks ────────────────────────────────────────────────────────
// Clears terminal tasks (applied/completed/cancelled/rolled_back) from the store.
// Pass ?all=1 to clear every task regardless of status.

router.delete("/dev/tasks", (req, res) => {
  try {
    const filter = req.query.all === "1" ? "all" : "terminal";
    const { cleared } = clearTasks(filter);
    res.json({ ok: true, cleared, filter });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ─── GET /dev/files ───────────────────────────────────────────────────────────

router.get("/dev/files", async (req, res) => {
  const dir   = (req.query.dir   as string) ?? "";
  const depth = Math.min(parseInt((req.query.depth as string) ?? "2", 10), 4);
  try {
    const files = await listProjectFilesRest(dir, depth);
    res.json({ ok: true, files });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err) });
  }
});

// ─── GET /dev/file ────────────────────────────────────────────────────────────

router.get("/dev/file", async (req, res) => {
  const filePath = (req.query.path as string) ?? "";
  if (!filePath) { res.status(400).json({ ok: false, error: "path is required" }); return; }
  try {
    const result = await readProjectFileRest(filePath, 400);
    if (!result.ok) { res.status(400).json(result); return; }
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

export default router;
