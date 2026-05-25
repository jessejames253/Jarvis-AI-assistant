import type { Tool, ToolInput, ToolOutput } from "../types";

// Built-in knowledge base for common topics.
// When a real AI model is connected, this entire map can be removed — the AI
// will answer from its training data instead.
const KNOWLEDGE_BASE: Record<string, string> = {
  ai: "Artificial intelligence refers to software systems that perform tasks typically requiring human-like reasoning — recognising patterns, making decisions, generating language, or solving problems. Modern AI is largely built on machine learning: statistical models trained on large datasets rather than hand-coded rules.",
  "machine learning":
    "Machine learning is a branch of AI where models learn patterns from data rather than following explicit instructions. Given enough examples, a model can generalise to new inputs — the basis of everything from image recognition to language models.",
  "large language model":
    "A large language model (LLM) is a neural network trained on massive text datasets to predict and generate human language. Models like GPT-4 and Claude are LLMs — they learn grammar, facts, reasoning patterns, and style from their training data.",
  llm: "A large language model — a neural network trained to understand and generate human language at scale.",
  "neural network":
    "A neural network is a computational model loosely inspired by the brain. It consists of layers of interconnected nodes that transform inputs through learned weights. Deep neural networks — many layers stacked together — are the foundation of modern AI.",
  api: "An API (Application Programming Interface) is a defined contract between software components. One system exposes endpoints — functions it's willing to perform — and other systems call them. REST APIs use HTTP and are how most web services communicate.",
  rest: "REST (Representational State Transfer) is an architectural style for web APIs. Key principles: stateless requests, standard HTTP methods (GET/POST/PUT/DELETE), and resource-oriented URLs.",
  javascript:
    "JavaScript is the primary language of the web browser, and — via Node.js — a popular server-side language. It's dynamically typed, event-driven, and asynchronous by design. TypeScript is a typed superset that compiles to JavaScript.",
  typescript:
    "TypeScript is JavaScript with static types. It adds compile-time type checking, interfaces, and tooling support without changing runtime behaviour. It's the standard for large-scale JavaScript projects.",
  python:
    "Python is a general-purpose, readable scripting language widely used in data science, machine learning, automation, and web backends. Its simplicity and rich library ecosystem (NumPy, Pandas, PyTorch) make it the dominant language for AI research.",
  react:
    "React is a JavaScript library for building user interfaces. It uses a component-based model where UI is broken into reusable pieces, and a virtual DOM for efficient updates. Developed by Meta, it's one of the most widely-used frontend frameworks.",
  blockchain:
    "A blockchain is a distributed ledger — a database replicated across many nodes, where records are grouped into blocks and linked cryptographically. Once written, entries are extremely difficult to alter. It underlies cryptocurrencies and some decentralised applications.",
  quantum:
    "Quantum computing uses quantum mechanical phenomena — superposition and entanglement — to process information in ways classical computers can't. While still early-stage, quantum systems show promise for cryptography, simulation, and optimisation problems.",
  "open source":
    "Open source software is software whose source code is publicly available for anyone to inspect, modify, and distribute. It's the foundation of much of the modern internet — Linux, Git, PostgreSQL, React, and Python are all open source.",
  docker:
    "Docker is a platform for packaging applications into containers — lightweight, isolated environments that include everything the app needs to run. Containers make apps portable across different machines and environments.",
  git: "Git is a distributed version control system. It tracks changes to files over time, lets multiple people collaborate on code, and makes it possible to revert mistakes. GitHub and GitLab host Git repositories online.",
};

function findInKnowledgeBase(subject: string): string | null {
  const key = subject.toLowerCase().trim();
  for (const [topic, content] of Object.entries(KNOWLEDGE_BASE)) {
    if (key.includes(topic) || topic.includes(key)) return content;
  }
  // Try word-by-word match for multi-word topics
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

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

export const knowledgeTool: Tool = {
  name: "knowledge",
  description: "Explains concepts, definitions, comparisons, and how-to questions",
  handles: ["definition", "general"],
  async execute(input: ToolInput): Promise<ToolOutput> {
    const subtype = detectSubtype(input.message);
    const subject = extractSubject(input.message);
    const isFollowUp = input.history.length > 2;

    const reasoning: string[] = [
      `Intent: ${input.classification.intent}`,
      `Sub-type: ${subtype}`,
      subject ? `Subject extracted: "${subject.slice(0, 50)}"` : "Subject: not clear",
      "Checking built-in knowledge base",
    ];

    let response: string;
    let action: string;

    if (subtype === "comparison") {
      action = "concept_comparison";
      reasoning.push("Routing to comparison handler");
      response = pick([
        `Both have genuine merits — the right choice for "${subject}" depends on your specific use case and constraints. What are you deciding between them for?`,
        `Good comparison to make. The short version: neither is universally better for "${subject}" — it comes down to use case, scale, and team context. Want me to break down the key tradeoffs?`,
        `For "${subject}", the answer shifts based on what you're optimising for. Tell me more about the situation and I can give a direct recommendation.`,
      ]);
    } else if (subtype === "howto") {
      action = "howto_guide";
      reasoning.push("Routing to how-to handler");
      response = pick([
        `To ${subject}, the general approach is to start by understanding what you're working with, break it into steps, then tackle each one. Could you share more context so I can make this more specific?`,
        `For "${subject}": the right method depends on your setup. What are you using and what have you already tried?`,
        `Good question on "${subject}". Share a bit more context — what you're using or what you've tried — and I'll give you something concrete.`,
      ]);
    } else {
      // Definition / general — check knowledge base first
      const known = findInKnowledgeBase(subject);
      if (known) {
        action = "definition_from_kb";
        reasoning.push(`Knowledge base: found entry for "${subject}"`);
        response = known;
      } else {
        action = "definition_unknown";
        reasoning.push(`Knowledge base: no entry for "${subject}" — asking for context`);
        response = isFollowUp
          ? `In the context of what we've been discussing: could you be more specific about what you mean by "${subject}"? I want to give you an accurate answer.`
          : pick([
              `"${subject}" is something I can speak to more precisely with a bit more context. Are you looking for a technical definition, a conceptual overview, or something practical?`,
              `Good question. On "${subject}" — what angle are you coming from? Technical, conceptual, or applied?`,
            ]);
      }
    }

    return { response, action, mode: "knowledge_base", reasoning };
  },
};
