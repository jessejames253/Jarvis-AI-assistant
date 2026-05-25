import type { Tool, ToolInput, ToolOutput } from "../types";

/**
 * Tries to extract a name from phrases like:
 *   "my name is Alex"
 *   "call me Alex"
 *   "I'm Alex"
 *   "I am called Alex"
 */
function extractName(msg: string): string | null {
  const patterns = [
    /\bmy name is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    /\bcall me\s+([A-Z][a-z]+)/i,
    /\bi(?:'m| am)(?: called)?\s+([A-Z][a-z]+)/i,
    /\bi go by\s+([A-Z][a-z]+)/i,
  ];
  for (const p of patterns) {
    const m = msg.match(p);
    if (m?.[1] && m[1].length <= 40) return m[1].trim();
  }
  return null;
}

function isForgetting(msg: string): boolean {
  return /\bforget (everything|my|this|that|all|me)\b/i.test(msg);
}

export const memoryUpdateTool: Tool = {
  name: "memoryUpdate",
  description: "Extracts and stores user preferences like name from conversational statements",
  handles: ["memory_update"],
  async execute(input: ToolInput): Promise<ToolOutput> {
    const reasoning: string[] = ["Intent: memory update request"];
    const sideEffects: Record<string, string> = {};

    if (isForgetting(input.message)) {
      reasoning.push("User requested memory reset — returning reset instruction");
      return {
        response:
          "Understood. You can clear all stored memory using the brain icon in the top-right corner — that will wipe the conversation history, summary, and any preferences saved for this session.",
        action: "memory_reset_instruction",
        mode: "memory_manager",
        reasoning,
      };
    }

    const name = extractName(input.message);

    if (name) {
      reasoning.push(`Name extracted: "${name}"`);
      reasoning.push("Setting side effect: updatePreferences.name");
      sideEffects["name"] = name;

      return {
        response: `Got it — I'll call you ${name} from now on. I've saved that to your session preferences.`,
        action: "preference_update",
        mode: "memory_manager",
        reasoning,
        sideEffects: { updatePreferences: sideEffects },
      };
    }

    // Couldn't extract a specific preference
    reasoning.push("No specific preference detected — asking for clarification");
    return {
      response:
        "I want to make sure I save the right thing. Could you be specific? For example: \"My name is Alex\" or \"I prefer detailed explanations\".",
      action: "memory_clarify",
      mode: "memory_manager",
      reasoning,
    };
  },
};
