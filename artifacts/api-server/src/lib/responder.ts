/**
 * lib/responder.ts — Public API for the Jarvis agent system
 *
 * This is the single entry point that routes/chat.ts calls.
 * It delegates everything to lib/router.ts, which handles
 * intent classification → tool selection → execution.
 *
 * ─── TO CONNECT A REAL AI MODEL ────────────────────────────────────────────
 * Option A (replace the whole engine):
 *   Replace router.ts with a direct call to an AI SDK.
 *   The debug metadata will need to come from the model's response object.
 *
 * Option B (keep the tool system, add AI per-tool):
 *   Update individual tool files to use AI for their responses.
 *   For example, update lib/tools/knowledge.ts to call GPT-4o instead of
 *   the static knowledge base. The routing and debug infrastructure stays.
 *
 * Option C (use AI for intent classification only):
 *   Replace lib/intent.ts with an AI-powered classifier.
 *   Tools still run locally but get much more accurate intent signals.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { route } from "./router";
import type { HistoryEntry, DebugInfo, SearchResult } from "./types";

// Re-export types that routes/chat.ts needs
export type { HistoryEntry, DebugInfo, SearchResult };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChatInput {
  message: string;
  history: HistoryEntry[];
  memoryContext?: {
    summary?: string;
    preferences?: Record<string, string>;
  };
}

export interface ChatOutput {
  response: string;
  model: string;
  sources?: SearchResult[];
  isSearch?: boolean;
  isFakeSearch?: boolean;
  debug: DebugInfo;
  sideEffects?: {
    updatePreferences?: Record<string, string>;
  };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function complete(input: ChatInput): Promise<ChatOutput> {
  const result = await route(input);

  return {
    response: result.response,
    model: "claude-sonnet-4-6",
    sources: result.sources,
    isSearch: result.isSearch,
    isFakeSearch: result.isFakeSearch,
    debug: result.debug,
    sideEffects: result.sideEffects,
  };
}
