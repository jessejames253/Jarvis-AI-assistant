import type { Tool, ToolInput, ToolOutput } from "../types";

const GREETINGS = [
  "Hey{name}. What are we working on?",
  "Hello{name}. What's on your mind?",
  "Hi{name} — ready when you are.",
  "Good to hear from you{name}. What can I help with?",
];

const WELLBEING = [
  "Running well. What do you need?",
  "All systems nominal. What are we tackling?",
  "Good — what are you working on?",
  "Sharp as ever. What's the question?",
];

const THANKS = [
  "Anytime.",
  "Of course. What else?",
  "Happy to help.",
  "That's what I'm here for.",
];

const FAREWELLS = [
  "Take care. I'll have this conversation ready next time.",
  "See you. Good luck with what you're building.",
  "Until next time.",
  "Goodbye — come back when you need me.",
];

const SMALLTALK = [
  "What's on your mind?",
  "Go ahead.",
  "I'm listening.",
  "What are we looking at?",
];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

function detectSubtype(msg: string): "greeting" | "wellbeing" | "thanks" | "farewell" | "smalltalk" {
  const t = msg.toLowerCase();
  if (/^(hi|hello|hey|good\s*(morning|afternoon|evening)|greetings|howdy)\b/.test(t)) return "greeting";
  if (/\bhow are you\b|\bhow'?re you doing\b|\bare you (ok|alright|well)\b/.test(t)) return "wellbeing";
  if (/\b(thank|thanks|thx|ty|appreciate)\b/.test(t)) return "thanks";
  if (/\b(bye|goodbye|see you|take care|later|cya)\b/.test(t)) return "farewell";
  return "smalltalk";
}

export const casualTool: Tool = {
  name: "casual",
  description: "Handles greetings, small talk, wellbeing checks, thanks, and farewells",
  handles: ["casual"],
  async execute(input: ToolInput): Promise<ToolOutput> {
    const subtype = detectSubtype(input.message);
    const name = input.memoryContext?.preferences?.name;
    const nameTag = name ? `, ${name}` : "";

    let response: string;
    let action: string;

    switch (subtype) {
      case "greeting":
        response = pick(GREETINGS).replace("{name}", nameTag);
        action = "greeting_response";
        break;
      case "wellbeing":
        response = pick(WELLBEING);
        action = "wellbeing_response";
        break;
      case "thanks":
        response = pick(THANKS);
        action = "acknowledgement";
        break;
      case "farewell":
        response = pick(FAREWELLS);
        action = "farewell_response";
        break;
      default:
        response = name ? `${pick(SMALLTALK)} ${name}.`.replace(". .", ".") : pick(SMALLTALK);
        action = "small_talk";
    }

    return {
      response,
      action,
      mode: "conversational",
      reasoning: [`casual/${subtype}`, name ? `name: ${name}` : "no name set"],
    };
  },
};
