/**
 * lib/autonomy/analyzer.ts — Self-improvement analysis engine
 *
 * Scans eight signal sources and feeds findings to Claude,
 * which synthesizes them into structured ImprovementSuggestion objects.
 *
 * Signal sources:
 *   1. task_backlog          — unresolved entries in .jarvas-data task stores
 *   2. failed_execution      — failed/partial work-order executions
 *   3. repeated_warnings     — execution plans with warn/fail safety checks
 *   4. low_completion_agent  — agents with low work-order completion rates
 *   5. missing_validation    — work orders with no execution plan or empty validation
 *   6. empty_data_store      — missing or empty .jarvas-data files
 *   7. route_without_panel   — route files without corresponding UI panels
 *   8. panel_without_actions — panel components with no API action buttons
 *
 * Analysis is READ-ONLY — no writes happen during scanning.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path                from "path";
import { anthropic }       from "@workspace/integrations-anthropic-ai";
import { PROJECT_ROOT }    from "../dev/tools";
import { loadWorkOrders }  from "../workOrders";
import { loadExecutions }  from "../workOrderExecutionEngine";
import { readExecutionPlan } from "../workOrderExecutionPlanner";
import { loadProfiles }    from "../agentProfiles";
import type { ImprovementSuggestion, SuggestedWorkOrder, AnalysisCategory, SuggestionSeverity } from "./suggestions";

// ─── Raw scan snapshot ────────────────────────────────────────────────────────

interface AgentStat {
  agentId:        string;
  agentName:      string;
  total:          number;
  completed:      number;
  pending:        number;
  blocked:        number;
  completionRate: number;
}

interface ExecStat {
  workOrderId: string;
  agentName:   string;
  status:      string;
  errors:      string[];
  actionsPlanned: number;
  actionsExecuted: number;
}

interface PlanStat {
  workOrderId:    string;
  agentName:      string;
  recommendation: string;
  warnCount:      number;
  failCount:      number;
  validationCount: number;
}

interface StoreFile {
  path:    string;
  sizeKb:  number;
  exists:  boolean;
  empty:   boolean;
}

interface ScanSnapshot {
  scannedAt:         string;
  // Work orders
  totalOrders:       number;
  agentStats:        AgentStat[];
  ordersWithoutPlan: string[];  // agentNames
  // Executions
  recentExecutions:  ExecStat[];
  failedCount:       number;
  partialCount:      number;
  // Plans
  planStats:         PlanStat[];
  blockCount:        number;
  reviseCount:       number;
  // Data stores
  dataStores:        StoreFile[];
  missingStores:     string[];
  emptyStores:       string[];
  // Source coverage
  routeFiles:        string[];
  panelFiles:        string[];
  unpanelledRoutes:  string[];
  // Tasks
  taskSummary:       string;
}

// ─── Scanner helpers ──────────────────────────────────────────────────────────

function readJsonSafe<T>(filePath: string): T | null {
  try { return JSON.parse(readFileSync(filePath, "utf-8")) as T; }
  catch { return null; }
}

function fileKb(filePath: string): number {
  try { return Math.round(statSync(filePath).size / 1024 * 10) / 10; }
  catch { return 0; }
}

function scanAgentStats(): AgentStat[] {
  const orders = loadWorkOrders();
  const byAgent = new Map<string, AgentStat>();
  for (const o of orders) {
    if (!byAgent.has(o.agentId)) {
      byAgent.set(o.agentId, {
        agentId:        o.agentId,
        agentName:      o.agentName,
        total:          0,
        completed:      0,
        pending:        0,
        blocked:        0,
        completionRate: 0,
      });
    }
    const s = byAgent.get(o.agentId)!;
    s.total++;
    if (o.status === "completed") s.completed++;
    else if (o.status === "pending") s.pending++;
    else if (o.status === "blocked") s.blocked++;
  }
  for (const s of byAgent.values()) {
    s.completionRate = s.total > 0 ? Math.round(s.completed / s.total * 100) : 0;
  }
  return Array.from(byAgent.values());
}

function scanExecutions(): { stats: ExecStat[]; failed: number; partial: number } {
  const execs = loadExecutions().slice(0, 50); // last 50
  const stats: ExecStat[] = execs.map(e => ({
    workOrderId:     e.workOrderId,
    agentName:       e.agentName,
    status:          e.status,
    errors:          e.errors.slice(0, 3),
    actionsPlanned:  e.actionsPlanned,
    actionsExecuted: e.actionsExecuted,
  }));
  return {
    stats,
    failed:  execs.filter(e => e.status === "failed").length,
    partial: execs.filter(e => e.status === "partial").length,
  };
}

function scanPlans(): { stats: PlanStat[]; blockCount: number; reviseCount: number } {
  const orders = loadWorkOrders();
  const stats: PlanStat[] = [];
  let blockCount = 0; let reviseCount = 0;
  for (const o of orders) {
    const plan = readExecutionPlan(o.id);
    if (!plan) continue;
    const warnCount = plan.safetyChecks.filter(s => s.result === "warn").length;
    const failCount = plan.safetyChecks.filter(s => s.result === "fail").length;
    stats.push({
      workOrderId:     o.id,
      agentName:       o.agentName,
      recommendation:  plan.recommendation,
      warnCount,
      failCount,
      validationCount: plan.validationPlan.length,
    });
    if (plan.recommendation === "block")  blockCount++;
    if (plan.recommendation === "revise") reviseCount++;
  }
  return { stats, blockCount, reviseCount };
}

const EXPECTED_STORES: string[] = [
  "agents/agents.json",
  "agents/work-orders.json",
  "agents/work-order-execution-plans.json",
  "agents/work-order-executions.json",
  "agents/last-collaboration.json",
  "workspace/workspace-map.json",
  "autonomy/suggestions.json",
];

function scanDataStores(): { stores: StoreFile[]; missing: string[]; empty: string[] } {
  const base    = path.join(PROJECT_ROOT, ".jarvas-data");
  const stores: StoreFile[] = EXPECTED_STORES.map(rel => {
    const full   = path.join(base, rel);
    const exists = existsSync(full);
    const sizeKb = exists ? fileKb(full) : 0;
    let empty    = !exists;
    if (exists) {
      try {
        const raw = readFileSync(full, "utf-8").trim();
        empty = raw === "" || raw === "[]" || raw === "{}";
      } catch { empty = true; }
    }
    return { path: rel, sizeKb, exists, empty };
  });
  return {
    stores,
    missing: stores.filter(s => !s.exists).map(s => s.path),
    empty:   stores.filter(s => s.exists && s.empty).map(s => s.path),
  };
}

function scanSourceCoverage(): { routeFiles: string[]; panelFiles: string[]; unpanelled: string[] } {
  const routesDir = path.join(PROJECT_ROOT, "artifacts", "api-server", "src", "routes");
  const panelsDir = path.join(PROJECT_ROOT, "artifacts", "jarvas",     "src", "components");
  let routeFiles: string[] = [];
  let panelFiles: string[] = [];
  try { routeFiles = readdirSync(routesDir).filter(f => f.endsWith(".ts") && f !== "index.ts"); } catch { /* */ }
  try { panelFiles = readdirSync(panelsDir).filter(f => f.endsWith("Panel.tsx")); }               catch { /* */ }
  const routeNames = routeFiles.map(f => f.replace(/\.ts$/, "").toLowerCase());
  const panelNames = panelFiles.map(f => f.replace(/Panel\.tsx$/, "").toLowerCase());
  const unpanelled = routeNames.filter(r =>
    !panelNames.some(p => r.includes(p) || p.includes(r))
  );
  return { routeFiles, panelFiles, unpanelled };
}

