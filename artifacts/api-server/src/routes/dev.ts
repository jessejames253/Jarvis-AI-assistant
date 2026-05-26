/**
 * routes/dev.ts — Dev Agent SSE + patch management endpoints.
 *
 * POST /dev/stream   — streams dev agent work as SSE events
 * POST /dev/apply    — applies an approved patch (user-initiated only)
 * POST /dev/rollback — restores the last backup of a file
 * GET  /dev/files    — list project files (for file browser UI)
 * GET  /dev/file     — read a single project file (for file browser UI)
 */

import { Router } from "express";
import { runDevAgent } from "../lib/dev/agent";
import { applyPatch, rollbackFile, listProjectFilesRest, readProjectFileRest, runTypecheck } from "../lib/dev/tools";

const router = Router();

// POST /dev/stream
router.post("/dev/stream", async (req, res) => {
  const { message } = req.body as { message?: string };
  if (!message?.trim()) { res.status(400).json({ error: "message is required" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let cancelled = false;
  res.on("close", () => { cancelled = true; });

  const send = (data: object) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };

  try {
    await runDevAgent(message.trim(), send, () => cancelled);
  } catch (err) {
    send({ type: "dev:error", error: err instanceof Error ? err.message : String(err) });
  } finally {
    send({ type: "done" });
    if (!res.writableEnded) res.end();
  }
});

// POST /dev/apply
router.post("/dev/apply", async (req, res) => {
  const { patchId, runCheck, project } = req.body as { patchId?: string; runCheck?: boolean; project?: string };
  if (!patchId) { res.status(400).json({ error: "patchId is required" }); return; }

  const result = await applyPatch(patchId);
  if (!result.ok) { res.status(400).json({ error: result.error }); return; }

  if (runCheck) {
    const checkLogs: string[] = [];
    const checkResult = await runTypecheck({ project }, (d) => checkLogs.push(JSON.stringify(d)));
    res.json({ ok: true, backupPath: result.backupPath, checkResult, checkLogs });
  } else {
    res.json({ ok: true, backupPath: result.backupPath });
  }
});

// POST /dev/rollback — restore a file from its latest backup
router.post("/dev/rollback", async (req, res) => {
  const { file } = req.body as { file?: string };
  if (!file?.trim()) { res.status(400).json({ error: "file is required" }); return; }

  const result = await rollbackFile(file.trim());
  if (!result.ok) { res.status(400).json({ error: result.error }); return; }

  res.json({ ok: true, restoredFrom: result.restoredFrom });
});

// GET /dev/files?dir=artifacts/jarvas/src&depth=2
router.get("/dev/files", async (req, res) => {
  const dir = (req.query.dir as string) ?? "";
  const depth = Math.min(parseInt((req.query.depth as string) ?? "2", 10), 4);
  try {
    const files = await listProjectFilesRest(dir, depth);
    res.json({ ok: true, files });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err) });
  }
});

// GET /dev/file?path=artifacts/jarvas/src/pages/Chat.tsx
router.get("/dev/file", async (req, res) => {
  const filePath = (req.query.path as string) ?? "";
  if (!filePath) { res.status(400).json({ ok: false, error: "path is required" }); return; }
  const result = await readProjectFileRest(filePath, 400);
  if (!result.ok) { res.status(400).json(result); return; }
  res.json(result);
});

export default router;
