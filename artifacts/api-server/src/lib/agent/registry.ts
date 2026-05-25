/**
 * agent/registry.ts — Unified tool registry
 *
 * Exports:
 *   TOOL_DEFINITIONS  — Anthropic-format tool definitions passed to claude
 *   executeToolCall   — dispatch by tool name to the implementation
 *   TOOL_LABELS       — human-readable status labels for the UI
 */

import { getWeather } from "./tools/weather";
import { calculate } from "./tools/calculator";
import { searchWeb } from "./tools/search";
import { createReminder, listReminders } from "./tools/reminders";
import { lookupMemory } from "./tools/memory";
import { runCode } from "./tools/code";

// ─── Anthropic tool definitions ───────────────────────────────────────────────

export const TOOL_DEFINITIONS = [
  {
    name: "get_weather",
    description:
      "Get the current weather conditions for any location worldwide. Use this whenever the user asks about weather, temperature, or climate in a specific place.",
    input_schema: {
      type: "object" as const,
      properties: {
        location: {
          type: "string",
          description: 'City and country, e.g. "London, UK" or "Tokyo, Japan"',
        },
      },
      required: ["location"],
    },
  },
  {
    name: "search_web",
    description:
      "Search the web for current, real-time information. Use for: news, recent events, prices, facts that may have changed since training, or anything the user explicitly asks you to look up.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Concise search query optimised for a search engine",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "calculate",
    description:
      "Evaluate a mathematical expression with exact precision. Use for arithmetic, percentages, exponents, and any numeric calculation where precision matters.",
    input_schema: {
      type: "object" as const,
      properties: {
        expression: {
          type: "string",
          description: 'Mathematical expression, e.g. "12 * (34 + 5)" or "2 ** 32"',
        },
      },
      required: ["expression"],
    },
  },
  {
    name: "create_reminder",
    description:
      "Create a new task, reminder, or to-do item for the user. Use when the user says things like 'remind me to', 'add a task', 'don't let me forget', or 'schedule'.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "The task or reminder title" },
        due: { type: "string", description: "Optional due date string, e.g. 'tomorrow', '2026-06-01'" },
        priority: {
          type: "string",
          enum: ["low", "medium", "high", "urgent"],
          description: "Priority level",
        },
        category: {
          type: "string",
          enum: ["work", "personal", "coding", "ideas"],
          description: "Category",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "list_reminders",
    description:
      "List the user's current tasks and reminders. Use when the user asks 'what are my tasks', 'show my reminders', or 'what do I need to do'.",
    input_schema: {
      type: "object" as const,
      properties: {
        filter: {
          type: "string",
          description: "Optional keyword filter, e.g. 'work', 'urgent', 'coding'",
        },
      },
    },
  },
  {
    name: "lookup_memory",
    description:
      "Look up facts stored in long-term memory about the user. Use when you need to recall specific details about the user that might not be in the current conversation.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "What you want to look up, e.g. 'programming languages', 'current projects'",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "run_code",
    description:
      "Execute JavaScript code in a sandboxed environment and return the output. Use when the user wants to run, test, or verify a code snippet.",
    input_schema: {
      type: "object" as const,
      properties: {
        code: { type: "string", description: "The JavaScript code to execute" },
        language: {
          type: "string",
          description: "Programming language (only 'javascript' is currently supported)",
        },
      },
      required: ["code"],
    },
  },
] as const;

// ─── Human-readable labels ────────────────────────────────────────────────────

export const TOOL_LABELS: Record<string, { running: string; done: string; icon: string }> = {
  get_weather:    { running: "Checking weather...", done: "Weather retrieved",  icon: "🌡️" },
  search_web:     { running: "Searching web...",    done: "Search complete",    icon: "🔍" },
  calculate:      { running: "Calculating...",      done: "Calculation done",   icon: "🧮" },
  create_reminder:{ running: "Saving reminder...",  done: "Reminder saved",     icon: "📌" },
  list_reminders: { running: "Loading tasks...",    done: "Tasks loaded",       icon: "📋" },
  lookup_memory:  { running: "Checking memory...",  done: "Memory retrieved",   icon: "🧠" },
  run_code:       { running: "Running code...",     done: "Code executed",      icon: "⚡" },
};

// ─── Tool execution context ───────────────────────────────────────────────────

export interface ToolContext {
  sessionId?: string;
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function executeToolCall(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  switch (name) {
    case "get_weather":
      return getWeather(String(input.location ?? ""));

    case "search_web":
      return searchWeb(String(input.query ?? ""));

    case "calculate":
      return calculate(String(input.expression ?? ""));

    case "create_reminder": {
      const sid = ctx.sessionId;
      if (!sid) return { error: "No session — cannot create reminder" };
      return createReminder(sid, {
        title: String(input.title ?? ""),
        due: input.due ? String(input.due) : undefined,
        priority: (input.priority as "low" | "medium" | "high" | "urgent") ?? "medium",
        category: (input.category as "work" | "personal" | "coding" | "ideas") ?? "personal",
      });
    }

    case "list_reminders": {
      const sid = ctx.sessionId;
      if (!sid) return { tasks: [], message: "No session" };
      return listReminders(sid, input.filter ? String(input.filter) : undefined);
    }

    case "lookup_memory": {
      const sid = ctx.sessionId;
      if (!sid) return { facts: [], message: "No session" };
      return lookupMemory(sid, String(input.query ?? ""));
    }

    case "run_code":
      return runCode(String(input.code ?? ""), input.language ? String(input.language) : "javascript");

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
