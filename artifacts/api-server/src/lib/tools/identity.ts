import type { Tool, ToolInput, ToolOutput } from "../types";

const IDENTITY_RESPONSES = [
  "Jarvis — your AI assistant. I handle questions, code, web search, planning, and I remember our conversations between sessions.",
  "I'm Jarvis. Ask me anything — I'll either answer directly or find the information. I also remember context across sessions.",
  "Jarvis. I think clearly, work fast, and remember what matters. What do you need?",
];

const CAPABILITY_RESPONSE = `Here's what I can do:

• Answer questions and explain concepts
• Write, debug, and review code in any language
• Search the web for current information
• Help with planning, breakdowns, and task lists
• Remember your name and preferences across sessions
• Store notes in your personal Knowledge Base

What would you like to start with?`;

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

export const identityTool: Tool = {
  name: "identity",
  description: "Answers questions about who or what Jarvis is",
  handles: ["identity"],
  async execute(input: ToolInput): Promise<ToolOutput> {
    const isMadeBy = /\b(who made|who built|who created|who developed|who wrote)\b/i.test(input.message);
    const isCapabilities = /\b(what can you|what do you|your abilities|your capabilities|your features|what are you capable)\b/i.test(input.message);

    let response: string;
    let action: string;

    if (isMadeBy) {
      action = "creator_disclosure";
      response = "I was built as a modular AI assistant — intent routing, persistent memory, web search, and a personal knowledge base. The architecture is designed so a real AI model can be dropped in at any point.";
    } else if (isCapabilities) {
      action = "capability_disclosure";
      response = CAPABILITY_RESPONSE;
    } else {
      action = "identity_disclosure";
      response = pick(IDENTITY_RESPONSES);
    }

    return {
      response,
      action,
      mode: "informational",
      reasoning: ["identity question", action],
    };
  },
};
