/**
 * lib/router.ts — Action router
 *
 * The central orchestrator of the Jarvas agent system.
 * Given a message and its context, it:
 *   1. Classifies the user's intent
 *   2. Selects the appropriate tool from the registry
 *   3. Runs the tool
 *   4. Packages the response with full debug metadata
 *
 * This is the only file that knows about both classification AND tooling.
 * The HTTP route (routes/chat.ts) is agnostic to how routing works.
 */

import { classifyIntent } from "./intent";
import { getTool } from "./tools/registry";
import { searchNotes } from "./kb/manager";
import type { HistoryEntry, DebugInfo, SearchResult, ToolInput } from "./types";

// ─── I/O types ────────────────────────────────────────────────────────────────

export interface RouterInput {
  message: string;
  history: HistoryEntry[];
  memoryContext?: {
    summary?: string;
    preferences?: Record<string, string>;
  };
}

export interface RouterOutput {
  response: string;
  sources?: SearchResult[];
  isSearch?: boolean;
  isFakeSearch?: boolean;
  debug: DebugInfo;
  sideEffects?: {
    updatePreferences?: Record<string, string>;
  };
}

// ─── Main route function ─────────────────────────────────────────────────────

/**
 * Routes a message through intent classification → tool selection → execution.
 * Returns the tool's response plus rich debug metadata.
 */
export async function route(input: RouterInput): Promise<RouterOutput> {
  const startTime = Date.now();

  // Step 1: Classify the intent of the user's message
  const classification = classifyIntent(input.message, input.history);

  // Step 2: Look up the tool that handles this intent
  const tool = getTool(classification.intent);

  // Step 3: Build the tool input (includes memory context for personalization)
  const toolInput: ToolInput = {
    message: input.message,
    history: input.history,
    memoryContext: { ...(input.memoryContext ?? {}) },
    classification,
  };

  // Step 3b: KB injection — search the personal Knowledge Base and attach
  // relevant notes to memoryContext.kbNotes so any tool can reference them.
  // This is what makes Jarvas consult your own notes before external sources.
  const sessionId = toolInput.memoryContext?.sessionId;
  if (sessionId && classification.intent !== "casual" && classification.intent !== "identity") {
    try {
      const hits = await searchNotes(sessionId, input.message, 3);
      if (hits.length > 0 && hits[0].score > 0.15) {
        toolInput.memoryContext!.kbNotes = hits.map((h) => ({
          id: h.note.id,
          title: h.note.title,
          content: h.note.content,
          type: h.note.type,
          tags: h.note.tags,
          url: h.note.url,
        }));
      }
    } catch {
      // KB search failure should never block a chat response
    }
  }

  // Step 4: Execute the tool
  const toolOutput = await tool.execute(toolInput);

  const processingMs = Date.now() - startTime;
  const memoryUsed = !!(
    input.memoryContext?.summary || input.memoryContext?.preferences
  );

  return {
    response: toolOutput.response,
    sources: toolOutput.sources,
    isSearch: toolOutput.isSearch,
    isFakeSearch: toolOutput.isFakeSearch,
    sideEffects: toolOutput.sideEffects,
    debug: {
      intent: classification.intent,
      secondaryIntent: classification.secondaryIntent,
      confidence: classification.confidence,
      signals: classification.signals,
      action: toolOutput.action,
      mode: toolOutput.mode,
      memoryUsed,
      reasoning: toolOutput.reasoning,
      processingMs,
    },
  };
}
