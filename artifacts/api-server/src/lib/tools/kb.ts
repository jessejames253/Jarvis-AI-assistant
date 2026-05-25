/**
 * lib/tools/kb.ts — Knowledge Base agent tool
 *
 * Handles explicit knowledge_base intent:
 *   "search my notes for X"     → search and list matching notes
 *   "what did I save about X"   → search + summarise
 *   "save this as a note: ..."  → create note from chat
 *   "save this fact: ..."       → create fact note
 *   "how many notes do I have"  → KB stats
 *
 * The router also injects relevant KB notes into memoryContext.kbNotes for
 * ALL intents, so other tools (knowledge, research) can reference them too.
 */

import type { Tool, ToolInput, ToolOutput } from "../types";
import { searchNotes, createNote, getKBStats } from "../kb/manager";
import type { Note } from "../kb/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function typeEmoji(type: string): string {
  return { note: "📝", research: "🔗", fact: "💡" }[type] ?? "📄";
}

function formatNoteForChat(note: Note): string {
  const emoji = typeEmoji(note.type);
  const tags = note.tags.length ? ` [${note.tags.join(", ")}]` : "";
  const url = note.url ? `\n  🔗 ${note.url}` : "";
  const preview = note.content.length > 200
    ? note.content.slice(0, 200).trim() + "…"
    : note.content;
  return `${emoji} **${note.title}**${tags}\n${preview}${url}`;
}

// ─── Sub-handlers ─────────────────────────────────────────────────────────────

async function handleSearch(query: string, sessionId: string): Promise<ToolOutput> {
  const hits = await searchNotes(sessionId, query, 5);

  if (hits.length === 0) {
    return {
      response: `Nothing in your Knowledge Base matched "${query}". You can add notes from the Knowledge Base page, or tell me "save this as a note: …"`,
      action: "kb_search_empty",
      mode: "knowledge_base",
      reasoning: [`Searched KB for "${query}"`, "No matches found"],
    };
  }

  const formatted = hits.map((h, i) => `${i + 1}. ${formatNoteForChat(h.note)}`).join("\n\n");
  const topNote = hits[0];

  return {
    response: `Found **${hits.length} note${hits.length > 1 ? "s" : ""}** matching "${query}":\n\n${formatted}`,
    action: "kb_search_results",
    mode: "knowledge_base",
    reasoning: [
      `Searched KB for "${query}"`,
      `Top result: "${topNote.note.title}" (score ${topNote.score.toFixed(2)})`,
      `Matched fields: ${topNote.matchedFields.join(", ")}`,
    ],
  };
}

async function handleSave(msg: string, sessionId: string, type: "note" | "fact" = "note"): Promise<ToolOutput> {
  // Extract content: strip the "save this (as a|as) note/fact:" prefix
  const content = msg
    .replace(/^(save|add|store|create|remember)\s+(this\s+)?(as\s+a?\s+)?(note|fact|idea|research)\s*:?\s*/i, "")
    .replace(/^(note|fact|idea)\s*:\s*/i, "")
    .trim();

  if (!content || content.length < 3) {
    return {
      response: `What would you like me to save? Tell me: "save this as a note: <your note content>"`,
      action: "kb_save_empty",
      mode: "knowledge_base",
      reasoning: ["Detected save intent but no content found"],
    };
  }

  // Auto-generate a short title from first sentence
  const title = content.split(/[.!?\n]/)[0].slice(0, 80).trim() || "Untitled note";

  const note = await createNote({
    sessionId,
    title,
    content,
    type,
    source: "chat",
  });

  return {
    response: `${typeEmoji(note.type)} Saved to your Knowledge Base: **"${note.title}"**\n\nYou can view, edit, or search it from the Knowledge Base page.`,
    action: "kb_save",
    mode: "knowledge_base",
    reasoning: [
      `Detected save intent (type: ${type})`,
      `Auto-generated title: "${title}"`,
      "Saved with source: chat",
    ],
  };
}

async function handleStats(sessionId: string): Promise<ToolOutput> {
  const stats = await getKBStats(sessionId);

  if (stats.total === 0) {
    return {
      response: "Your Knowledge Base is empty. Start adding notes, research links, or facts — either from the Knowledge Base page or by saying \"save this as a note: …\" here in chat.",
      action: "kb_stats_empty",
      mode: "knowledge_base",
      reasoning: ["KB is empty"],
    };
  }

  const topTags = stats.tags.slice(0, 5).join(", ");
  return {
    response: `Your Knowledge Base has **${stats.total} note${stats.total > 1 ? "s" : ""}**:\n\n📝 Notes: ${stats.byType.note} · 🔗 Research: ${stats.byType.research} · 💡 Facts: ${stats.byType.fact}\n\n${topTags ? `Tags: ${topTags}` : "No tags yet"}`,
    action: "kb_stats",
    mode: "knowledge_base",
    reasoning: ["Fetched KB stats"],
  };
}

// ─── Use injected KB notes (called by other tools via kbNotes context) ─────────

export function formatKBContext(notes: Note[]): string {
  if (!notes.length) return "";
  const items = notes.map((n) => `• **${n.title}**: ${n.content.slice(0, 300)}`).join("\n");
  return `From your Knowledge Base:\n${items}\n\n`;
}

// ─── Main execute ─────────────────────────────────────────────────────────────

export const kbTool: Tool = {
  name: "kb",
  description: "Searches, saves, and manages the personal Knowledge Base",
  handles: ["knowledge_base"],

  async execute(input: ToolInput): Promise<ToolOutput> {
    const msg = input.message;
    const lower = msg.toLowerCase();
    const sessionId = input.memoryContext?.sessionId ?? "default";

    // Save a note
    if (/\b(save|add|store|create|remember)\b.*\b(note|fact|idea|research)\b/.test(lower)) {
      const type = /\bfact\b/.test(lower) ? "fact" : /\bresearch\b/.test(lower) ? "note" : "note";
      return handleSave(msg, sessionId, type);
    }

    // Stats
    if (/\b(how many|count|stats|overview)\b.*\b(note|kb|knowledge)\b/.test(lower)) {
      return handleStats(sessionId);
    }

    // Search — extract query from message
    const searchQuery = msg
      .replace(/^(search|find|look up|what did i (save|note|write) about|show me notes about|notes on)\s*/i, "")
      .replace(/\s+in (my )?(notes|kb|knowledge base)$/i, "")
      .replace(/\?$/, "")
      .trim();

    return handleSearch(searchQuery || msg, sessionId);
  },
};