function scanTaskBacklog(): string {
  const tasksDir = path.join(PROJECT_ROOT, ".jarvas-data", "tasks");
  const base     = path.join(PROJECT_ROOT, ".jarvas-data");
  const files: string[] = [];
  try {
    if (existsSync(tasksDir)) {
      readdirSync(tasksDir).forEach(f => { if (f.endsWith(".json")) files.push(f); });
    }
    // Also check top-level task files
    readdirSync(base).forEach(f => { if (f.toLowerCase().includes("task") && f.endsWith(".json")) files.push(f); });
  } catch { /* */ }
  if (files.length === 0) return "No task backlog files found in .jarvas-data.";
  const snippets: string[] = [];
  for (const f of files.slice(0, 3)) {
    const full = path.join(existsSync(tasksDir) ? tasksDir : base, f);
    const data = readJsonSafe<unknown>(full);
    if (Array.isArray(data)) {
      snippets.push(`${f}: ${data.length} entries`);
    } else if (data && typeof data === "object") {
      snippets.push(`${f}: object with keys ${Object.keys(data as object).slice(0, 5).join(", ")}`);
    }
  }
  return snippets.join("; ") || "Task files present but empty.";
}

// ─── Claude synthesis ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an autonomous improvement analyst for Jarvis, a cyberpunk AI dev assistant.
Analyze the system scan data and generate actionable improvement suggestions.

