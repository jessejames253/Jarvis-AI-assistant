/**
 * lib/intent.ts — Intent classifier
 *
 * Analyses a user message and assigns an intent with a confidence score.
 *
 * ─── HOW CLASSIFICATION WORKS ────────────────────────────────────────────────
 * Each intent has a set of patterns (regex or keyword lists).
 * We check every pattern and accumulate a score for each intent.
 * The intent with the highest score wins.
 *
 * Confidence is calculated as:
 *   baseScore from the strongest matched pattern
 *   + bonus for each additional matched signal (capped at 0.97)
 *
 * The "signals" array records exactly which patterns matched — used in the debug panel.
 *
 * ─── ADDING A NEW INTENT ────────────────────────────────────────────────────
 * 1. Add the intent name to lib/types.ts → IntentType
 * 2. Add a descriptor in the INTENT_DESCRIPTORS array below
 * 3. Create a tool in lib/tools/ that handles it
 * 4. Register the tool in lib/tools/registry.ts
 */

import type { IntentType, ClassificationResult, HistoryEntry } from "./types";

interface IntentDescriptor {
  intent: IntentType;
  /** Strong signals — matching any of these gives a high base confidence */
  strongPatterns: RegExp[];
  /** Weaker signals — each matching one adds a small bonus */
  weakPatterns: RegExp[];
}

// ─── Pattern library ──────────────────────────────────────────────────────────

