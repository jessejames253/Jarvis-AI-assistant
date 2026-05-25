/**
 * lib/responder.ts — Jarvas response engine
 *
 * This is the "brain" of Jarvas. It receives a user message, the conversation
 * history, and any memory context, then returns a response.
 *
 * ─── HOW TO PLUG IN A REAL AI MODEL ────────────────────────────────────────
 * Everything routes through one function: complete()
 *
 * To connect OpenAI GPT-4o:
 *
 *   import OpenAI from "openai";
 *   const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
 *
 *   export async function complete(input: ChatInput): Promise<ChatOutput> {
 *     const systemParts = [
 *       "You are Jarvas, a calm, intelligent AI assistant with a subtle futuristic edge.",
 *       "Answer directly and concisely. Avoid filler phrases.",
 *     ];
 *     if (input.memoryContext?.summary) {
 *       systemParts.push(`Context from earlier: ${input.memoryContext.summary}`);
 *     }
 *     if (input.memoryContext?.preferences?.name) {
 *       systemParts.push(`The user's name is ${input.memoryContext.preferences.name}.`);
 *     }
 *     const completion = await client.chat.completions.create({
 *       model: "gpt-4o",
 *       messages: [
 *         { role: "system", content: systemParts.join("\n") },
 *         ...input.history,
 *         { role: "user", content: input.message },
 *       ],
 *     });
 *     return { response: completion.choices[0].message.content ?? "", model: "gpt-4o" };
 *   }
 * ────────────────────────────────────────────────────────────────────────────
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
}

export interface ChatInput {
  message: string;
  history: HistoryEntry[];
  memoryContext?: {
    summary?: string;                          // Auto-generated summary of earlier turns
    preferences?: Record<string, string>;      // User preferences (name, style, etc.)
  };
}

export interface ChatOutput {
  response: string;
  model: string;
}

// ─── Model adapter ────────────────────────────────────────────────────────────
// Replace this function body to connect a real AI model. Nothing else changes.

export async function complete(input: ChatInput): Promise<ChatOutput> {
  const response = localResponder(input.message, input.history, input.memoryContext);
  return { response, model: "jarvas-local" };
}

// ─── Local response engine ────────────────────────────────────────────────────

type Category =
  | "greeting" | "identity" | "capabilities" | "wellbeing"
  | "thanks" | "farewell" | "math" | "code" | "comparison"
  | "opinion" | "definition" | "howto" | "yesno" | "general";

function classify(msg: string): Category {
  const t = msg.toLowerCase().trim();
  if (/^(hi|hello|hey|good\s*(morning|afternoon|evening)|greetings|howdy|sup|what'?s up)\b/.test(t)) return "greeting";
  if (/\b(who|what) are you\b|\babout yourself\b|\byour name\b/.test(t)) return "identity";
  if (/\b(what can you|what do you|can you help|your (abilities|capabilities|features))\b/.test(t)) return "capabilities";
  if (/\bhow are you\b|\bhow('?re| are) you doing\b|\bare you (ok|alright|well)\b/.test(t)) return "wellbeing";
  if (/\b(thank(s| you)|thx|ty|appreciate)\b/.test(t)) return "thanks";
  if (/\b(bye|goodbye|see you|take care|later|cya)\b/.test(t)) return "farewell";
  if (/\b(calculate|compute|how much is|what('?s| is) \d|solve|\d+\s*[\+\-\*\/\^]\s*\d)\b/.test(t)) return "math";
  if (/\b(code|function|script|debug|bug|error|syntax|program|javascript|python|typescript|html|css|react|sql|api)\b/.test(t)) return "code";
  if (/\b(vs\.?|versus|or|better|difference between|compare|which (is|one|should))\b/.test(t)) return "comparison";
  if (/\b(what do you think|your opinion|do you prefer|do you believe|do you like|your (view|take|thoughts?))\b/.test(t)) return "opinion";
  if (/^(what|define|explain|describe|tell me about|meaning of|definition of)\b/.test(t)) return "definition";
  if (/^how (do|does|can|should|to|would|could)\b/.test(t)) return "howto";
  if (/^(is|are|does|do|can|will|was|were|has|have|did|would|could|should)\b/.test(t)) return "yesno";
  return "general";
}

function extractSubject(msg: string): string {
  const patterns = [
    /^(?:what(?: is| are| does))(?: a| an| the)? (.+?)[\?\.]?$/i,
    /^(?:define|explain|describe|meaning of|definition of)(?: a| an| the)? (.+?)[\?\.]?$/i,
    /^(?:tell me about)(?: a| an| the)? (.+?)[\?\.]?$/i,
    /^(?:how (?:do|does|can|should|to|would)) (?:i |you |we )?(.+?)[\?\.]?$/i,
  ];
  for (const p of patterns) {
    const m = msg.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return msg.replace(/^(what|how|why|who|when|where|is|are|does|do|can)\b\s*/i, "").trim();
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function localResponder(
  message: string,
  history: HistoryEntry[],
  memoryContext?: ChatInput["memoryContext"]
): string {
  const category = classify(message);
  const subject = extractSubject(message);
  const isFollowUp = history.length > 2;

  // Personalize greeting with stored name if available
  const userName = memoryContext?.preferences?.name;
  const nameTag = userName ? `, ${userName}` : "";

  switch (category) {
    case "greeting":
      return pick([
        `Hello${nameTag}. What can I help you with today?`,
        `Hi${nameTag} — what's on your mind?`,
        `Hey${nameTag}. Ready when you are. What would you like to work through?`,
      ]);

    case "identity":
      return pick([
        "I'm Jarvas, an AI assistant designed for clear thinking and direct answers. I can explain concepts, work through problems, and search the web when you need current information.",
        "Jarvas. I'm here to help you reason through things — questions, problems, ideas. I also have access to web search for anything time-sensitive.",
        "I'm an AI assistant called Jarvas. Ask me anything — I'll give you a straight answer or find one.",
      ]);

    case "capabilities":
      return "Here's what I can do:\n\n• Answer questions and explain concepts\n• Help with writing, editing, and brainstorming\n• Work through logic, math, and analysis\n• Assist with code — review, debugging, or starting fresh\n• Search the web for current information\n• Remember this conversation across sessions\n\nWhat would you like to start with?";

    case "wellbeing":
      return pick([
        "Functioning well, thanks. What can I help you with?",
        "All good on my end. What are you working on?",
        "Doing fine. What's on your mind?",
      ]);

    case "thanks":
      return pick([
        "Happy to help. Let me know if there's anything else.",
        "You're welcome. What else can I do for you?",
        "Anytime. Feel free to ask if something else comes up.",
      ]);

    case "farewell":
      return pick([
        "Take care. I'll remember our conversation for next time.",
        "See you. Good luck with what you're working on.",
        "Goodbye. Come back anytime — I'll have our history ready.",
      ]);

    case "math": {
      const expr = message.match(/[\d\s\+\-\*\/\^\(\)\.]+/)?.[0]?.trim();
      if (expr && /\d/.test(expr)) {
        try {
          const sanitized = expr.replace(/\^/g, "**");
          // eslint-disable-next-line no-new-func
          const result = Function(`"use strict"; return (${sanitized})`)() as number;
          if (typeof result === "number" && isFinite(result)) {
            return `${expr.trim()} = **${result}**`;
          }
        } catch { /* fall through */ }
      }
      return "I can handle straightforward arithmetic. Share the full expression and I'll work through it step by step.";
    }

    case "code":
      if (/\b(debug|error|fix|broken|not working|issue|bug)\b/i.test(message)) {
        return "To help debug this, I'll need a bit more context:\n\n1. What language or framework are you using?\n2. What does the error message say?\n3. What behavior were you expecting?\n\nPaste what you have and I'll take a look.";
      }
      if (/\b(how|write|create|build|make|start)\b/i.test(message)) {
        return `For "${subject}", I'd suggest starting with a clear data structure and working outward. Could you share more about what language you're using and what the end goal is?`;
      }
      return "Happy to help with that. Share the relevant code or describe what you're trying to accomplish and I'll get into the specifics with you.";

    case "comparison":
      return pick([
        `Both have genuine merits — the right choice for "${subject}" usually depends on your specific constraints. What's the context you're deciding in?`,
        `Good comparison to make. The answer for "${subject}" comes down to use case, scale, and team familiarity. Want me to break down the key tradeoffs?`,
        `For "${subject}", the answer isn't one-size-fits-all. Tell me more about what you're optimizing for and I can give you a direct recommendation.`,
      ]);

    case "opinion":
      return pick([
        `On "${subject}" — my view depends heavily on what you're trying to accomplish. What's driving the question?`,
        `That's worth thinking through carefully. The most useful answer on "${subject}" depends on your situation. What's the broader goal here?`,
        `I have a perspective on "${subject}" — but I'd want to understand your context better first. What specifically are you trying to decide?`,
      ]);

    case "definition": {
      const knownTopics: Record<string, string> = {
        ai: "Artificial intelligence refers to software systems that perform tasks typically requiring human-like reasoning — recognizing patterns, making decisions, generating language, or solving problems. Modern AI is largely built on machine learning: statistical models trained on large datasets rather than hand-coded rules.",
        "machine learning": "Machine learning is a branch of AI where models learn patterns from data rather than following explicit instructions. Given enough examples, a model can generalize to new inputs — the basis of everything from image recognition to language models.",
        "large language model": "A large language model (LLM) is a neural network trained on massive text datasets to predict and generate human language. Models like GPT-4 and Claude are LLMs — they learn grammar, facts, reasoning patterns, and style from the training data and can generate fluent, contextually relevant text.",
        llm: "A large language model — a neural network trained to understand and generate human language at scale. See also: GPT, Claude, Gemini.",
        "neural network": "A neural network is a computational model loosely inspired by the brain. It consists of layers of interconnected nodes that transform inputs through learned weights. Deep neural networks — many layers stacked together — are the foundation of modern AI.",
        api: "An API (Application Programming Interface) is a defined contract between software components. One system exposes endpoints — functions it's willing to perform — and other systems call them. REST APIs use HTTP; they're how most web services communicate.",
        rest: "REST (Representational State Transfer) is an architectural style for web APIs. Key principles: stateless requests, standard HTTP methods (GET/POST/PUT/DELETE), and resource-oriented URLs. Most public web APIs are RESTful.",
        javascript: "JavaScript is the primary language of the web browser, and — via Node.js — a popular server-side language too. It's dynamically typed, event-driven, and asynchronous by design. TypeScript is a typed superset that compiles to JavaScript.",
        typescript: "TypeScript is JavaScript with static types. It adds compile-time type checking, interfaces, and tooling support without changing runtime behavior. It's become the standard for large-scale JavaScript projects.",
        python: "Python is a general-purpose, readable scripting language widely used in data science, machine learning, automation, and web backends. Its simplicity and rich library ecosystem (NumPy, Pandas, PyTorch) make it the dominant language for AI research.",
        blockchain: "A blockchain is a distributed ledger — a database replicated across many nodes, where records are grouped into blocks and linked cryptographically. Once written, entries are extremely difficult to alter. It underlies cryptocurrencies and some decentralized applications.",
        quantum: "Quantum computing uses quantum mechanical phenomena — superposition and entanglement — to process information in ways classical computers can't. While still early-stage, quantum systems show promise for cryptography, simulation, and optimization problems that are intractable classically.",
      };
      const key = subject.toLowerCase().trim();
      for (const [topic, definition] of Object.entries(knownTopics)) {
        if (key.includes(topic) || topic.includes(key)) return definition;
      }
      return isFollowUp
        ? `Could you narrow down what you mean by "${subject}"? I want to give you an accurate answer.`
        : `"${subject}" is something I can speak to more precisely with a bit more context. Are you looking for a technical definition, a conceptual overview, or something practical?`;
    }

    case "howto":
      return pick([
        `To ${subject}, the general approach is to start by understanding what you're working with, break the problem into steps, then tackle each one. Want me to walk through the specifics?`,
        `For ${subject}: the right method depends on your setup. Could you tell me what you're using or what you've already tried?`,
        `Good question on ${subject}. Could you share a bit more context so I can give you something concrete rather than generic?`,
      ]);

    case "yesno": {
      const isNegativeTopic = /\b(wrong|bad|harmful|dangerous|illegal|impossible)\b/i.test(message);
      if (isNegativeTopic) {
        return `That depends on context. The answer for "${subject}" isn't purely yes or no — the specifics matter. What's the situation?`;
      }
      return pick([
        `Generally, yes — though with some nuance depending on the context of "${subject}". Want me to elaborate?`,
        `In most cases, yes. There are edge cases worth knowing about — want me to run through them?`,
        `It depends. For "${subject}" the answer shifts based on a few variables. What's the specific scenario?`,
      ]);
    }

    case "general":
    default:
      return pick([
        `That's worth thinking through carefully. On "${subject}": could you tell me more about what you'd specifically like to understand?`,
        `Good question. For "${subject}", the clearest path in depends on what you're coming from. What's the context?`,
        `I can engage with that. What specifically about "${subject}" prompted the question?`,
        `On "${subject}" — are you looking to understand it conceptually, apply it practically, or something else?`,
      ]);
  }
}
