/**
 * lib/workOrderExecutionPlanner.ts — Work Order Execution Planning v1
 *
 * Generates a dry-run execution plan for a work order using Claude.
 * Plans are read-only — no agent code is executed.
 *
 * Stored as an object keyed by workOrderId:
 *   .jarvas-data/agents/work-order-execution-plans.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path                                                    from "path";
import { anthropic }                                           from "@workspace/integrations-anthropic-ai";
import { loadWorkOrders, type WorkOrder }                      from "./workOrders";
import { readLastCollaboration }                               from "./agentCollaboration";
import { loadProfiles }                                        from "./agentProfiles";
import { PROJECT_ROOT }                                        from "./dev/tools";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Difficulty     = "low" | "medium" | "high" | "critical";
export type Recommendation = "proceed" | "revise" | "block";
export type SafetyResult   = "pass" | "warn" | "fail";
export type FileChange     = "create" | "modify" | "delete" | "read";
export type ValidationType = "test" | "lint" | "typecheck" | "manual" | "automated";

export interface ProposedStep {
  stepNumber:  number;
  action:      string;
  detail:      string;
  reversible:  boolean;
}

export interface FileImpact {
  path:   string;
  change: FileChange;
  reason: string;
}

export interface SafetyCheck {
  check:  string;
  result: SafetyResult;
  detail: string;
}

export interface ExecutionRisk {
  description: string;
  severity:    "high" | "medium" | "low";
  mitigation:  string;
}

export interface ValidationStep {
  description: string;
  type:        ValidationType;
}

export interface AssignedAgent {
  agentId:    string;
  agentName:  string;
  agentColor: string;
  agentEmoji: string;
  role:       string;
}

export interface ExecutionPlan {
  workOrderId:          string;
  assignedAgent:        AssignedAgent;
  objective:            string;
  requiredInputs:       string[];
  proposedSteps:        ProposedStep[];
  filesLikelyAffected:  FileImpact[];
  safetyChecks:         SafetyCheck[];
  risks:                ExecutionRisk[];
  validationPlan:       ValidationStep[];
  estimatedDifficulty:  Difficulty;
  recommendation:       Recommendation;
  plannedAt:            string;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const STORE_DIR  = path.join(PROJECT_ROOT, ".jarvas-data", "agents");
const PLANS_FILE = path.join(STORE_DIR, "work-order-execution-plans.json");

function ensureDir(): void {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
}

function loadAllPlans(): Record<string, ExecutionPlan> {
  try {
    return JSON.parse(readFileSync(PLANS_FILE, "utf-8")) as Record<string, ExecutionPlan>;
  } catch { return {}; }
}

function savePlan(workOrderId: string, plan: ExecutionPlan): void {
  ensureDir();
  const all = loadAllPlans();
  all[workOrderId] = plan;
  writeFileSync(PLANS_FILE, JSON.stringify(all, null, 2) + "\n", "utf-8");
}

export function readExecutionPlan(workOrderId: string): ExecutionPlan | null {
  return loadAllPlans()[workOrderId] ?? null;
}

export function readAllExecutionPlans(): Record<string, ExecutionPlan> {
  return loadAllPlans();
}

// ─── Workspace summary (optional context) ─────────────────────────────────────

function workspaceSummary(): string {
  try {
    const mapFile = path.join(PROJECT_ROOT, ".jarvas-data", "workspace", "workspace-map.json");
    if (!existsSync(mapFile)) return "";
    const map = JSON.parse(readFileSync(mapFile, "utf-8")) as {
      artifacts?: Array<{ name: string; type: string; rootDir: string }>;
      summary?: { totalFiles: number; totalLines: number; languages: Record<string, number> };
    };
    const arts = (map.artifacts ?? []).map(a => `  ${a.name} (${a.type}) → ${a.rootDir}`).join("\n");
    const langs = Object.entries(map.summary?.languages ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([l, n]) => `${l}: ${n}`)
      .join(", ");
    return `Workspace: ${map.summary?.totalFiles ?? "?"} files (${langs})\nArtifacts:\n${arts}`;
  } catch { return ""; }
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior software architect performing a dry-run execution analysis.
Your job is to produce a detailed, realistic execution plan for a work order assigned to an AI agent.
This is a PLANNING exercise — no code is executed.
Think carefully about what the agent would realistically need to do, what files would be touched, and what could go wrong.
Respond with ONLY valid JSON matching the schema exactly — no prose outside the JSON.`;

function buildPrompt(order: WorkOrder, siblings: WorkOrder[], wsContext: string): string {
  const siblingContext = siblings.length > 0
    ? siblings.map(s => `  - [${s.status}] ${s.agentName}: ${s.objective.slice(0, 80)}`).join("\n")
    : "  (No sibling orders)";

  return `## Work Order to Plan

Agent:            ${order.agentEmoji} ${order.agentName} (${order.agentId})
Objective:        ${order.objective}
Inputs:           ${order.inputs.join(" | ")}
Expected Output:  ${order.expectedOutput}
Risk Level:       ${order.riskLevel}
Current Status:   ${order.status}
Dependencies:     ${order.dependencyNames.length > 0 ? order.dependencyNames.join(", ") : "None (first in chain)"}

## Sibling Work Orders in This Collaboration Plan

${siblingContext}

${wsContext ? `## Project Context\n\n${wsContext}\n` : ""}
---

Produce a dry-run execution plan for this work order. Respond with a JSON object of EXACTLY this shape:

{
  "objective": "<restate the objective in concrete, actionable terms>",
  "requiredInputs": ["<what must exist/be ready before this agent can start>", ...],
  "proposedSteps": [
    {
      "stepNumber": 1,
      "action": "<short verb phrase>",
      "detail": "<1-2 sentences on what happens at this step>",
      "reversible": true | false
    }
  ],
  "filesLikelyAffected": [
    {
      "path": "<relative path, e.g. src/models/notification.ts>",
      "change": "create" | "modify" | "delete" | "read",
      "reason": "<why this file is affected>"
    }
  ],
  "safetyChecks": [
    {
      "check": "<safety gate description>",
      "result": "pass" | "warn" | "fail",
      "detail": "<why this passes/warns/fails for this specific work order>"
    }
  ],
  "risks": [
    {
      "description": "<specific risk for this work order>",
      "severity": "high" | "medium" | "low",
      "mitigation": "<concrete mitigation>"
    }
  ],
  "validationPlan": [
    {
      "description": "<validation step>",
      "type": "test" | "lint" | "typecheck" | "manual" | "automated"
    }
  ],
  "estimatedDifficulty": "low" | "medium" | "high" | "critical",
  "recommendation": "proceed" | "revise" | "block"
}

Rules:
- proposedSteps: 3–8 concrete steps (not vague — name specific actions/files/patterns)
- filesLikelyAffected: 2–8 files with realistic paths for this project
- safetyChecks: 3–5 checks (e.g. "No destructive DB migrations", "No hardcoded secrets", "Type safety verified")
- risks: 2–4 risks specific to this agent's task
- validationPlan: 2–5 validation steps mixing types
- recommendation: "block" only if there is a fundamental blocker; "revise" if inputs or dependencies are unclear; "proceed" if everything looks good
- reversible: false for DB writes, file deletes, deployments; true for everything else`;
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

// ─── Public: plan execution ───────────────────────────────────────────────────

export async function planExecution(workOrderId: string): Promise<ExecutionPlan> {
  const allOrders = loadWorkOrders();
  const order     = allOrders.find(o => o.id === workOrderId);
  if (!order) throw new Error(`Work order '${workOrderId}' not found.`);

  const siblings  = allOrders.filter(
    o => o.collaborationPlanId === order.collaborationPlanId && o.id !== order.id,
  );
  const wsCtx = workspaceSummary();

  // Enrich agent ref with profile data
  const profiles  = loadProfiles();
  const profile   = profiles.find(p => p.id === order.agentId);

  const prompt   = buildPrompt(order, siblings, wsCtx);
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

  type RawPlan = {
    objective:            string;
    requiredInputs:       string[];
    proposedSteps:        Array<{ stepNumber: number; action: string; detail: string; reversible: boolean }>;
    filesLikelyAffected:  Array<{ path: string; change: string; reason: string }>;
    safetyChecks:         Array<{ check: string; result: string; detail: string }>;
    risks:                Array<{ description: string; severity: string; mitigation: string }>;
    validationPlan:       Array<{ description: string; type: string }>;
    estimatedDifficulty:  string;
    recommendation:       string;
  };

  const raw = JSON.parse(extractJson(rawText)) as RawPlan;

  const DIFFICULTIES: Difficulty[]     = ["low", "medium", "high", "critical"];
  const RECOMMENDATIONS: Recommendation[] = ["proceed", "revise", "block"];
  const SAFETY_RESULTS: SafetyResult[] = ["pass", "warn", "fail"];
  const FILE_CHANGES: FileChange[]     = ["create", "modify", "delete", "read"];
  const VAL_TYPES: ValidationType[]    = ["test", "lint", "typecheck", "manual", "automated"];

  const plan: ExecutionPlan = {
    workOrderId,
    assignedAgent: {
      agentId:    order.agentId,
      agentName:  order.agentName,
      agentColor: order.agentColor,
      agentEmoji: order.agentEmoji,
      role:       profile?.role ?? order.agentId,
    },
    objective:      raw.objective ?? order.objective,
    requiredInputs: (raw.requiredInputs ?? order.inputs).filter(Boolean),
    proposedSteps:  (raw.proposedSteps ?? []).map((s, i) => ({
      stepNumber:  s.stepNumber ?? i + 1,
      action:      s.action  ?? "",
      detail:      s.detail  ?? "",
      reversible:  Boolean(s.reversible),
    })),
    filesLikelyAffected: (raw.filesLikelyAffected ?? []).map(f => ({
      path:   f.path   ?? "",
      change: (FILE_CHANGES.includes(f.change as FileChange) ? f.change : "modify") as FileChange,
      reason: f.reason ?? "",
    })),
    safetyChecks: (raw.safetyChecks ?? []).map(s => ({
      check:  s.check  ?? "",
      result: (SAFETY_RESULTS.includes(s.result as SafetyResult) ? s.result : "warn") as SafetyResult,
      detail: s.detail ?? "",
    })),
    risks: (raw.risks ?? []).map(r => ({
      description: r.description ?? "",
      severity:    (["high","medium","low"].includes(r.severity) ? r.severity : "medium") as ExecutionRisk["severity"],
      mitigation:  r.mitigation  ?? "",
    })),
    validationPlan: (raw.validationPlan ?? []).map(v => ({
      description: v.description ?? "",
      type:        (VAL_TYPES.includes(v.type as ValidationType) ? v.type : "manual") as ValidationType,
    })),
    estimatedDifficulty: (DIFFICULTIES.includes(raw.estimatedDifficulty as Difficulty)
      ? raw.estimatedDifficulty : "medium") as Difficulty,
    recommendation: (RECOMMENDATIONS.includes(raw.recommendation as Recommendation)
      ? raw.recommendation : "revise") as Recommendation,
    plannedAt: new Date().toISOString(),
  };

  savePlan(workOrderId, plan);
  return plan;
}
