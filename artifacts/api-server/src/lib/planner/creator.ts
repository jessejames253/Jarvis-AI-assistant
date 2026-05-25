/**
 * lib/planner/creator.ts — Asks Claude to turn a user goal into a structured plan.
 *
 * Claude returns JSON; we parse it into a Plan object with all steps set to "pending".
 * Steps are kept to 2–6 to ensure focused, executable units.
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { Plan, PlanStep } from "./types";

const PLANNER_SYSTEM_PROMPT = `You are a task planner. Given a goal, break it into 2–6 clear, executable steps.

Output ONLY valid JSON — no markdown fences, no explanation, just the JSON object:
{
  "title": "Short descriptive plan title (max 8 words)",
  "steps": [
    { "id": "s1", "title": "Specific step title", "hint": "Optional brief instruction for how to do it" },
    { "id": "s2", "title": "Next step title" }
  ]
}

Rules:
- Each step title should be action-oriented and specific
- "hint" is optional — include it only when extra context helps
- Steps should be logically ordered
- Keep each step focused on a single action
- Use available tools: search_web, get_weather, calculate, create_reminder, lookup_memory, run_code, save_note`;

interface RawStep {
  id?: string;
  title: string;
  hint?: string;
}

interface RawPlan {
  title: string;
  steps: RawStep[];
}

function extractJSON(text: string): RawPlan {
  // Strip markdown code fences if present
  const clean = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();

  // Try direct parse
  try {
    return JSON.parse(clean) as RawPlan;
  } catch {
    // Extract the first {...} block
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Planner returned no JSON");
    return JSON.parse(match[0]) as RawPlan;
  }
}

export async function createPlan(goal: string, sessionId: string): Promise<Plan> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: PLANNER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: goal }],
  });

  const raw = response.content[0];
  const text = raw.type === "text" ? raw.text : "";
  const parsed = extractJSON(text);

  if (!parsed.title || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    throw new Error("Invalid plan structure returned by Claude");
  }

  const steps: PlanStep[] = parsed.steps.slice(0, 6).map((s, i) => ({
    id: s.id ?? `s${i + 1}`,
    title: s.title,
    hint: s.hint,
    status: "pending",
    retryCount: 0,
  }));

  return {
    id: crypto.randomUUID(),
    sessionId,
    goal,
    title: parsed.title,
    steps,
    status: "running",
    createdAt: Date.now(),
  };
}
