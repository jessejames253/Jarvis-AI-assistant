/**
 * routes/dev.ts — Dev Agent SSE endpoint.
 *
 * POST /dev/stream — streams the dev agent's work as SSE events.
 * POST /dev/apply  — applies an approved patch (user-initiated only).
 */

import { Router } from "express";
import { runDevAgent } from "../lib/dev/agent";
import { applyPatch, runTypecheck } from "../lib/dev/tools";

const router = Router();

// POST /dev/stream
router.post("/dev/stream", async (req, res) => {
  const { message, sessionId } = req.body as { message?: string; sessionId?: string };

  if (!message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let cancelled = false;
  res.on("close", () => { cancelled = true; });

  const send = (data: object) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  try {
    await runDevAgent(message.trim(), send, () => cancelled);
  } catch (err) {
    send({ type: "dev:error", error: err instanceof Error ? err.message : String(err) });
  } finally {
    send({ type: "done" });
    if (!res.writableEnded) res.end();
  }
});

// POST /dev/apply — apply an approved patch
router.post("/dev/apply", async (req, res) => {
  const { patchId, runCheck, project } = req.body as { patchId?: string; runCheck?: boolean; project?: string };

  if (!patchId) {
    res.status(400).json({ error: "patchId is required" });
    return;
  }

  const result = await applyPatch(patchId);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  if (runCheck) {
    const checkLogs: string[] = [];
    const checkResult = await runTypecheck({ project }, (d) => checkLogs.push(JSON.stringify(d)));
    res.json({ ok: true, checkResult, checkLogs });
  } else {
    res.json({ ok: true });
  }
});

export default router;
