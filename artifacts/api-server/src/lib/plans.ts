/**
 * lib/plans.ts — Planner Brain v1
 *
 * Generates structured multi-phase plans from a free-form goal using Claude,
 * persists them to .jarvas-data/plans/plans.json, and converts plan tasks
 * into master-task-list entries.
 *
 * Storage: {PROJECT_ROOT}/.jarvas-data/plans/plans.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { PROJECT_ROOT } from "./dev/tools";
import { addTask } from "./masterTasks";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlanStatus   = "draft" | "approved" | "converting" | "converted" | "archived";
export type TaskStatus   = "pending" | "converted";
export type Priority     = "low" | "medium" | "high";
export type Effort       = "small" | "medium" | "large";
export type RiskSeverity = "low" | "medium" | "high";

export interface PlanTask {
  id:              string;
  title:           string;
  phaseId:         string;
  priority:        Priority;
  estimatedEffort: Effort;
  dependsOn:       string[];
  status:          TaskStatus;
}

export interface PlanPhase {
  id:    string;
  title: string;
  order: number;
  tasks: PlanTask[];
}

export interface PlanRisk {
  id:          string;
  description: string;
  severity:    RiskSeverity;
  mitigation:  string;
}

export interface Plan {
  id:                    string;
  title:                 string;
  goal:                  string;
  createdAt:             string;
  updatedAt:             string;
  status:                PlanStatus;
  phases:                PlanPhase[];
  tasks:                 PlanTask[];   // flat list (same tasks as in phases)
  risks:                 PlanRisk[];
  recommendedNextAction: string;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const PLANS_DIR  = path.join(PROJECT_ROOT, ".jarvas-data", "plans");
const PLANS_FILE = path.join(PLANS_DIR, "plans.json");

function ensureDir(): void {
  if (!existsSync(PLANS_DIR)) mkdirSync(PLANS_DIR, { recursive: true });
}

function readAll(): Plan[] {
  ensureDir();
  if (!existsSync(PLANS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(PLANS_FILE, "utf-8")) as Plan[];
  } catch { return []; }
}

function writeAll(plans: Plan[]): void {
  ensureDir();
  writeFileSync(PLANS_FILE, JSON.stringify(plans, null, 2) + "\n", "utf-8");
}

// ─── Public CRUD ──────────────────────────────────────────────────────────────

export function listPlans(): Plan[] {
  return readAll().sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function getPlan(id: string): Plan | undefined {
  return readAll().find(p => p.id === id);
}

export function savePlan(plan: Plan): Plan {
  const all     = readAll();
  const idx     = all.findIndex(p => p.id === plan.id);
  const updated = { ...plan, updatedAt: new Date().toISOString() };
  if (idx >= 0) { all[idx] = updated; }
  else          { all.push(updated); }
  writeAll(all);
  return updated;
}

export function updatePlan(id: string, patch: Partial<Plan>): Plan {
  const plan = getPlan(id);
  if (!plan) throw new Error(`Plan ${id} not found`);
  return savePlan({ ...plan, ...patch });
}

// ─── Claude generation system prompt ─────────────────────────────────────────

const PLANNER_SYSTEM = `\
You are a senior software architect and agile project planner.
Given a goal, produce a detailed, actionable project plan as valid JSON.
Return ONLY the JSON object — no markdown, no explanation, no code fences.

Schema:
{
  "phases": [
    {
      "title": "Phase name",
      "order": 1,
      "tasks": [
        {
          "title": "Specific, actionable task",
          "priority": "high|medium|low",
          "estimatedEffort": "small|medium|large"
        }
      ]
    }
  ],
  "risks": [
    {
      "description": "Risk description",
      "severity": "high|medium|low",
      "mitigation": "How to reduce this risk"
    }
  ],
  "recommendedNextAction": "The single most important first step"
}

Guidelines:
- Generate 2–5 phases in logical order (e.g. Planning → Implementation → Testing → Deployment)
- 3–8 tasks per phase; tasks should be specific and actionable
- 2–4 identified risks
- Priority: "high" for blockers and critical path, "medium" for important, "low" for nice-to-have
- Effort: "small" ≤ 2h, "medium" ≤ 1d, "large" > 1d`;

// ─── Claude JSON extraction helper ───────────────────────────────────────────

interface RawClaudeTask {
  title:            string;
  priority?:        string;
  estimatedEffort?: string;
}

interface RawClaudePhase {
  title:  string;
  order?: number;
  tasks:  RawClaudeTask[];
}

interface RawClaudeRisk {
  description: string;
  severity?:   string;
  mitigation?: string;
}

interface RawClaudePlan {
  phases:                RawClaudePhase[];
  risks:                 RawClaudeRisk[];
  recommendedNextAction: string;
}

function extractJson(text: string): RawClaudePlan {
  // Strip markdown fences if present
  const stripped = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  // Find the outermost JSON object
  const start = stripped.indexOf("{");
  const end   = stripped.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found in model response");
  const json = stripped.slice(start, end + 1);
  return JSON.parse(json) as RawClaudePlan;
}

const VALID_PRIORITY: Priority[]     = ["low", "medium", "high"];
const VALID_EFFORT:   Effort[]       = ["small", "medium", "large"];
const VALID_SEVERITY: RiskSeverity[] = ["low", "medium", "high"];

function normPriority(v?: string): Priority  { return VALID_PRIORITY.includes(v as Priority)  ? v as Priority  : "medium"; }
function normEffort(v?:   string): Effort    { return VALID_EFFORT.includes(v   as Effort)    ? v as Effort    : "medium"; }
function normSeverity(v?: string): RiskSeverity { return VALID_SEVERITY.includes(v as RiskSeverity) ? v as RiskSeverity : "medium"; }

// ─── Main plan generation ─────────────────────────────────────────────────────

export async function generatePlan(title: string, goal: string): Promise<Plan> {
  const response = await anthropic.messages.create({
    model:      "claude-sonnet-4-6",
    max_tokens: 4096,
    system:     PLANNER_SYSTEM,
    messages:   [{ role: "user", content: `Title: ${title}\n\nGoal: ${goal}` }],
  });

  const text = response.content
    .filter(b => b.type === "text")
    .map(b => (b as { type: "text"; text: string }).text)
    .join("");

  const raw    = extractJson(text);
  const now    = new Date().toISOString();
  const planId = randomUUID();

  // Assemble phases + flat task list
  const phases: PlanPhase[] = (raw.phases ?? []).map((rp, i) => {
    const phaseId = randomUUID();
    const tasks: PlanTask[] = (rp.tasks ?? []).map(rt => ({
      id:              randomUUID(),
      title:           String(rt.title ?? "Untitled task"),
      phaseId,
      priority:        normPriority(rt.priority),
      estimatedEffort: normEffort(rt.estimatedEffort),
      dependsOn:       [],
      status:          "pending" as TaskStatus,
    }));
    return {
      id:    phaseId,
      title: String(rp.title ?? `Phase ${i + 1}`),
      order: typeof rp.order === "number" ? rp.order : i + 1,
      tasks,
    };
  });

  const tasks: PlanTask[] = phases.flatMap(p => p.tasks);

  const risks: PlanRisk[] = (raw.risks ?? []).map(rr => ({
    id:          randomUUID(),
    description: String(rr.description ?? ""),
    severity:    normSeverity(rr.severity),
    mitigation:  String(rr.mitigation ?? ""),
  }));

  const plan: Plan = {
    id:                    planId,
    title:                 String(title),
    goal:                  String(goal),
    createdAt:             now,
    updatedAt:             now,
    status:                "draft",
    phases,
    tasks,
    risks,
    recommendedNextAction: String(raw.recommendedNextAction ?? "Review the plan and approve the first phase."),
  };

  return savePlan(plan);
}

// ─── Convert plan tasks → master task list ────────────────────────────────────

export interface ConvertResult {
  converted: number;
  skipped:   number;
  taskIds:   string[];
}

export function convertPlanToTasks(id: string): ConvertResult {
  const plan = getPlan(id);
  if (!plan) throw new Error(`Plan ${id} not found`);

  let converted = 0;
  let skipped   = 0;
  const taskIds: string[] = [];

  const updatedPhases = plan.phases.map(phase => ({
    ...phase,
    tasks: phase.tasks.map(t => {
      if (t.status === "converted") { skipped++; return t; }
      try {
        addTask({
          id:       t.id,
          title:    t.title,
          priority: t.priority,
          status:   "pending",
        });
        converted++;
        taskIds.push(t.id);
        return { ...t, status: "converted" as TaskStatus };
      } catch {
        // addTask throws on duplicate IDs — treat as already-converted
        skipped++;
        return { ...t, status: "converted" as TaskStatus };
      }
    }),
  }));

  const updatedTasks = plan.tasks.map(t => {
    const found = updatedPhases.flatMap(p => p.tasks).find(pt => pt.id === t.id);
    return found ?? t;
  });

  const allConverted = updatedTasks.every(t => t.status === "converted");
  const newStatus: PlanStatus = allConverted ? "converted" : "converting";

  savePlan({ ...plan, phases: updatedPhases, tasks: updatedTasks, status: newStatus });
  return { converted, skipped, taskIds };
}
