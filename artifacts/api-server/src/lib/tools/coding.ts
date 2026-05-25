import type { Tool, ToolInput, ToolOutput } from "../types";

type CodeSubtype = "debug" | "write" | "explain" | "review" | "general";

function detectSubtype(msg: string): CodeSubtype {
  const t = msg.toLowerCase();
  if (/\b(debug|fix|bug|error|exception|not working|broken|crash|undefined|null)\b/.test(t)) return "debug";
  if (/\b(write|build|create|implement|generate|scaffold|make me a)\b/.test(t)) return "write";
  if (/\b(explain|how does|what does|walk me through|understand)\b/.test(t)) return "explain";
  if (/\b(review|refactor|optimize|improve|clean up|better way|lint)\b/.test(t)) return "review";
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

// Check if the message contains enough context to attempt an answer
function hasCodeContext(msg: string): boolean {
  return /```|`[^`]+`|\bfunction\b|\bconst\b|\bdef\b|\bclass\b/.test(msg);
}

export const codingTool: Tool = {
  name: "coding",
  description: "Helps with code: debugging, writing, explaining, and reviewing",
  handles: ["coding"],
  async execute(input: ToolInput): Promise<ToolOutput> {
    const subtype = detectSubtype(input.message);
    const lang = extractLanguage(input.message);
    const hasContext = hasCodeContext(input.message);

    let response: string;
    let action: string;

    switch (subtype) {
      case "debug":
        action = "code_debugger";
        if (hasContext) {
          response = `Paste the full error message and I'll pinpoint the issue.`;
        } else {
          response = `Paste the code and error — I'll find the problem.`;
        }
        break;

      case "write":
        action = "code_writer";
        if (lang) {
          response = `What should this ${lang} code do? Describe the inputs, outputs, and any constraints — I'll write it.`;
        } else {
          response = `What should it do? Give me the goal and any constraints and I'll write it.`;
        }
        break;

      case "explain":
        action = "code_explainer";
        if (hasContext) {
          response = `Paste the specific part you want explained and I'll walk through it.`;
        } else {
          response = `Paste the code${lang ? ` (${lang})` : ""} or describe the specific concept — I'll explain it clearly.`;
        }
        break;

      case "review":
        action = "code_reviewer";
        response = `Paste the code and I'll review it for correctness, edge cases, and clarity${lang === "TypeScript" || lang === "JavaScript" ? " — plus TypeScript safety" : ""}.`;
        break;

      default:
        action = "code_assist";
        response = lang
          ? `What's the ${lang} question? Paste code or describe what you're trying to do.`
          : `What are you trying to build or fix? Paste code or describe it.`;
    }

    return {
      response,
      action,
      mode: "coding_assistant",
      reasoning: [`subtype: ${subtype}`, lang ? `language: ${lang}` : "language: unspecified", action],
    };
  },
};
