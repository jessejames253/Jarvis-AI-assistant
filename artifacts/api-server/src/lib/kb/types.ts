/**
 * lib/kb/types.ts — Knowledge Base data models
 *
 * Designed for iOS Shortcuts / Safari Share Sheet compatibility:
 *   - POST /api/kb with { source: "safari", url, title, content, sessionId }
 *     from a Share Sheet action to save any webpage as a research note.
 *   - POST /api/kb with { source: "shortcut", ... } from an iOS Shortcut.
 *   - The sessionId can be stored in a Shortcut variable for persistent identity.
 *
 * Keep field names stable — changing them will break saved Shortcuts.
 */

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
  url?: string;           // For research links saved from Safari / browser
  sessionId: string;
  createdAt: string;
  updatedAt: string;
}

/** The full on-disk store for one session */
export interface KBStore {
  sessionId: string;
  notes: Note[];
  updatedAt: string;
}

/** Shape of create-note body (also used by iOS Shortcuts) */
export interface CreateNoteBody {
  sessionId: string;
  title: string;
  content: string;
  type?: NoteType;
  category?: NoteCategory;
  tags?: string[];
  source?: NoteSource;
  url?: string;
}

/** Shape of update-note body (sessionId is required in HTTP body but passed separately to the manager) */
export interface UpdateNoteBody {
  sessionId?: string;
  title?: string;
  content?: string;
  type?: NoteType;
  category?: NoteCategory;
  tags?: string[];
  url?: string;
}

/** A scored search result — used internally and returned by search API */
export interface SearchHit {
  note: Note;
  score: number;          // 0.0–1.0 relevance score
  matchedFields: string[];
}
