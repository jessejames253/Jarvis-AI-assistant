/**
 * lib/kb/manager.ts — CRUD and full-text search for the Knowledge Base
 *
 * Search algorithm (simple TF-IDF-like scoring):
 *   - Tokenise the query into lowercase words
 *   - For each note, score: title match (3×), tag match (2×), content match (1×)
 *   - Normalise to 0–1 and return notes above a relevance threshold
 *
 * AI INTEGRATION NOTE:
 *   Replace searchNotes() with a vector-similarity search over note embeddings
 *   for much more accurate semantic retrieval. The rest of the manager is stable.
 */

import { getOrCreateKBStore, writeKBStore } from "./storage";
import type { Note, CreateNoteBody, UpdateNoteBody, SearchHit, NoteCategory, NoteType, NoteSource } from "./types";

function uuid(): string {
  return crypto.randomUUID();
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function getNotes(sessionId: string): Promise<Note[]> {
  const store = await getOrCreateKBStore(sessionId);
  return store.notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getNote(sessionId: string, noteId: string): Promise<Note | null> {
  const store = await getOrCreateKBStore(sessionId);
  return store.notes.find((n) => n.id === noteId) ?? null;
}

export async function createNote(body: CreateNoteBody): Promise<Note> {
  const store = await getOrCreateKBStore(body.sessionId);
  const now = new Date().toISOString();
  const note: Note = {
    id: uuid(),
    title: body.title,
    content: body.content,
    type: body.type ?? "note",
    category: body.category ?? "personal",
    tags: (body.tags ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean),
    source: body.source ?? "manual",
    url: body.url,
    sessionId: body.sessionId,
    createdAt: now,
    updatedAt: now,
  };
  store.notes.push(note);
  await writeKBStore(store);
  return note;
}

export async function updateNote(
  sessionId: string,
  noteId: string,
  updates: UpdateNoteBody
): Promise<Note | null> {
  const store = await getOrCreateKBStore(sessionId);
  const idx = store.notes.findIndex((n) => n.id === noteId);
  if (idx === -1) return null;

  const existing = store.notes[idx];
  store.notes[idx] = {
    ...existing,
    ...(updates.title !== undefined && { title: updates.title }),
    ...(updates.content !== undefined && { content: updates.content }),
    ...(updates.type !== undefined && { type: updates.type }),
    ...(updates.category !== undefined && { category: updates.category }),
    ...(updates.tags !== undefined && { tags: updates.tags.map((t) => t.toLowerCase().trim()).filter(Boolean) }),
    ...(updates.url !== undefined && { url: updates.url }),
    updatedAt: new Date().toISOString(),
  };

  await writeKBStore(store);
  return store.notes[idx];
}

export async function deleteNote(sessionId: string, noteId: string): Promise<boolean> {
  const store = await getOrCreateKBStore(sessionId);
  const before = store.notes.length;
  store.notes = store.notes.filter((n) => n.id !== noteId);
  if (store.notes.length === before) return false;
  await writeKBStore(store);
  return true;
}

// ─── Search ───────────────────────────────────────────────────────────────────

/** Tokenise text into lowercase words, filtering stop-words and short tokens */
function tokenise(text: string): string[] {
  const STOP = new Set(["a", "an", "the", "is", "are", "was", "were", "be", "been",
    "to", "of", "in", "on", "at", "by", "for", "with", "and", "or", "but", "not",
    "it", "its", "this", "that", "do", "does", "did", "i", "me", "my", "we", "you"]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** Count how many query tokens appear in a list of text tokens */
function countMatches(queryTokens: string[], textTokens: string[]): number {
  const textSet = new Set(textTokens);
  return queryTokens.filter((q) =>
    textSet.has(q) || [...textSet].some((t) => t.includes(q) || q.includes(t))
  ).length;
}

/**
 * Full-text search across all notes for a session.
 * Returns the top `limit` hits above a relevance threshold, sorted by score.
 */
export async function searchNotes(
  sessionId: string,
  query: string,
  limit = 5
): Promise<SearchHit[]> {
  const store = await getOrCreateKBStore(sessionId);
  if (!store.notes.length || !query.trim()) return [];

  const queryTokens = tokenise(query);
  if (!queryTokens.length) return [];

  const hits: SearchHit[] = [];

  for (const note of store.notes) {
    const matchedFields: string[] = [];
    let raw = 0;

    // Title match (weight 3)
    const titleTokens = tokenise(note.title);
    const titleMatches = countMatches(queryTokens, titleTokens);
    if (titleMatches > 0) {
      raw += titleMatches * 3;
      matchedFields.push("title");
    }

    // Tag match (weight 2)
    const tagTokens = note.tags.flatMap((t) => tokenise(t));
    const tagMatches = countMatches(queryTokens, tagTokens);
    if (tagMatches > 0) {
      raw += tagMatches * 2;
      matchedFields.push("tags");
    }

    // Content match (weight 1)
    const contentTokens = tokenise(note.content);
    const contentMatches = countMatches(queryTokens, contentTokens);
    if (contentMatches > 0) {
      raw += contentMatches;
      matchedFields.push("content");
    }

    if (raw === 0) continue;

    // Normalise: max possible score = queryTokens * 3 (all in title)
    const maxPossible = queryTokens.length * 3;
    const score = Math.min(raw / maxPossible, 1.0);

    if (score > 0.05) {
      hits.push({ note, score, matchedFields });
    }
  }

  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Returns all unique tags used across all notes in a session */
export async function getAllTags(sessionId: string): Promise<string[]> {
  const store = await getOrCreateKBStore(sessionId);
  const tagSet = new Set<string>();
  for (const note of store.notes) {
    note.tags.forEach((t) => tagSet.add(t));
  }
  return [...tagSet].sort();
}

/** Returns note counts grouped by type and category */
export async function getKBStats(sessionId: string): Promise<{
  total: number;
  byType: Record<NoteType, number>;
  byCategory: Record<NoteCategory, number>;
  bySource: Record<NoteSource, number>;
  tags: string[];
}> {
  const store = await getOrCreateKBStore(sessionId);
  const notes = store.notes;

  const byType: Record<NoteType, number> = { note: 0, research: 0, fact: 0 };
  const byCategory: Record<NoteCategory, number> = {
    work: 0, personal: 0, coding: 0, ideas: 0, research: 0, other: 0,
  };
  const bySource: Record<NoteSource, number> = {
    manual: 0, chat: 0, safari: 0, shortcut: 0, import: 0,
  };
  const tagSet = new Set<string>();

  for (const n of notes) {
    byType[n.type]++;
    byCategory[n.category]++;
    bySource[n.source]++;
    n.tags.forEach((t) => tagSet.add(t));
  }

  return { total: notes.length, byType, byCategory, bySource, tags: [...tagSet].sort() };
}
