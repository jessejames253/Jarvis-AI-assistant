/**
 * lib/types.ts — Shared types across the Jarvas agent system
 *
 * Centralising these here means every module (intent classifier, tools,
 * router, responder) imports from one place, keeping the codebase consistent
 * and avoiding circular dependencies.
 */

// ─── Intent ───────────────────────────────────────────────────────────────────

/** Every possible intent Jarvas can detect in a user message */
export type IntentType =
  | "casual"         // Greetings, small talk, wellbeing, thanks, farewell
  | "identity"       // "who are you", "what is Jarvas"
  | "coding"         // Code, debug, scripts, syntax, frameworks
  | "research"       // Web search, current events, news, live data
  | "memory_update"  // "my name is", "remember that", preference updates
  | "math"           // Arithmetic, calculations, equations
  | "planning"       // Tasks, todos, project plans, steps
  | "definition"     // "what is X", "explain X", concept explanations
  | "general";       // Fallback for anything unclassified

/** Result from the intent classifier */
export interface ClassificationResult {
  intent: IntentType;
  confidence: number;        // 0.0 – 1.0 (how sure we are)
  signals: string[];         // Human-readable list of what triggered this intent
  secondaryIntent?: IntentType; // Runner-up (shown in debug panel)
}

// ─── Conversation ─────────────────────────────────────────────────────────────

export interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
}

// ─── Search ───────────────────────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  description: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  answer: string;
  isFake: boolean;
}

// ─── Tool system ──────────────────────────────────────────────────────────────

/** What every tool receives as input */
export interface ToolInput {
  message: string;
  history: HistoryEntry[];
  memoryContext?: {
    summary?: string;
    preferences?: Record<string, string>;
  };
  classification: ClassificationResult;
}

/** What every tool returns */
export interface ToolOutput {
  response: string;
  action: string;       // Specific action taken, e.g. "code_debugger"
  mode: string;         // Assistant mode, e.g. "coding_assistant"
  reasoning: string[];  // Step-by-step reasoning path (shown in debug panel)
  sources?: SearchResult[];
  isSearch?: boolean;
  isFakeSearch?: boolean;
  sideEffects?: {
    updatePreferences?: Record<string, string>; // Applied by the route after the tool runs
  };
}

/** Tool descriptor — every tool module exports one of these */
export interface Tool {
  name: string;
  description: string;
  handles: IntentType[];
  execute: (input: ToolInput) => Promise<ToolOutput>;
}

// ─── Debug info ───────────────────────────────────────────────────────────────

/** Attached to every chat response so the frontend debug panel can show it */
export interface DebugInfo {
  intent: IntentType;
  secondaryIntent?: IntentType;
  confidence: number;
  signals: string[];
  action: string;
  mode: string;
  memoryUsed: boolean;
  reasoning: string[];
  processingMs: number;
}