const DESCRIPTORS: IntentDescriptor[] = [
  {
    intent: "casual",
    strongPatterns: [
      /^(hi|hello|hey|good\s*(morning|afternoon|evening)|greetings|howdy)\b/i,
      /\bhow are you\b|\bhow('?re| are) you doing\b|\bare you (ok|alright|well)\b/i,
      /\b(bye|goodbye|see you|take care|later|cya)\b/i,
    ],
    weakPatterns: [
      /\b(thanks|thank you|thx|ty|appreciate|cheers)\b/i,
      /^(sup|yo|wassup|what'?s up)\b/i,
    ],
  },
  {
    intent: "identity",
    strongPatterns: [
      /\b(who|what) are you\b/i,
      /\byour (name|identity)\b|\bwho made you\b|\bwhat are you\b/i,
      /\babout yourself\b|\bintroduce yourself\b/i,
    ],
    weakPatterns: [
      /\bjarvas\b/i,
      /\bai assistant\b/i,
    ],
  },
  {
    intent: "memory_update",
    strongPatterns: [
      /\bmy name is\b|\bcall me\b|\bi('?m| am) called\b/i,
      /\bremember (that|this|my|me)\b|\bdon'?t forget\b/i,
      /\bmy preference\b|\bi prefer\b|\bi like to be called\b/i,
      /\bforget (everything|my|this|that|all)\b/i,
    ],
    weakPatterns: [
      /\bprefer\b|\bremember\b/i,
      /\bsave (this|that|my)\b/i,
    ],
  },
  {
    intent: "coding",
    strongPatterns: [
      /\b(debug|fix|bug|error|exception|stacktrace|undefined|null pointer)\b/i,
      /\b(write|build|implement|create|generate|scaffold)\s+(a |an |the )?(function|class|component|script|api|endpoint|hook|module)\b/i,
      /\b(javascript|typescript|python|rust|go|java|c\+\+|sql|html|css|react|vue|angular|node|express|next\.?js)\b/i,
      /\b(code|snippet|algorithm|regex|loop|array|object|interface|type|async|await|promise|callback)\b/i,
    ],
    weakPatterns: [
      /\b(function|variable|method|class|module|import|export)\b/i,
      /\b(refactor|optimize|clean up|review|lint)\b/i,
      /```|`[^`]+`/,
    ],
  },
  {
    intent: "research",
    strongPatterns: [
      /\b(latest|current|recent|today|right now|this (year|week|month|moment))\b/i,
      /\b(news|breaking news?|just announced|just released|just launched)\b/i,
      /\b(weather|stock (price|market)|scores?|live (results|data|update))\b/i,
      /\bsearch (for |the web for |online for )?/i,
      /\bwhat'?s happening\b|\bwhat happened\b/i,
    ],
    weakPatterns: [
      /\bfind (me |out |information)?\b/i,
      /\blook up\b|\bsearch\b/i,
    ],
  },
  {
    intent: "math",
    strongPatterns: [
      /\d+\s*[\+\-\*\/\^%]\s*\d+/,
      /\b(calculate|compute|solve|evaluate|what('?s| is)\s+\d)\b/i,
      /\b(square root|factorial|prime|fibonacci|percentage|average|mean|median)\b/i,
    ],
    weakPatterns: [
      /\b(how much|how many|total|sum|product|difference)\b/i,
      /\b(number|digit|formula|equation)\b/i,
    ],
  },
  {
    intent: "planning",
    strongPatterns: [
      /\b(plan|planning|roadmap|timeline|schedule|agenda)\b/i,
      /\b(todo|to-do|task list|action items?|next steps?)\b/i,
      /\b(how (do|should|can) (i|we) (approach|tackle|organize|prioritize))\b/i,
      /\b(break(down| it down)|step by step|step-by-step)\b/i,
    ],
    weakPatterns: [
      /\b(organize|structure|outline|approach|strategy)\b/i,
      /\b(goal|objective|milestone|deadline)\b/i,
    ],
  },
  {
    intent: "definition",
    strongPatterns: [
      /^(what is|what are|what does|define|explain|describe)\b/i,
      /\b(meaning of|definition of|difference between|how does .+ work)\b/i,
      /^(tell me about|give me an overview of|summarize)\b/i,
    ],
    weakPatterns: [
      /^(why|when|where) (is|are|does|do|was|were)\b/i,
      /\b(concept|term|topic|subject|idea)\b/i,
    ],
  },
];

// ─── Classifier ────────────────────────────────────────────────────────────────

interface ScoredIntent {
  intent: IntentType;
  score: number;
  signals: string[];
}

function scoreMessage(
  message: string,
  descriptor: IntentDescriptor,
  history: HistoryEntry[]
): ScoredIntent {
  const signals: string[] = [];
  let score = 0;
  let strongHits = 0;

  // Strong pattern matches: first hit sets 0.80 baseline, each additional
  // match adds 0.07 (capped later). This means "latest + news + today" all
  // hitting research gives 0.80 + 0.07 + 0.07 = 0.94 vs a single "what is"
  // giving definition only 0.80, correctly resolving the tie.
  for (const pattern of descriptor.strongPatterns) {
    if (pattern.test(message)) {
      const matched = message.match(pattern)?.[0]?.trim().slice(0, 40);
      signals.push(`strong match: "${matched}"`);
      if (strongHits === 0) score = Math.max(score, 0.80);
      else score += 0.07;
      strongHits++;
    }
  }

  // Weak pattern matches each add a bonus
  for (const pattern of descriptor.weakPatterns) {
    if (pattern.test(message)) {
      const matched = message.match(pattern)?.[0]?.trim().slice(0, 30);
      signals.push(`keyword: "${matched}"`);
      score += 0.08;
    }
  }

  // Context boost: if the last 2 messages were about this intent, give a small boost
  if (history.length >= 2) {
    const recentContent = history.slice(-2).map((h) => h.content).join(" ");
    const contextSignals = [...descriptor.strongPatterns, ...descriptor.weakPatterns].filter(
      (p) => p.test(recentContent)
    );
    if (contextSignals.length > 0) {
      score += 0.05;
      signals.push("context: recent history matches");
    }
  }

  return { intent: descriptor.intent, score: Math.min(score, 0.97), signals };
}

/**
 * Classifies a user message into an intent with a confidence score.
 * Returns the top intent and a list of signals that drove the classification.
 */
export function classifyIntent(
  message: string,
  history: HistoryEntry[] = []
): ClassificationResult {
  // Score every intent
  const scored: ScoredIntent[] = DESCRIPTORS.map((d) => scoreMessage(message, d, history));

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  const top = scored[0];
  const runnerUp = scored[1];

  // If nothing got a meaningful score, fall back to "general"
  if (top.score < 0.15) {
    return {
      intent: "general",
      confidence: 0.50,
      signals: ["no strong pattern matched — falling back to general"],
    };
  }

  return {
    intent: top.intent,
    confidence: Number(top.score.toFixed(2)),
    signals: top.signals,
    secondaryIntent: runnerUp && runnerUp.score > 0.15 ? runnerUp.intent : undefined,
  };
}
