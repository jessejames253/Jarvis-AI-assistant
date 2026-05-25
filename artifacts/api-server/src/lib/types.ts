/**
 * lib/types.ts — Shared types across the Jarvis agent system
 */

// ─── Intent ───────────────────────────────────────────────────────────────────

export type IntentType =
  | "casual"
  | "identity"
  | "coding"
  | "research"
  | "memory_update"
  | "math"
  | "planning"
  | "task_management"
  | "knowledge_base"
  | "definition"
  | "general";

export interface ClassificationResult {
  intent: IntentType;
  confidence: number;
  signals: string[];
  secondaryIntent?: IntentType;
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

export interface KBNoteSnapshot {
  id: string;
  title: string;
  content: string;
  type: string;
  tags: string[];
  url?: string;
}

export interface LTMFactSnapshot {
  id: string;
  category: "personal" | "coding" | "projects" | "preferences";
  content: string;
  tags: string[];
}

export interface ToolInput {
  message: string;
  history: HistoryEntry[];
  memoryContext?: {
    summary?: string;
    preferences?: Record<string, string>;
    sessionId?: string;
    kbNotes?: KBNoteSnapshot[];
    ltmFacts?: LTMFactSnapshot[];
  };
  classification: ClassificationResult;
}

export interface ToolOutput {
  response: string;
  action: string;
  mode: string;
  reasoning: string[];
  sources?: SearchResult[];
  isSearch?: boolean;
  isFakeSearch?: boolean;
  sideEffects?: {
    updatePreferences?: Record<string, string>;
  };
}

export interface Tool {
  name: string;
  description: string;
  handles: IntentType[];
  execute: (input: ToolInput) => Promise<ToolOutput>;
}

// ─── Agent tool calls ─────────────────────────────────────────────────────────

/** One tool invocation recorded during an agent run */
export interface AgentToolCall {
  tool: string;         // e.g. "get_weather"
  label: string;        // human-readable label, e.g. "Weather retrieved"
  durationMs: number;
  status: "done" | "error";
  result?: unknown;     // structured payload returned by the tool
  error?: string;
}

// ─── Debug info ───────────────────────────────────────────────────────────────

export interface DebugInfo {
  intent: IntentType;
  secondaryIntent?: IntentType;
  confidence: number;
  signals: string[];
  action: string;
  mode: string;
  memoryUsed: boolean;
  ltmHits?: string[];
  toolCalls?: AgentToolCall[];  // autonomous tool calls made during agent run
  reasoning: string[];
  processingMs: number;
}
