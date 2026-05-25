/**
 * routes/memory.ts — Session memory + long-term memory endpoints
 *
 * Session memory:
 *   GET    /api/memory/:sessionId          → Fetch session (creates if new)
 *   PUT    /api/memory/:sessionId/prefs    → Update user preferences
 *   DELETE /api/memory/:sessionId          → Clear all session memory
 *
 * Long-term memory (LTM):
 *   GET    /api/memory/:sessionId/ltm              → List all LTM entries
 *   DELETE /api/memory/:sessionId/ltm              → Clear all LTM entries
 *   DELETE /api/memory/:sessionId/ltm/:entryId     → Delete one LTM entry
 */

import { Router } from "express";
import {
  getOrCreateSession,
  updatePreferences,
  clearSession,
} from "../lib/memory";
import {
  getLTM,
  deleteEntry,
  clearLTM,
} from "../lib/ltm/store";
import { logger } from "../lib/logger";

const router = Router();

const SESSION_ID_RE = /^[a-zA-Z0-9\-]{8,64}$/;

// ── GET /api/memory/:sessionId ────────────────────────────────────────────────
router.get("/memory/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  if (!SESSION_ID_RE.test(sessionId)) {
    res.status(400).json({ error: "Invalid session ID" }); return;
  }
  try {
    const session = await getOrCreateSession(sessionId);
    res.json(session);
  } catch (err) {
    logger.error({ err, sessionId }, "Failed to get session");
    res.status(500).json({ error: "Failed to load session" });
  }
});

// ── PUT /api/memory/:sessionId/prefs ─────────────────────────────────────────
router.put("/memory/:sessionId/prefs", async (req, res) => {
  const { sessionId } = req.params;
  const updates = req.body as Record<string, string>;
  if (!SESSION_ID_RE.test(sessionId) || !updates || typeof updates !== "object") {
    res.status(400).json({ error: "Invalid request" }); return;
  }
  try {
    const session = await updatePreferences(sessionId, updates);
    res.json(session);
  } catch (err) {
    logger.error({ err, sessionId }, "Failed to update preferences");
    res.status(500).json({ error: "Failed to update preferences" });
  }
});

// ── DELETE /api/memory/:sessionId ─────────────────────────────────────────────
router.delete("/memory/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  if (!SESSION_ID_RE.test(sessionId)) {
    res.status(400).json({ error: "Invalid session ID" }); return;
  }
  try {
    const session = await clearSession(sessionId);
    res.json({ success: true, session });
  } catch (err) {
    logger.error({ err, sessionId }, "Failed to clear session");
    res.status(500).json({ error: "Failed to clear memory" });
  }
});

// ── GET /api/memory/:sessionId/ltm ────────────────────────────────────────────
router.get("/memory/:sessionId/ltm", async (req, res) => {
  const { sessionId } = req.params;
  if (!SESSION_ID_RE.test(sessionId)) {
    res.status(400).json({ error: "Invalid session ID" }); return;
  }
  try {
    const store = await getLTM(sessionId);
    res.json(store);
  } catch (err) {
    logger.error({ err, sessionId }, "Failed to get LTM");
    res.status(500).json({ error: "Failed to load long-term memory" });
  }
});

// ── DELETE /api/memory/:sessionId/ltm ─────────────────────────────────────────
router.delete("/memory/:sessionId/ltm", async (req, res) => {
  const { sessionId } = req.params;
  if (!SESSION_ID_RE.test(sessionId)) {
    res.status(400).json({ error: "Invalid session ID" }); return;
  }
  try {
    await clearLTM(sessionId);
    res.json({ success: true });
  } catch (err) {
    logger.error({ err, sessionId }, "Failed to clear LTM");
    res.status(500).json({ error: "Failed to clear long-term memory" });
  }
});

// ── DELETE /api/memory/:sessionId/ltm/:entryId ───────────────────────────────
router.delete("/memory/:sessionId/ltm/:entryId", async (req, res) => {
  const { sessionId, entryId } = req.params;
  if (!SESSION_ID_RE.test(sessionId)) {
    res.status(400).json({ error: "Invalid session ID" }); return;
  }
  try {
    const deleted = await deleteEntry(sessionId, entryId);
    res.json({ success: deleted });
  } catch (err) {
    logger.error({ err, sessionId, entryId }, "Failed to delete LTM entry");
    res.status(500).json({ error: "Failed to delete memory entry" });
  }
});

export default router;