CRITICAL JSON RULES:
- Respond ONLY with a valid JSON array — no prose outside it.
- Escape ALL newlines as \\n, all quotes as \\".
- Keep each string field under 400 characters.
- Do NOT use literal line breaks inside JSON strings.`;

type RawSuggestion = {
  category:           AnalysisCategory;
  severity:           SuggestionSeverity;
  title:              string;
  reasoning:          string;
  estimatedImpact:    string;
  recommendedAgent:   string;
  autoExecutable:     boolean;
  suggestedWorkOrder: SuggestedWorkOrder;
};

function repairJsonStrings(raw: string): string {
  let out = ""; let inStr = false; let escape = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escape)               { out += ch; escape = false; }
    else if (ch === "\\")     { out += ch; if (inStr) escape = true; }
    else if (ch === '"')      { out += ch; inStr = !inStr; }
    else if (inStr && ch === "\n") { out += "\\n"; }
    else if (inStr && ch === "\r") { out += "\\r"; }
    else if (inStr && ch === "\t") { out += "\\t"; }
    else                      { out += ch; }
  }
  return out;
}

function extractJsonArray(text: string): RawSuggestion[] {
  const trimmed = text.trim();
  let candidate: string;
  if (trimmed.startsWith("```")) {
    const m = trimmed.match(/^```(?:json)?\s*([\s\S]+?)```/);
    candidate = m ? m[1].trim() : trimmed;
  } else {
    const start = text.indexOf("[");
    if (start === -1) return [];
    let depth = 0; let inStr = false; let escape = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escape)               { escape = false; continue; }
      if (ch === "\\" && inStr) { escape = true;  continue; }
      if (ch === '"')           { inStr = !inStr; continue; }
      if (!inStr) {
        if      (ch === "[") depth++;
        else if (ch === "]") { depth--; if (depth === 0) { candidate = text.slice(start, i + 1); break; } }
      }
    }
    candidate ??= text.slice(start);
  }
  try { return JSON.parse(candidate) as RawSuggestion[]; } catch { /* */ }
  try { return JSON.parse(repairJsonStrings(candidate)) as RawSuggestion[]; } catch { /* */ }
  return [];
}

// ─── Main: runAnalysis ────────────────────────────────────────────────────────

