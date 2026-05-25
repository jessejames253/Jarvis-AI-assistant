import type { Tool, ToolInput, ToolOutput } from "../types";

const RESPONSES = [
  "I'm Jarvis — an AI assistant designed for clear thinking and direct answers. I can explain concepts, work through problems, write and debug code, and search the web for current information.",
  "Jarvis. I'm an AI assistant built to help you think through things — questions, problems, plans, code. I also have persistent memory, so I'll remember this conversation next time.",
  "I'm an AI assistant called Jarvis. Ask me anything — I'll give you a direct answer or go find one.",
];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

export const identityTool: Tool = {
  name: "identity",
  description: "Answers questions about who or what Jarvis is",
  handles: ["identity"],
  async execute(input: ToolInput): Promise<ToolOutput> {
    const isMadeBy = /\b(who made|who built|who created|who developed|who wrote)\b/i.test(input.message);
    const isCapabilities = /\b(what can you|what do you|your abilities|your capabilities|your features)\b/i.test(input.message);

    let response: string;
    let action: string;
    const reasoning: string[] = ["Intent: identity question", ""];

    if (isMadeBy) {
      reasoning[1] = "Sub-type: origin/creator question";
      action = "creator_disclosure";
      response = "I was built as a learning project — a modular AI assistant with persistent memory and tool-based routing. The architecture is designed so a real AI model can be connected by changing a single function.";
    } else if (isCapabilities) {
      reasoning[1] = "Sub-type: capabilities question";
      action = "capability_disclosure";
      response =
        "Here's what I can do:\n\n" +
        "• Answer questions and explain concepts\n" +
        "• Write, debug, and review code\n" +
        "• Search the web for current information\n" +
        "• Help with planning and task breakdowns\n" +
        "• Remember your conversation across sessions\n" +
        "• Store your preferences (like your name)\n\n" +
        "What would you like to start with?";
    } else {
      reasoning[1] = "Sub-type: general identity question";
      action = "identity_disclosure";
      response = pick(RESPONSES);
    }

    return { response, action, mode: "informational", reasoning };
  },
};
