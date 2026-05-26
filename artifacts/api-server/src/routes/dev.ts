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
import { runDevAgent } from "../lib/dev/agent";
import {
  applyPatch, rollbackFile, listProjectFilesRest, readProjectFileRest,
} from "../lib/dev/tools";
import { createSnapshot } from "../lib/dev/snapshotStore";
import { createTask, updateTask, addMessage, addPatchToTask, markPatchApplied } from "../lib/dev/taskStore";
import { runValidation } from "../lib/dev/validator";

const router = Router();

// ─── POST /dev/stream ─────────────────────────────────────────────────────────

router.post("/dev/stream", async (req, res) => {
  const { message, taskId: providedTaskId } = req.body as { message?: string; taskId?: string };
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

  // Wrap send to also save agent messages to task
  const taskSend = (data: Record<string, unknown>) => {
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
    } else if (t === "dev:error") {
      addMessage(taskId!, { role: "system", type: "error", error: data.error as string });
      updateTask(taskId!, { status: "failed", lastError: data.error as string });
    }
  };

  try {
    await runDevAgent(message.trim(), taskSend, () => cancelled);
    // If we proposed patches, leave status as waiting_approval
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

  // Mark patch applied in task store
  if (taskId && patchId) {
    markPatchApplied(taskId, patchId, snapshotId);
  }

  // Run validation
  const validationEvents: object[] = [];
  const validationSend = (d: object) => validationEvents.push(d);
  const proj = (project ?? "jarvas") as "jarvas" | "api-server";
  const validation = await runValidation(proj, validationSend);

  // Update task with validation result
  if (taskId) {
    updateTask(taskId, {
      status: validation.passed ? "applied" : "failed",
      validationResult: validation.passed ? "passed" : "failed",
    });
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
  });
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

router.get("/dev/patches", async (_req, res) => {
  const { pendingPatches } = await import("../lib/dev/tools");
  const patches = Array.from(pendingPatches.values());
  res.json({ ok: true, patches });
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
  const result = await readProjectFileRest(filePath, 400);
  if (!result.ok) { res.status(400).json(result); return; }
  res.json(result);
});

export default router;
