/**
 * lib/tools/registry.ts — Tool registry
 *
 * Maps every IntentType to the tool that handles it.
 *
 * AI-powered tools (Claude):
 *   aiTool      — definition, general, coding, planning
 *   researchTool — research (web search + Claude synthesis)
 *
 * Deterministic tools (no AI):
 *   mathTool        — exact arithmetic
 *   memoryUpdateTool — name/preference extraction
 *   tasksTool        — task CRUD
 *   kbTool           — knowledge base CRUD
 *   casualTool       — greetings/farewells
 *   identityTool     — "who are you"
 */

import type { Tool, IntentType } from "../types";
import { casualTool } from "./casual";
import { identityTool } from "./identity";
import { mathTool } from "./math";
import { researchTool } from "./research";
import { memoryUpdateTool } from "./memoryUpdate";
import { tasksTool } from "./tasks";
import { kbTool } from "./kb";
import { aiTool } from "./ai"; // Claude-powered: coding, planning, definition, general

const ALL_TOOLS: Tool[] = [
  casualTool,
  identityTool,
  memoryUpdateTool,
  mathTool,
  kbTool,
  tasksTool,
  researchTool,
  aiTool,       // handles definition, general, coding, planning — keep last as broadest fallback
];

const intentMap = new Map<IntentType, Tool>();
for (const tool of ALL_TOOLS) {
  for (const intent of tool.handles) {
    if (!intentMap.has(intent)) {
      intentMap.set(intent, tool);
    }
  }
}

export function getTool(intent: IntentType): Tool {
  return intentMap.get(intent) ?? aiTool;
}

export function getAllTools(): Tool[] {
  return ALL_TOOLS;
}
