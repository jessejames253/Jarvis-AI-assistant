/**
 * lib/agentCollaboration.ts — Agent Collaboration v1
 *
 * Given a goal, uses Claude + the 6 specialist agent profiles to produce
 * a multi-agent collaboration plan:
 *   - lead agent + why
 *   - supporting agents with responsibilities + expected outputs
 *   - ordered handoff chain (who passes what to whom)
 *   - risks with mitigations
 *
 * Read-only planning: no agent work is executed.
 * Plan cached at .jarvas-data/agents/last-collaboration.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path                                                    from "path";
import { anthropic }                                           from "@workspace/integrations-anthropic-ai";
import { loadProfiles, type AgentProfile }                    from "./agentProfiles";
import { PROJECT_ROOT }                                        from "./dev/tools";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentRef {
  agentId:   string;
  agentName: string;
  role:      string;
  color:     string;
  emoji:     string;
}

export interface SupportingAgent extends AgentRef {
  responsibility:  string;
  expectedOutput:  string;
  handoffPosition: number; // 1-based order in the collaboration
}

export interface HandoffStep {
  stepNumber:  number;
  fromAgent:   AgentRef | null; // null = project start
  toAgent:     AgentRef;
  artifact:    string;          // what is passed / delivered at this step
  description: string;
}

export interface CollaborationRisk {
  description: string;
  severity:    "high" | "medium" | "low";
  mitigation:  string;
}

export interface CollaborationPlan {
  goal:             string;
  plannedAt:        string;
  summary:          string;
  leadAgent:        SupportingAgent;
  supportingAgents: SupportingAgent[];
  handoffOrder:     HandoffStep[];
  risks:            CollaborationRisk[];
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const STORE_DIR = path.join(PROJECT_ROOT, ".jarvas-data", "agents");
const PLAN_FILE = path.join(STORE_DIR, "last-collaboration.json");

function ensureDir(): void {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
}

export function readLastCollaboration(): CollaborationPlan | null {
  try {
    return JSON.parse(readFileSync(PLAN_FILE, "utf-8")) as CollaborationPlan;
  } catch { return null; }
}

function savePlan(plan: CollaborationPlan): void {
  ensureDir();
  writeFileSync(PLAN_FILE, JSON.stringify(plan, null, 2) + "\n", "utf-8");
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert engineering team coordinator for the Jarvis AI project.
Your job is to analyse a goal and design the optimal collaboration plan across a team of specialist agents.
Each agent has unique strengths — choose only those that genuinely add value.
Respond with ONLY valid JSON matching the schema exactly — no prose outside the JSON.`;

function buildProfileContext(profiles: AgentProfile[]): string {
  return profiles.map(p =>
    `ID: ${p.id} | Name: ${p.name} | Role: ${p.role}
 Description: ${p.description}
 Specialties: ${p.specialties.join(", ")}
 Preferred changes: ${p.preferredChangeTypes.join(", ")}`
  ).join("\n\n");
}

function buildPrompt(goal: string, profileCtx: string): string {
  return `## Available Specialist Agents

${profileCtx}

---

## Goal

${goal}

---

Design the optimal multi-agent collaboration plan for this goal. Respond with a JSON object with EXACTLY this shape:

{
  "summary": "<2-3 sentence overview of the collaboration approach>",
  "leadAgent": {
    "agentId": "<id from profiles above>",
    "agentName": "<name>",
    "role": "<role>",
    "responsibility": "<what the lead agent is specifically responsible for>",
    "expectedOutput": "<concrete deliverable from the lead agent>",
    "handoffPosition": 1
  },
  "supportingAgents": [
    {
      "agentId": "<id>",
      "agentName": "<name>",
      "role": "<role>",
      "responsibility": "<specific responsibility in this collaboration>",
      "expectedOutput": "<concrete deliverable>",
      "handoffPosition": <2, 3, 4, ...>
    }
  ],
  "handoffOrder": [
    {
      "stepNumber": 1,
      "fromAgent": null,
      "toAgent": { "agentId": "<id>", "agentName": "<name>", "role": "<role>" },
      "artifact": "<what is being handed off or started>",
      "description": "<what happens at this step>"
    },
    {
      "stepNumber": 2,
      "fromAgent": { "agentId": "<id>", "agentName": "<name>", "role": "<role>" },
      "toAgent": { "agentId": "<id>", "agentName": "<name>", "role": "<role>" },
      "artifact": "<what is passed from the previous agent to the next>",
      "description": "<what happens at this step>"
    }
  ],
  "risks": [
    {
      "description": "<risk>",
      "severity": "high" | "medium" | "low",
      "mitigation": "<how to address it>"
    }
  ]
}

Rules:
- Use 2–5 agents total (lead + 1-4 supporting). Only include agents that genuinely contribute.
- handoffOrder must cover every agent in sequence, starting with fromAgent: null.
- The last handoffStep represents the final deliverable.
- Provide 2–4 risks.
- agentId and agentName must match exactly from the profiles list above.`;
}

// ─── JSON extractor ───────────────────────────────────────────────────────────

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  if (start === -1) throw new Error("No JSON found in Claude response");
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return text.slice(start);
}

// ─── Profile ref helper ───────────────────────────────────────────────────────

function enrichRef(
  raw: { agentId: string; agentName: string; role: string },
  profiles: AgentProfile[],
): AgentRef {
  const p = profiles.find(pr => pr.id === raw.agentId);
  return {
    agentId:   raw.agentId,
    agentName: p?.name  ?? raw.agentName,
    role:      p?.role  ?? raw.role,
    color:     p?.color ?? "hsl(196 60% 55%)",
    emoji:     p?.emoji ?? "🤖",
  };
}

function enrichSupportingAgent(
  raw: {
    agentId: string; agentName: string; role: string;
    responsibility: string; expectedOutput: string; handoffPosition: number;
  },
  profiles: AgentProfile[],
): SupportingAgent {
  const ref = enrichRef(raw, profiles);
  return {
    ...ref,
    responsibility:  raw.responsibility  ?? "",
    expectedOutput:  raw.expectedOutput  ?? "",
    handoffPosition: raw.handoffPosition ?? 1,
  };
}

// ─── Public: plan collaboration ───────────────────────────────────────────────

export async function planCollaboration(goal: string): Promise<CollaborationPlan> {
  const profiles   = loadProfiles();
  const profileCtx = buildProfileContext(profiles);
  const prompt     = buildPrompt(goal.trim(), profileCtx);

  const response = await anthropic.messages.create({
    model:      "claude-sonnet-4-6",
    max_tokens: 4096,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: "user", content: prompt }],
  });

  const rawText = response.content
    .filter(b => b.type === "text")
    .map(b => (b as { type: "text"; text: string }).text)
    .join("");

  const parsed = JSON.parse(extractJson(rawText)) as {
    summary:          string;
    leadAgent:        { agentId: string; agentName: string; role: string; responsibility: string; expectedOutput: string; handoffPosition: number };
    supportingAgents: Array<{ agentId: string; agentName: string; role: string; responsibility: string; expectedOutput: string; handoffPosition: number }>;
    handoffOrder:     Array<{ stepNumber: number; fromAgent: { agentId: string; agentName: string; role: string } | null; toAgent: { agentId: string; agentName: string; role: string }; artifact: string; description: string }>;
    risks:            Array<{ description: string; severity: "high"|"medium"|"low"; mitigation: string }>;
  };

  const leadAgent: SupportingAgent = enrichSupportingAgent(parsed.leadAgent, profiles);

  const supportingAgents: SupportingAgent[] = (parsed.supportingAgents ?? [])
    .map(s => enrichSupportingAgent(s, profiles));

  const handoffOrder: HandoffStep[] = (parsed.handoffOrder ?? []).map((h, i) => ({
    stepNumber:  h.stepNumber ?? i + 1,
    fromAgent:   h.fromAgent ? enrichRef(h.fromAgent, profiles) : null,
    toAgent:     enrichRef(h.toAgent, profiles),
    artifact:    h.artifact    ?? "",
    description: h.description ?? "",
  }));

  const risks: CollaborationRisk[] = (parsed.risks ?? []).map(r => ({
    description: r.description ?? "",
    severity:    (["high","medium","low"].includes(r.severity) ? r.severity : "medium") as "high"|"medium"|"low",
    mitigation:  r.mitigation  ?? "",
  }));

  const plan: CollaborationPlan = {
    goal,
    plannedAt:        new Date().toISOString(),
    summary:          parsed.summary ?? "",
    leadAgent,
    supportingAgents,
    handoffOrder,
    risks,
  };

  savePlan(plan);
  return plan;
}
