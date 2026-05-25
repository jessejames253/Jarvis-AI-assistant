/**
 * lib/memory.ts — Jarvas persistent memory store
 *
 * Manages long-term memory for each chat session:
 *   - Stores the full message history (user + assistant turns)
 *   - Auto-summarizes older messages so the context stays compact
 *   - Persists user preferences (name, style, etc.)
 *   - Clears / resets a session on demand
 *
 * ─── STORAGE BACKEND ───────────────────────────────────────────────────────
 * Currently uses the local filesystem (one JSON file per session).
 * To swap to a database (Postgres, Redis, etc.) or a vector store:
 *   1. Keep all the exported function signatures identical
 *   2. Replace the implementation of readSession / writeSession
 *   3. Nothing else in the codebase needs to change
 *
 * ─── AI INTEGRATION NOTE ──────────────────────────────────────────────────
 * The `summary` field is designed to be passed as a system prompt prefix
 * when connecting a real AI model. The model sees:
 *   "Earlier in this conversation: <summary>"
 *   followed by the last N full messages.
 * This keeps the token count bounded while preserving long-term context.
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

// Where session files are stored. This path persists across server restarts
// in the Replit environment. Files are not committed to git.
const DATA_DIR = "/home/runner/workspace/.jarvas-data/sessions";

// ─── Public types ─────────────────────────────────────────────────────────────

/** A single saved message turn */
export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string; // ISO 8601
}

/** Per-user preferences stored with their session */
export interface UserPreferences {
  name?: string;                       // User's preferred name
  [key: string]: string | undefined;   // Extensible for future preferences
}

/** The full memory object for one chat session */
export interface SessionMemory {
  sessionId: string;
  messages: StoredMessage[];     // Recent messages kept in full
  summary: string | null;        // Auto-generated summary of older messages
  preferences: UserPreferences;
  messageCount: number;          // Total messages ever (including summarized)
  createdAt: string;
  updatedAt: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function ensureDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

/** Returns the file path for a given session, sanitizing the ID first */
function sessionPath(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9\-]/g, "").slice(0, 64);
  return path.join(DATA_DIR, `${safe}.json`);
}

async function readSession(sessionId: string): Promise<SessionMemory | null> {
  await ensureDir();
  try {
    const raw = await readFile(sessionPath(sessionId), "utf-8");
    return JSON.parse(raw) as SessionMemory;
  } catch {
    return null; // File doesn't exist yet
  }
}

async function writeSession(session: SessionMemory): Promise<void> {
  await ensureDir();
  session.updatedAt = new Date().toISOString();
  await writeFile(sessionPath(session.sessionId), JSON.stringify(session, null, 2), "utf-8");
}

// ─── Auto-summarization ───────────────────────────────────────────────────────

const SUMMARIZE_THRESHOLD = 20; // Summarize when session exceeds this many messages
const MESSAGES_TO_KEEP = 8;     // Keep this many recent messages in full after summarization

/**
 * Builds a plain-text summary of a set of messages.
 * Designed so a real AI can later replace this with a proper abstractive summary.
 */
function buildSummary(messages: StoredMessage[], existingSummary: string | null): string {
  const userMessages = messages.filter((m) => m.role === "user");
  const topics = userMessages.map((m) =>
    `- "${m.content.replace(/\s+/g, " ").trim().slice(0, 100)}"`
  );

  const header = existingSummary
    ? `${existingSummary}\n\nAdditionally, the user asked about:`
    : "Earlier in this conversation, the user asked about:";

  return `${header}\n${topics.join("\n")}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Fetches a session, or returns null if it doesn't exist yet */
export async function getSession(sessionId: string): Promise<SessionMemory | null> {
  return readSession(sessionId);
}

/** Fetches a session, creating a blank one if it doesn't exist */
export async function getOrCreateSession(sessionId: string): Promise<SessionMemory> {
  const existing = await readSession(sessionId);
  if (existing) return existing;

  const fresh: SessionMemory = {
    sessionId,
    messages: [],
    summary: null,
    preferences: {},
    messageCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeSession(fresh);
  return fresh;
}

/**
 * Appends a message to a session and auto-summarizes if the session is long.
 * Returns the updated session.
 */
export async function appendMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string
): Promise<SessionMemory> {
  const session = await getOrCreateSession(sessionId);

  session.messages.push({
    role,
    content,
    timestamp: new Date().toISOString(),
  });
  session.messageCount++;

  // Auto-summarize: compress old messages into a summary when the history grows long
  if (session.messages.length > SUMMARIZE_THRESHOLD) {
    const toSummarize = session.messages.slice(0, session.messages.length - MESSAGES_TO_KEEP);
    const toKeep = session.messages.slice(session.messages.length - MESSAGES_TO_KEEP);
    session.summary = buildSummary(toSummarize, session.summary);
    session.messages = toKeep;
  }

  await writeSession(session);
  return session;
}

/**
 * Updates one or more user preferences for a session.
 * Merges with existing preferences (doesn't overwrite unrelated keys).
 */
export async function updatePreferences(
  sessionId: string,
  updates: Partial<UserPreferences>
): Promise<SessionMemory> {
  const session = await getOrCreateSession(sessionId);
  session.preferences = { ...session.preferences, ...updates };
  await writeSession(session);
  return session;
}

/**
 * Wipes all messages, summary, and preferences for a session.
 * The session ID and creation date are preserved.
 */
export async function clearSession(sessionId: string): Promise<SessionMemory> {
  const session = await getOrCreateSession(sessionId);
  session.messages = [];
  session.summary = null;
  session.preferences = {};
  session.messageCount = 0;
  await writeSession(session);
  return session;
}
