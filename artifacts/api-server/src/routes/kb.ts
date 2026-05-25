/**
 * routes/kb.ts — Knowledge Base REST API
 *
 * iOS Shortcuts / Safari Share Sheet compatible:
 *   POST /api/kb  { sessionId, title, content, type?, category?, tags?, url?, source? }
 *   → creates a note, returns the created Note object
 *
 * To save from a Safari Share Sheet:
 *   POST /api/kb with { sessionId: "<stored in Shortcut>", title: "<page title>",
 *                       content: "<selected text>", url: "<page URL>", source: "safari" }
 *
 * GET    /api/kb/:sessionId              — list all notes (supports ?q=&type=&category=&tags=)
 * GET    /api/kb/search/:sessionId       — full-text search: ?q=<query>
 * GET    /api/kb/note/:noteId            — get single note (requires ?sessionId=)
 * POST   /api/kb                         — create note
 * PATCH  /api/kb/:noteId                 — update note
 * DELETE /api/kb/:noteId                 — delete note (requires ?sessionId=)
 * GET    /api/kb/stats/:sessionId        — note counts by type/category/source + tags
 */

import { Router, type RequestHandler } from "express";
import {
  getNotes, getNote, createNote, updateNote, deleteNote,
  searchNotes, getKBStats,
} from "../lib/kb/manager";
import type { UpdateNoteBody } from "../lib/kb/types";

const router = Router();

// ─── Stats (must be before /:sessionId to avoid param collision) ──────────────

const kbStats: RequestHandler = async (req, res) => {
  try {
    const stats = await getKBStats(String(req.params.sessionId));
    res.json(stats);
  } catch (err) {
    console.error("[kb] stats error:", err);
    res.status(500).json({ error: "Failed to fetch KB stats" });
  }
};
router.get("/kb/stats/:sessionId", kbStats);

// ─── Search ───────────────────────────────────────────────────────────────────

const kbSearch: RequestHandler = async (req, res) => {
  try {
    const q = req.query.q as string;
    if (!q?.trim()) { res.json([]); return; }
    const hits = await searchNotes(String(req.params.sessionId), q, 10);
    res.json(hits);
  } catch (err) {
    console.error("[kb] search error:", err);
    res.status(500).json({ error: "Search failed" });
  }
};
router.get("/kb/search/:sessionId", kbSearch);

// ─── Single note ──────────────────────────────────────────────────────────────

const kbGetNote: RequestHandler = async (req, res) => {
  try {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) { res.status(400).json({ error: "sessionId required" }); return; }
    const note = await getNote(sessionId, String(req.params.noteId));
    if (!note) { res.status(404).json({ error: "Note not found" }); return; }
    res.json(note);
  } catch (err) {
    console.error("[kb] get note error:", err);
    res.status(500).json({ error: "Failed to fetch note" });
  }
};
router.get("/kb/note/:noteId", kbGetNote);

// ─── List all notes ───────────────────────────────────────────────────────────

const kbList: RequestHandler = async (req, res) => {
  try {
    const sid = String(req.params.sessionId);
    let notes = await getNotes(sid);

    const { q, type, category, tags } = req.query as Record<string, string>;
    if (q?.trim()) {
      const hits = await searchNotes(sid, q);
      const hitIds = new Set(hits.map((h) => h.note.id));
      notes = notes.filter((n) => hitIds.has(n.id));
    }
    if (type) notes = notes.filter((n) => n.type === type);
    if (category) notes = notes.filter((n) => n.category === category);
    if (tags) {
      const tagList = tags.split(",").map((t) => t.trim().toLowerCase());
      notes = notes.filter((n) => tagList.some((t) => n.tags.includes(t)));
    }

    res.json(notes);
  } catch (err) {
    console.error("[kb] list error:", err);
    res.status(500).json({ error: "Failed to fetch notes" });
  }
};
router.get("/kb/:sessionId", kbList);

// ─── Create note ──────────────────────────────────────────────────────────────

const kbCreate: RequestHandler = async (req, res) => {
  try {
    const { sessionId, title, content, ...rest } = req.body as Record<string, string>;
    if (!sessionId || !title || !content) {
      res.status(400).json({ error: "sessionId, title, and content are required" });
      return;
    }
    const note = await createNote({ sessionId, title, content, ...rest } as Parameters<typeof createNote>[0]);
    res.status(201).json(note);
  } catch (err) {
    console.error("[kb] create error:", err);
    res.status(500).json({ error: "Failed to create note" });
  }
};
router.post("/kb", kbCreate);

// ─── Update note ──────────────────────────────────────────────────────────────

const kbUpdate: RequestHandler = async (req, res) => {
  try {
    const { sessionId, ...updates } = req.body as { sessionId?: string } & UpdateNoteBody;
    if (!sessionId) { res.status(400).json({ error: "sessionId is required" }); return; }
    const note = await updateNote(sessionId, String(req.params.noteId), updates);
    if (!note) { res.status(404).json({ error: "Note not found" }); return; }
    res.json(note);
  } catch (err) {
    console.error("[kb] update error:", err);
    res.status(500).json({ error: "Failed to update note" });
  }
};
router.patch("/kb/:noteId", kbUpdate);

// ─── Delete note ──────────────────────────────────────────────────────────────

const kbDelete: RequestHandler = async (req, res) => {
  try {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) { res.status(400).json({ error: "sessionId query param required" }); return; }
    const ok = await deleteNote(sessionId, String(req.params.noteId));
    if (!ok) { res.status(404).json({ error: "Note not found" }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error("[kb] delete error:", err);
    res.status(500).json({ error: "Failed to delete note" });
  }
};
router.delete("/kb/:noteId", kbDelete);

export default router;