export async function runAnalysis(): Promise<{
  suggestions: Omit<ImprovementSuggestion, "id" | "detectedAt" | "status">[];
  scanSummary: string;
}> {
  const agentStats = scanAgentStats();
  const execResult = scanExecutions();
  const planResult = scanPlans();
  const storeResult = scanDataStores();
  const coverage   = scanSourceCoverage();
  const taskBacklog = scanTaskBacklog();
  const allOrders  = loadWorkOrders();
  const agents     = loadProfiles();

  const ordersWithoutPlan = allOrders
    .filter(o => o.status !== "completed" && !readExecutionPlan(o.id))
    .map(o => o.agentName);

  const snapshot: ScanSnapshot = {
    scannedAt:         new Date().toISOString(),
    totalOrders:       allOrders.length,
    agentStats,
    ordersWithoutPlan,
    recentExecutions:  execResult.stats.slice(0, 10),
    failedCount:       execResult.failed,
    partialCount:      execResult.partial,
    planStats:         planResult.stats,
    blockCount:        planResult.blockCount,
    reviseCount:       planResult.reviseCount,
    dataStores:        storeResult.stores,
    missingStores:     storeResult.missing,
    emptyStores:       storeResult.empty,
    routeFiles:        coverage.routeFiles,
    panelFiles:        coverage.panelFiles,
    unpanelledRoutes:  coverage.unpanelled,
    taskSummary:       taskBacklog,
  };

  const agentNames = agents.map(a => `${a.emoji} ${a.name} (${a.role})`).join(", ");

  const prompt = `## System Scan Data
Scanned: ${snapshot.scannedAt}

### Work Orders
Total orders: ${snapshot.totalOrders}
Orders without execution plan: ${snapshot.ordersWithoutPlan.join(", ") || "none"}

Agent completion rates:
${snapshot.agentStats.map(s => `- ${s.agentName}: ${s.completed}/${s.total} (${s.completionRate}%)`).join("\n") || "No agents with orders"}

### Execution History (last 10)
Failed executions: ${snapshot.failedCount}
Partial executions: ${snapshot.partialCount}
${snapshot.recentExecutions.map(e =>
  `- ${e.agentName}: ${e.status} | ${e.actionsExecuted}/${e.actionsPlanned} actions${e.errors.length ? " | errors: " + e.errors[0]?.slice(0, 80) : ""}`
).join("\n") || "No executions yet"}

### Execution Plans
Block recommendations: ${snapshot.blockCount}
Revise recommendations: ${snapshot.reviseCount}
${snapshot.planStats.map(p =>
  `- ${p.agentName}: ${p.recommendation} | warn:${p.warnCount} fail:${p.failCount} | validation steps:${p.validationCount}`
).join("\n") || "No plans yet"}

### Data Store Inventory
Missing files: ${snapshot.missingStores.join(", ") || "none"}
Empty files: ${snapshot.emptyStores.join(", ") || "none"}
${snapshot.dataStores.map(s => `- ${s.path}: ${s.exists ? s.sizeKb + "KB" : "MISSING"}${s.empty ? " (EMPTY)" : ""}`).join("\n")}

### Source Coverage
Route files: ${snapshot.routeFiles.join(", ")}
Panel files: ${snapshot.panelFiles.join(", ")}
Routes potentially without UI panels: ${snapshot.unpanelledRoutes.join(", ") || "none detected"}

### Task Backlog
${snapshot.taskSummary}

### Available Agents
${agentNames}

---

## Instructions

Generate 4–8 improvement suggestions based on the real issues found above.
Focus on:
1. Any failed or partial executions (specific errors)
2. Agents with 0% completion rate
3. Work orders missing execution plans
4. Missing or empty data stores
5. Routes or panels lacking coverage
6. Safety/validation gaps in execution plans

Allowed categories: task_backlog, failed_execution, repeated_warnings, low_completion_agent, missing_validation, empty_data_store, route_without_panel, panel_without_actions

For autoExecutable: only mark true when the work is pure analysis, documentation, or report generation (no code changes, no schema changes, no deployments).

Allowed agents for recommendedAgent: ${agents.map(a => a.name).join(", ")}

Respond with a JSON array of 4–8 objects, each:
{
  "category": "<one of the allowed categories>",
  "severity": "critical" | "high" | "medium" | "low",
  "title": "<short action-oriented title>",
  "reasoning": "<1-2 sentences: what signal triggered this and why it matters>",
  "estimatedImpact": "<1 sentence: what improves if this is done>",
  "recommendedAgent": "<agent name from the list above>",
  "autoExecutable": true | false,
  "suggestedWorkOrder": {
    "title": "<work order title>",
    "objective": "<specific objective>",
    "inputs": ["<input 1>", "<input 2>"],
    "expectedOutput": "<deliverable>",
    "riskLevel": "high" | "medium" | "low"
  }
}`;

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

  const raw = extractJsonArray(rawText);

  const suggestions: Omit<ImprovementSuggestion, "id" | "detectedAt" | "status">[] = raw.map(r => ({
    category:           r.category          ?? "task_backlog",
    severity:           r.severity          ?? "medium",
    title:              r.title             ?? "Untitled suggestion",
    reasoning:          r.reasoning         ?? "",
    estimatedImpact:    r.estimatedImpact   ?? "",
    recommendedAgent:   r.recommendedAgent  ?? "Architect Agent",
    autoExecutable:     r.autoExecutable    ?? false,
    suggestedWorkOrder: r.suggestedWorkOrder ?? {
      title:          r.title ?? "Untitled",
      objective:      r.reasoning ?? "",
      inputs:         [],
      expectedOutput: r.estimatedImpact ?? "",
      riskLevel:      "low",
    },
  }));

  const scanSummary =
    `${snapshot.totalOrders} orders · ` +
    `${snapshot.failedCount + snapshot.partialCount} failed execs · ` +
    `${snapshot.missingStores.length} missing stores · ` +
    `${snapshot.ordersWithoutPlan.length} unplanned orders`;

  return { suggestions, scanSummary };
}
