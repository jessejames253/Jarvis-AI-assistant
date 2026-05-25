/**
 * lib/tools/registry.ts — Tool registry
 *
 * Maps every IntentType to the tool that handles it.
 * Tools are registered in priority order — earlier entries win if multiple
 * tools claim the same intent.
 *
 * To add a new tool:
 *   1. Create lib/tools/yourTool.ts (export a Tool object)
 *   2. Import it here
 *   3. Add it to ALL_TOOLS
 *   4. Add your IntentType entries to lib/types.ts → IntentType
 *   5. Add intent patterns to lib/intent.ts → DESCRIPTORS
 */

import type { Tool, IntentType } from "../types";
import { casualTool } from "./casual";
import { identityTool } from "./identity";
import { codingTool } from "./coding";
import { mathTool } from "./math";
import { planningTool } from "./planning";
import { researchTool } from "./research";
import { memoryUpdateTool } from "./memoryUpdate";
import { tasksTool } from "./tasks";
import { knowledgeTool } from "./knowledge"; // also acts as the general fallback

/** All registered tools, in priority order */
const ALL_TOOLS: Tool[] = [
  casualTool,
  identityTool,
  memoryUpdateTool,
  codingTool,
  mathTool,
  tasksTool,       // task_management — before planning so task queries don't fall through
  planningTool,
  researchTool,
  knowledgeTool,   // handles "definition" and "general" — keep last as fallback
];

// Build a lookup map: intent → tool
const intentMap = new Map<IntentType, Tool>();
for (const tool of ALL_TOOLS) {
  for (const intent of tool.handles) {
    if (!intentMap.has(intent)) {
      intentMap.set(intent, tool);
    }
  }
}

/**
 * Returns the tool that handles the given intent.
 * Falls back to knowledgeTool if no specific tool is registered.
 */
export function getTool(intent: IntentType): Tool {
  return intentMap.get(intent) ?? knowledgeTool;
}

/** Returns all registered tools (used for introspection / debug output) */
export function getAllTools(): Tool[] {
  return ALL_TOOLS;
}
