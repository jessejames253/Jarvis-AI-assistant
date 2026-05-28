/**
 * lib/kbApi.ts — Typed API client for the Jarvis Knowledge Base
 *
 * iOS Shortcuts integration:
 *   The same POST /api/kb endpoint is callable from an iOS Shortcut.
 *   Store the sessionId in a Shortcut variable, then POST:
 *     { sessionId, title, content, url, source: "shortcut" | "safari" }
 *   to save anything from any app.
 */

import { getApiBase } from "./apiConfig";

function api(path: string) {
  return `${getApiBase()}api/${path}`;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type NoteType = "note" | "research" | "fact";
export type NoteCategory = "work" | "personal" | "coding" | "ideas" | "research" | "other";
export type NoteSource = "manual" | "chat" | "safari" | "shortcut" | "import";

export interface Note {
  id: string;
  title: string;
  content: string;
  type: NoteType;
  category: NoteCategory;
  tags: string[];
  source: NoteSource;
  url?: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SearchHit {
  note: Note;
  score: number;
  matchedFields: string[];
}

export interface KBStats {
  total: number;
  byType: Record<NoteType, number>;
  byCategory: Record<NoteCategory, number>;
  bySource: Record<NoteSource, number>;
  tags: string[];
}

// ─── Notes ────────────────────────────────────────────────────────────────────

export function fetchNotes(sessionId: string, filters?: {
  q?: string; type?: NoteType; category?: NoteCategory; tags?: string;
}): Promise<Note[]> {
  const params = new URLSearchParams();
  if (filters?.q) params.set("q", filters.q);
  if (filters?.type) params.set("type", filters.type);
  if (filters?.category) params.set("category", filters.category);
  if (filters?.tags) params.set("tags", filters.tags);
  const qs = params.toString();
  return request(api(`kb/${sessionId}${qs ? `?${qs}` : ""}`));
}

export function searchNotes(sessionId: string, q: string): Promise<SearchHit[]> {
  return request(api(`kb/search/${sessionId}?q=${encodeURIComponent(q)}`));
}

export function fetchKBStats(sessionId: string): Promise<KBStats> {
  return request(api(`kb/stats/${sessionId}`));
}

export function createNote(body: {
  sessionId: string;
  title: string;
  content: string;
  type?: NoteType;
  category?: NoteCategory;
  tags?: string[];
  url?: string;
  source?: NoteSource;
}): Promise<Note> {
  return request(api("kb"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function updateNote(
  noteId: string,
  sessionId: string,
  updates: Partial<Pick<Note, "title" | "content" | "type" | "category" | "tags" | "url">>
): Promise<Note> {
  return request(api(`kb/${noteId}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, ...updates }),
  });
}

export function deleteNote(noteId: string, sessionId: string): Promise<{ success: boolean }> {
  return request(api(`kb/${noteId}?sessionId=${encodeURIComponent(sessionId)}`), {
    method: "DELETE",
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export const TYPE_LABELS: Record<NoteType, string> = {
  note: "Note", research: "Research", fact: "Fact",
};

export const TYPE_COLORS: Record<NoteType, string> = {
  note:     "hsl(194 100% 55%)",
  research: "hsl(264 80% 70%)",
  fact:     "hsl(38 100% 60%)",
};

export const TYPE_EMOJIS: Record<NoteType, string> = {
  note: "📝", research: "🔗", fact: "💡",
};

export const CATEGORY_LABELS: Record<NoteCategory, string> = {
  work: "Work", personal: "Personal", coding: "Coding",
  ideas: "Ideas", research: "Research", other: "Other",
};

export const SOURCE_LABELS: Record<NoteSource, string> = {
  manual: "Manual", chat: "Chat", safari: "Safari",
  shortcut: "Shortcut", import: "Import",
};
