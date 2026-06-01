/**
 * lib/ltm/store.ts — Long-term memory store
 *
 * Cross-session persistent facts organized into semantic categories.
 * Each session has one JSON file containing all extracted facts.
 *
 * Categories:
 *   personal    — name, age, location, occupation, interests
 *   coding      — preferred languages, tools, frameworks, patterns
 *   projects    — ongoing projects, goals, codebases the user is working on
 *   preferences — communication style, format, response preferences
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { resolveDataDir } from "../rootResolver";

const DATA_DIR = resolveDataDir(".jarvas-data/ltm");

export type MemoryCategory = "personal" | "coding" | "projects" | "preferences";

export interface LTMEntry {
  id: string;
  category: MemoryCategory;
  content: string;              // Declarative fact, e.g. "User's name is Alice"
  source: "auto" | "explicit"; // auto = AI extracted, explicit = user "remember that…"
  tags: string[];               // Keywords for relevance matching
  createdAt: string;
  updatedAt: string;
}

export interface LTMStore {
  sessionId: string;
  entries: LTMEntry[];
  updatedAt: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function ensureDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

function ltmPath(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9\-]/g, "").slice(0, 64);
  return path.join(DATA_DIR, `${safe}.json`);
}

async function readStore(sessionId: string): Promise<LTMStore | null> {
  await ensureDir();
  try {
    const raw = await readFile(ltmPath(sessionId), "utf-8");
    return JSON.parse(raw) as LTMStore;
  } catch {
    return null;
  }
}

async function writeStore(store: LTMStore): Promise<void> {
  await ensureDir();
  store.updatedAt = new Date().toISOString();
  await writeFile(ltmPath(store.sessionId), JSON.stringify(store, null, 2), "utf-8");
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getLTM(sessionId: string): Promise<LTMStore> {
  return (await readStore(sessionId)) ?? { sessionId, entries: [], updatedAt: new Date().toISOString() };
}

/**
 * Adds a new fact, or updates an existing one if it's semantically very similar
 * (same category + ≥50% word overlap) to avoid growing duplicate entries.
 */
export async function addOrUpdateEntry(
  sessionId: string,
  entry: Omit<LTMEntry, "id" | "createdAt" | "updatedAt">,
): Promise<LTMEntry> {
  const store = await getLTM(sessionId);

  const meaningful = (s: string) => s.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const newWords = new Set(meaningful(entry.content));

  const duplicate = store.entries.find((e) => {
    if (e.category !== entry.category) return false;
    const eWords = new Set(meaningful(e.content));
    const shared = [...newWords].filter((w) => eWords.has(w)).length;
    const threshold = Math.min(newWords.size, eWords.size) * 0.5;
    return shared >= threshold && threshold > 0;
  });

  if (duplicate) {
    duplicate.content = entry.content;
    duplicate.tags = [...new Set([...duplicate.tags, ...entry.tags])];
    duplicate.updatedAt = new Date().toISOString();
    await writeStore(store);
    return duplicate;
  }

  const newEntry: LTMEntry = {
    id: randomUUID().slice(0, 8),
    ...entry,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.entries.push(newEntry);
  await writeStore(store);
  return newEntry;
}

export async function deleteEntry(sessionId: string, entryId: string): Promise<boolean> {
  const store = await getLTM(sessionId);
  const before = store.entries.length;
  store.entries = store.entries.filter((e) => e.id !== entryId);
  if (store.entries.length < before) {
    await writeStore(store);
    return true;
  }
  return false;
}

/**
 * Deletes entries whose content or tags overlap with the query keywords.
 * Returns number of entries removed.
 */
export async function deleteMatchingEntries(sessionId: string, query: string): Promise<number> {
  const store = await getLTM(sessionId);
  const before = store.entries.length;
  const qWords = new Set(query.toLowerCase().split(/\W+/).filter((w) => w.length > 2));

  store.entries = store.entries.filter((e) => {
    const haystack = (e.content + " " + e.tags.join(" ")).toLowerCase().split(/\W+/);
    const overlap = haystack.filter((w) => qWords.has(w)).length;
    return overlap === 0; // keep entries with no overlap
  });

  const deleted = before - store.entries.length;
  if (deleted > 0) await writeStore(store);
  return deleted;
}

/** Removes the N most recently added entries. Used for "forget this/that". */
export async function deleteRecentEntries(sessionId: string, count = 2): Promise<number> {
  const store = await getLTM(sessionId);
  if (store.entries.length === 0) return 0;

  const sorted = [...store.entries].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const toDelete = new Set(sorted.slice(0, count).map((e) => e.id));
  store.entries = store.entries.filter((e) => !toDelete.has(e.id));
  await writeStore(store);
  return toDelete.size;
}

export async function clearLTM(sessionId: string): Promise<void> {
  const store = await getLTM(sessionId);
  store.entries = [];
  await writeStore(store);
}

/**
 * Returns the top-N most relevant entries for a query using keyword overlap.
 * Falls back to returning all entries (up to topN) if no keywords match.
 */
export function rankEntries(entries: LTMEntry[], query: string, topN = 8): LTMEntry[] {
  const qWords = new Set(query.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  if (qWords.size === 0) return entries.slice(0, topN);

  const scored = entries.map((e) => {
    const haystack = (e.content + " " + e.tags.join(" ")).toLowerCase().split(/\W+/);
    const score = haystack.filter((w) => qWords.has(w)).length;
    return { entry: e, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const relevant = scored.filter((s) => s.score > 0);
  return (relevant.length > 0 ? relevant : scored).slice(0, topN).map((s) => s.entry);
}
