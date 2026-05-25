/**
 * lib/ltm/extractor.ts — LTM fact extraction
 *
 * Two-phase approach to keep cost low:
 *
 * Phase 1 — Heuristic pre-filter: fast regex scan of the user message.
 *   If nothing personal / project / coding-relevant is detected, the
 *   extraction is skipped entirely (no Claude call).
 *
 * Phase 2 — Claude extraction: a lightweight max_tokens=350 call that
 *   returns a JSON array of categorised facts. Only runs when Phase 1 fires.
 *
 * The result is fed into addOrUpdateEntry() which deduplicates automatically.
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { MemoryCategory } from "./store";

// ─── Phase 1: heuristic triggers ─────────────────────────────────────────────

const EXTRACTION_TRIGGERS: RegExp[] = [
  /\b(i am|i'm|i work(ing)?|i use|i prefer|i like|i need|my name is|call me)\b/i,
  /\b(working on|building|developing|creating|launching)\b.{0,60}\b(project|app|site|tool|startup|product|platform|service|bot|game)\b/i,
  /\b(i'?m a|i am a|i work as)\b.{0,40}\b(developer|engineer|designer|student|founder|freelancer|manager|researcher|architect|devops|sre)\b/i,
  /\b(prefer|always use|usually use|love using|hate using|don'?t like|can'?t stand)\b/i,
  /\bmy\s+(job|role|title|company|team|stack|language|framework|database|backend|frontend|editor|ide)\b/i,
  /\b(years? of experience|been (coding|programming|working|building) (for|since))\b/i,
  /\b(my (main|primary|favourite|favorite|go[\-\s]?to) (language|tool|framework|library|db|database))\b/i,
  /\bi('?m| am) (learning|studying|exploring)\b/i,
];

export function shouldExtract(message: string): boolean {
  return EXTRACTION_TRIGGERS.some((p) => p.test(message));
}

// ─── Phase 2: Claude extraction ───────────────────────────────────────────────

export interface ExtractedFact {
  category: MemoryCategory;
  content: string;
  tags: string[];
}

const VALID_CATEGORIES = new Set<MemoryCategory>(["personal", "coding", "projects", "preferences"]);

const EXTRACTION_SYSTEM = `You are a memory extraction system for an AI assistant named Jarvis.
Analyse the user message and extract memorable, specific facts about the user.
Return ONLY a valid JSON array — no prose, no markdown, no code fences.

Each element must be an object with exactly these fields:
  category: one of "personal" | "coding" | "projects" | "preferences"
  content:  a short declarative sentence about the user (≤90 chars, start with "User…" or "Prefers…" or "Working on…")
  tags:     array of 2–5 lowercase single-word keywords

Guidelines:
- personal:     name, location, job title, background, interests, age
- coding:       languages, tools, frameworks, editors, patterns, experience level
- projects:     active projects, goals, tech stack of those projects
- preferences:  communication style, verbosity, explanation depth, format

Rules:
- Only extract clear, specific, factual statements — not questions, not vague opinions.
- Skip anything that is too generic (e.g. "User likes coding").
- If nothing is worth storing, return [].

Examples:
  Input: "My name is Sarah and I'm a senior frontend engineer at Stripe"
  Output: [{"category":"personal","content":"User's name is Sarah, senior frontend engineer at Stripe","tags":["sarah","frontend","engineer","stripe"]},{"category":"coding","content":"Works as a senior frontend engineer","tags":["frontend","senior","engineer"]}]

  Input: "I'm building a SaaS analytics dashboard in Next.js and Postgres"
  Output: [{"category":"projects","content":"Building a SaaS analytics dashboard with Next.js and Postgres","tags":["saas","analytics","nextjs","postgres","dashboard"]}]

  Input: "I prefer short, direct answers without unnecessary examples"
  Output: [{"category":"preferences","content":"Prefers short, direct answers without unnecessary examples","tags":["short","direct","concise","preferences"]}]`;

export async function extractFacts(userMessage: string): Promise<ExtractedFact[]> {
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 350,
      system: EXTRACTION_SYSTEM,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = (response.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();

    // Parse the JSON array — try the whole response first, then find the
    // outermost [...] bracket (greedy, so we get the full array not a sub-array)
    let parsed: unknown[];
    try {
      const trimmed = text.trim();
      parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) return [];
    } catch {
      // Find outermost [...] using greedy match (not lazy *?)
      const start = text.indexOf("[");
      const end = text.lastIndexOf("]");
      if (start === -1 || end === -1 || end <= start) return [];
      try {
        const candidate = text.slice(start, end + 1);
        parsed = JSON.parse(candidate);
        if (!Array.isArray(parsed)) return [];
      } catch {
        return [];
      }
    }

    return parsed.filter((item): item is ExtractedFact => {
      if (typeof item !== "object" || item === null) return false;
      const it = item as Record<string, unknown>;
      return (
        typeof it.content === "string" &&
        it.content.length > 0 &&
        it.content.length <= 120 &&
        VALID_CATEGORIES.has(it.category as MemoryCategory) &&
        Array.isArray(it.tags)
      );
    });
  } catch {
    return [];
  }
}
