import type { Tool, ToolInput, ToolOutput } from "../types";

const GREETINGS = [
  "Hello{name}. What can I help you with today?",
  "Hi{name} — what's on your mind?",
  "Hey{name}. Ready when you are.",
];
const WELLBEING = [
  "Functioning well, thanks. What can I help you with?",
  "All good on my end. What are you working on?",
  "Doing fine — what's on your mind?",
];
const THANKS = [
  "Happy to help. Let me know if there's anything else.",
  "You're welcome. What else can I do for you?",
  "Anytime — feel free to ask.",
];
const FAREWELLS = [
  "Take care. I'll remember our conversation for next time.",
  "See you. Good luck with what you're working on.",
  "Goodbye. Come back anytime — I'll have your history ready.",
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

    const reasoning: string[] = [
      `Intent classified as: casual`,
      `Subtype detected: ${subtype}`,
      name ? `Memory: user name "${name}" loaded` : "Memory: no name preference set",
      `Response pool selected: ${subtype}`,
    ];

    let response: string;
    let action: string;

    switch (subtype) {
      case "greeting":
        response = pick(GREETINGS).replace("{name}", nameTag);
        action = "greeting_response";
        reasoning.push("Applied name personalization to greeting template");
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
        reasoning.push("Added memory continuity message to farewell");
        break;
      default:
        response = name
          ? `Hey ${name}. What's on your mind?`
          : "What's on your mind?";
        action = "small_talk";
    }

    return { response, action, mode: "conversational", reasoning };
  },
};
