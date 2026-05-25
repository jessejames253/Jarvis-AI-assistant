import type { Tool, ToolInput, ToolOutput } from "../types";

type CodeSubtype = "debug" | "write" | "explain" | "review" | "general";

function detectSubtype(msg: string): CodeSubtype {
  const t = msg.toLowerCase();
  if (/\b(debug|fix|bug|error|exception|not working|broken|crash|undefined|null)\b/.test(t)) return "debug";
  if (/\b(write|build|create|implement|generate|scaffold|make me a)\b/.test(t)) return "write";
  if (/\b(explain|how does|what does|walk me through|understand)\b/.test(t)) return "explain";
  if (/\b(review|refactor|optimize|improve|clean up|better way|lint|smell)\b/.test(t)) return "review";
  return "general";
}

function extractLanguage(msg: string): string | null {
  const langs: Record<string, RegExp> = {
    TypeScript: /\btypescript\b|\bts\b/i,
    JavaScript: /\bjavascript\b|\bjs\b/i,
    Python: /\bpython\b/i,
    Rust: /\brust\b/i,
    Go: /\bgolang\b|\bgo\b/i,
    Java: /\bjava\b/i,
    SQL: /\bsql\b/i,
    HTML: /\bhtml\b/i,
    CSS: /\bcss\b/i,
    React: /\breact\b/i,
  };
  for (const [lang, re] of Object.entries(langs)) {
    if (re.test(msg)) return lang;
  }
  return null;
}

export const codingTool: Tool = {
  name: "coding",
  description: "Helps with code: debugging, writing, explaining, and reviewing",
  handles: ["coding"],
  async execute(input: ToolInput): Promise<ToolOutput> {
    const subtype = detectSubtype(input.message);
    const lang = extractLanguage(input.message);
    const isFollowUp = input.history.length > 2;

    const reasoning: string[] = [
      "Intent: coding request",
      `Sub-type: ${subtype}`,
      lang ? `Language detected: ${lang}` : "Language: not specified",
      isFollowUp ? "Context: continuing an existing conversation" : "Context: new conversation",
    ];

    let response: string;
    let action: string;

    switch (subtype) {
      case "debug":
        action = "code_debugger";
        reasoning.push("Routing to debug workflow — requesting error details");
        if (isFollowUp) {
          response =
            "To debug this further, could you share:\n\n" +
            "1. The exact error message or stack trace\n" +
            "2. The relevant code section\n" +
            "3. What you expected to happen vs. what actually happened\n\n" +
            "Paste those and I'll walk through the issue with you.";
        } else {
          response =
            "To help debug this, I need a few things:\n\n" +
            `1. ${lang ? `Your ${lang}` : "The"} code snippet (or the relevant part)\n` +
            "2. The full error message or unexpected output\n" +
            "3. What the code is supposed to do\n\n" +
            "Once I have those I can pinpoint the issue.";
        }
        break;

      case "write":
        action = "code_writer";
        reasoning.push("Routing to code generation workflow");
        response =
          `To write this ${lang ? `in ${lang} ` : ""}for you, could you clarify:\n\n` +
          "1. What should the code do? (inputs and outputs)\n" +
          "2. Any constraints — performance, framework, style?\n" +
          "3. Should I include tests or just the implementation?\n\n" +
          "The more specific you are, the more useful the code will be.";
        break;

      case "explain":
        action = "code_explainer";
        reasoning.push("Routing to explanation workflow");
        response =
          `Happy to explain that${lang ? ` ${lang} concept` : ""}. ` +
          "Could you paste the code or be more specific about which part you'd like explained? " +
          "I'll walk through it line by line if that's useful.";
        break;

      case "review":
        action = "code_reviewer";
        reasoning.push("Routing to code review workflow");
        response =
          "Paste the code and I'll review it for:\n\n" +
          "• Correctness — does it do what it's supposed to?\n" +
          "• Edge cases — what could break it?\n" +
          "• Clarity — is it easy to read and maintain?\n" +
          (lang === "TypeScript" || lang === "JavaScript"
            ? "• TypeScript safety and modern patterns\n"
            : "") +
          "\nGo ahead and share it.";
        break;

      default:
        action = "code_assist";
        reasoning.push("General coding request — asking for specifics");
        response =
          `I can help with that${lang ? ` ${lang}` : ""} question. ` +
          "Share the code or describe exactly what you're trying to accomplish, " +
          "and I'll give you something concrete to work with.";
    }

    return { response, action, mode: "coding_assistant", reasoning };
  },
};
