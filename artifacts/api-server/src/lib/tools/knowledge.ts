import type { Tool, ToolInput, ToolOutput } from "../types";

const KNOWLEDGE_BASE: Record<string, string> = {
  ai: "Artificial intelligence is software that performs tasks requiring human-like reasoning — recognising patterns, making decisions, generating language, solving problems. Modern AI is built on machine learning: statistical models trained on large datasets rather than hand-coded rules.",
  "machine learning":
    "Machine learning is AI where models learn patterns from data rather than explicit instructions. Given enough examples, a model generalises to new inputs — the basis of image recognition, language models, recommendations, and more.",
  "large language model":
    "A large language model (LLM) is a neural network trained on massive text datasets to predict and generate human language. GPT-4, Claude, and Gemini are LLMs — they learn grammar, facts, reasoning, and style from training data.",
  llm: "A large language model — a neural network trained to understand and generate human language at scale. Think GPT-4, Claude, Gemini.",
  "neural network":
    "A neural network is a computational model loosely inspired by the brain. It layers interconnected nodes that transform inputs through learned weights. Deep networks — many stacked layers — are the foundation of modern AI.",
  api: "An API (Application Programming Interface) is a contract between software components. One system exposes endpoints and other systems call them. REST APIs use HTTP and are how most web services communicate.",
  rest: "REST is an architectural style for web APIs: stateless requests, standard HTTP methods (GET/POST/PUT/DELETE), resource-oriented URLs. Most public APIs are RESTful.",
  javascript:
    "JavaScript is the language of the web browser — and via Node.js, the server too. Dynamically typed, event-driven, asynchronous by design. TypeScript is a typed superset that compiles down to JavaScript.",
  typescript:
    "TypeScript is JavaScript with static types. It adds compile-time checking, interfaces, and better tooling without changing runtime behaviour. Standard choice for large-scale JavaScript projects.",
  python:
    "Python is a general-purpose scripting language dominant in data science, ML, automation, and web backends. Its readability and rich ecosystem (NumPy, PyTorch, FastAPI) make it the first language for AI research.",
  react:
    "React is a JavaScript library for building UIs. Component-based architecture, virtual DOM for efficient updates, developed by Meta. One of the most widely deployed frontend frameworks.",
  blockchain:
    "A blockchain is a distributed ledger replicated across many nodes, where records are grouped into blocks and cryptographically linked. Extremely difficult to alter once written. Underlies cryptocurrencies and some decentralised apps.",
  quantum:
    "Quantum computing uses superposition and entanglement to process information in ways classical computers cannot. Still early-stage but shows promise for cryptography, simulation, and optimisation.",
  "open source":
    "Open source software has publicly available source code that anyone can inspect, modify, and distribute. Linux, Git, PostgreSQL, React, Python — the foundation of most of the modern internet is open source.",
  docker:
    "Docker packages applications into containers — lightweight, isolated environments with everything the app needs to run. Containers make software portable across machines and environments.",
  git: "Git is a distributed version control system. It tracks file changes over time, enables collaboration, and makes mistakes reversible. GitHub and GitLab host Git repositories.",
};

function findInKnowledgeBase(subject: string): string | null {
  const key = subject.toLowerCase().trim();
  for (const [topic, content] of Object.entries(KNOWLEDGE_BASE)) {
    if (key.includes(topic) || topic.includes(key)) return content;
  }
  const words = key.split(/\s+/);
  for (const word of words) {
    if (word.length > 3 && KNOWLEDGE_BASE[word]) return KNOWLEDGE_BASE[word];
  }
  return null;
}

function extractSubject(msg: string): string {
  return msg
    .replace(/^(what is|what are|what does|define|explain|describe|tell me about|meaning of|definition of|give me an overview of|summarize|how does|how do|why is|why are)\s*/i, "")
    .replace(/\?.*$/, "")
    .replace(/(?: a| an| the)?\s+/g, " ")
    .trim();
}

function detectSubtype(msg: string): "definition" | "comparison" | "howto" | "general" {
  const t = msg.toLowerCase();
  if (/\b(vs\.?|versus|difference between|compare|better|which (is|one))\b/.test(t)) return "comparison";
  if (/^how (do|does|can|should|to|would|could)\b/.test(t)) return "howto";
  if (/^(what|define|explain|describe|tell me|meaning|definition)\b/.test(t)) return "definition";
  return "general";
}

export const knowledgeTool: Tool = {
  name: "knowledge",
  description: "Explains concepts, definitions, comparisons, and how-to questions",
  handles: ["definition", "general"],
  async execute(input: ToolInput): Promise<ToolOutput> {
    const subtype = detectSubtype(input.message);
    const subject = extractSubject(input.message);

    // ── Personal KB check (highest priority) ─────────────────────────────────
    const kbNotes = input.memoryContext?.kbNotes;
    if (kbNotes && kbNotes.length > 0) {
      const items = kbNotes
        .map((n) => {
          const url = n.url ? `\n  🔗 ${n.url}` : "";
          const tags = n.tags.length ? ` [${n.tags.join(", ")}]` : "";
          const preview = n.content.length > 400 ? n.content.slice(0, 400).trim() + "…" : n.content;
          return `**${n.title}**${tags}\n${preview}${url}`;
        })
        .join("\n\n");

      return {
        response: `From your Knowledge Base:\n\n${items}`,
        action: "from_personal_kb",
        mode: "knowledge_base",
        reasoning: [`Personal KB: ${kbNotes.length} relevant note(s)`, "KB-first policy applied"],
      };
    }

    let response: string;
    let action: string;

    if (subtype === "comparison") {
      action = "concept_comparison";
      const known = findInKnowledgeBase(subject);
      if (known) {
        response = known + "\n\nWant me to compare it against something specific, or search for a more in-depth breakdown?";
      } else {
        response = `The right answer for "${subject}" depends on your constraints — scale, team, use case. If you share more context I can give a direct recommendation. Or I can search the web for a current comparison.`;
      }
    } else if (subtype === "howto") {
      action = "howto_guide";
      const known = findInKnowledgeBase(subject);
      if (known) {
        response = known + "\n\nNeed more detail on a specific part of this?";
      } else {
        response = `For "${subject}", the approach depends on your setup. Share what you're working with and what you've tried, and I'll give you something specific. Or say "search how to ${subject}" and I'll look it up live.`;
      }
    } else {
      // Definition / general
      const known = findInKnowledgeBase(subject);
      if (known) {
        action = "definition_from_kb";
        response = known;
      } else {
        action = "definition_search_suggestion";
        response = `I don't have "${subject}" in my built-in knowledge. Say **"search ${subject}"** and I'll pull a current answer from the web.`;
      }
    }

    return {
      response,
      action,
      mode: "knowledge_base",
      reasoning: [
        `subtype: ${subtype}`,
        subject ? `subject: "${subject.slice(0, 50)}"` : "no subject",
        "personal KB: no matches",
        action,
      ],
    };
  },
};
