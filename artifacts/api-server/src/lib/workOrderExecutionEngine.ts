/**
 * lib/workOrderExecutionEngine.ts — Work Order Execution Engine v1
 *
 * Executes an approved work order by generating sandboxed file outputs via Claude.
 *
 * PRE-EXECUTION GATES (all must pass):
 *   1. Work order status === "ready"
 *   2. Execution plan exists for this order
 *   3. Plan recommendation === "proceed"
 *
 * ALLOWED OPERATIONS (Claude-generated, strictly enforced):
 *   - create_file       → write a new text/markdown/JSON/YAML/CSV file
 *   - append_log        → append to a log file
 *   - generate_report   → write a report file
 *   - update_status     → mark work order "completed" (auto-applied post-execution)
 *
 * FORBIDDEN (rejected by path/content sanitizer regardless of Claude output):
 *   - file deletion, shell commands, package installs, deployment changes
 *   - git reset, modifying package.json / tsconfig.json / *.sh / *.js / *.ts
 *
 * All files are sandboxed to:
 *   .jarvas-data/agents/outputs/{workOrderId}/
 *
 * Results saved to:
 *   .jarvas-data/agents/work-order-executions.json
 */

import {
  existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync,
} from "fs";
import { randomUUID }                       from "crypto";
import path                                 from "path";
import { anthropic }                        from "@workspace/integrations-anthropic-ai";
import { loadWorkOrders, updateWorkOrderStatus, type WorkOrder } from "./workOrders";
import { readExecutionPlan, type ExecutionPlan }                  from "./workOrderExecutionPlanner";
import { PROJECT_ROOT }                     from "./dev/tools";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActionType    = "create_file" | "append_log" | "generate_report" | "update_status";
export type ActionStatus  = "completed" | "skipped" | "failed";
export type ExecStatus    = "success" | "partial" | "failed";

export interface ExecutionAction {
  type:     ActionType;
  path?:    string;
  content?: string;
  status:   ActionStatus;
  error?:   string;
}

export interface ExecutionResult {
  id:                     string;
  workOrderId:            string;
  agentId:                string;
  agentName:              string;
  agentEmoji:             string;
  agentColor:             string;
  executedAt:             string;
  checkpointId:           string;
  status:                 ExecStatus;
  actionsPlanned:         number;
  actionsExecuted:        number;
  actions:                ExecutionAction[];
  logs:                   string[];
  errors:                 string[];
  workOrderStatusUpdated: boolean;
  outputDir:              string;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const STORE_DIR  = path.join(PROJECT_ROOT, ".jarvas-data", "agents");
const EXECS_FILE = path.join(STORE_DIR, "work-order-executions.json");

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function loadExecutions(): ExecutionResult[] {
  try { return JSON.parse(readFileSync(EXECS_FILE, "utf-8")) as ExecutionResult[]; }
  catch { return []; }
}

function saveExecution(result: ExecutionResult): void {
  ensureDir(STORE_DIR);
  const all = loadExecutions();
  // Most-recent first; cap at 200 entries
  const updated = [result, ...all].slice(0, 200);
  writeFileSync(EXECS_FILE, JSON.stringify(updated, null, 2) + "\n", "utf-8");
}

// ─── Path sanitizer ───────────────────────────────────────────────────────────

const ALLOWED_EXTS   = new Set([".txt", ".md", ".json", ".log", ".yaml", ".yml", ".csv"]);
const FORBIDDEN_NAMES = /^(package\.json|package-lock\.json|yarn\.lock|tsconfig.*|\.env.*|Makefile|Dockerfile.*|docker-compose.*)/i;
const SAFE_CHARS     = /^[a-zA-Z0-9_\-./]+$/;

function sanitizePath(rawPath: string, workOrderId: string): string | null {
  if (!rawPath || typeof rawPath !== "string") return null;

  // Normalize slashes, strip leading slash
  let p = rawPath.replace(/\\/g, "/").replace(/^\/+/, "");

  // Reject path traversal
  if (p.includes("..")) return null;

  // Only safe characters
  if (!SAFE_CHARS.test(p)) return null;

  // Check extension
  const ext = path.extname(p).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) return null;

  // Check forbidden names
  const basename = path.basename(p);
  if (FORBIDDEN_NAMES.test(basename)) return null;

  // Sandbox under outputs/{workOrderId}/
  const sandboxed = path.join(
    PROJECT_ROOT,
    ".jarvas-data", "agents", "outputs",
    workOrderId,
    p,
  );

  // Final check: must still be within the sandbox
  const sandbox = path.join(PROJECT_ROOT, ".jarvas-data", "agents", "outputs", workOrderId);
  if (!sandboxed.startsWith(sandbox)) return null;

  return sandboxed;
}

// ─── Claude prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an AI agent executing your assigned work order within a sandboxed environment.
You MUST produce real, detailed, high-quality content — not placeholders or stubs.
Your output will be saved as actual deliverable files.

CRITICAL JSON RULES — failure to follow these will cause a parse error:
- Respond with ONLY a valid JSON array — no prose, no explanation outside the array.
- All "content" field values MUST be a single JSON string on one conceptual line.
- Escape ALL newlines inside content strings as \\n (the two characters backslash-n).
- Escape ALL double-quotes inside content strings as \\".
- Do NOT use literal line breaks inside any JSON string value.
- Keep each content value under 2000 characters to avoid truncation.`;

function buildExecutionPrompt(order: WorkOrder, plan: ExecutionPlan): string {
  const steps = plan.proposedSteps
    .map(s => `  ${s.stepNumber}. ${s.action}: ${s.detail}`)
    .join("\n");

  const files = plan.filesLikelyAffected
    .filter(f => ["create", "modify"].includes(f.change))
    .map(f => `  ${f.path} (${f.change}) — ${f.reason}`)
    .join("\n");

  return `## Your Assignment

You are ${order.agentEmoji} ${order.agentName}.

**Objective:** ${order.objective}

**Inputs available to you:**
${order.inputs.map(i => `  - ${i}`).join("\n")}

**Expected deliverable:** ${order.expectedOutput}

## Execution Plan (follow these steps)

${steps}

## Planned deliverable files

${files || "  (Use your best judgment based on your objective)"}

---

## Instructions

Produce 2–5 actions that fulfil this work order. All paths are relative to your sandbox.
Allowed action types:
- "create_file"     → write a new deliverable file
- "append_log"      → append an entry to a log file
- "generate_report" → write a final summary/report file

File path rules:
- Relative paths only, no leading slash, no ".."
- Only these extensions: .txt .md .json .log .yaml .yml .csv
- DO NOT use: .js .ts .tsx .sh .py or any executable extension
- DO NOT name files: package.json, tsconfig.json, .env, Makefile

Produce REAL content — actual architecture docs, actual data models, actual test plans,
actual type definitions described in markdown, actual reports with real content.
The content should reflect the work you, ${order.agentName}, would actually produce.

Respond with a JSON array:
[
  {
    "type": "create_file",
    "path": "architecture/notification-data-model.md",
    "content": "# Notification Data Model\\n\\n..."
  },
  {
    "type": "generate_report",
    "path": "execution-report.md",
    "content": "# Execution Report\\n\\n..."
  },
  {
    "type": "append_log",
    "path": "execution.log",
    "content": "[${new Date().toISOString()}] Execution completed by ${order.agentName}\\n"
  }
]`;
}

// ─── JSON extractor + repair ──────────────────────────────────────────────────

/**
 * Repair common Claude JSON formatting issues:
 * - Raw literal newlines inside string values → \n
 * - Raw literal tabs inside string values → \t
 * Operates character-by-character so it only fixes chars inside strings.
 */
function repairJsonStrings(raw: string): string {
  let out = "";
  let inStr = false;
  let escape = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) {
      out += ch;
      escape = false;
    } else if (ch === "\\") {
      out += ch;
      if (inStr) escape = true;
    } else if (ch === '"') {
      out += ch;
      inStr = !inStr;
    } else if (inStr && ch === "\n") {
      out += "\\n";
    } else if (inStr && ch === "\r") {
      out += "\\r";
    } else if (inStr && ch === "\t") {
      out += "\\t";
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Extract a JSON array from Claude's raw response text.
 *
 * BUG HISTORY:
 * - Bracket counting must skip characters inside JSON string values,
 *   otherwise brackets inside content (e.g. TypeScript code, markdown links)
 *   throw off the depth counter.
 * - Fenced-block extraction must ONLY trigger when the response actually STARTS
 *   with ```, not just contains them (content strings often include markdown
 *   code fences that confuse the regex).
 */
function extractJsonArray(text: string): string {
  const trimmed = text.trim();

  // Only extract a fenced code block when the response STARTS with ``` —
  // never match backticks embedded inside JSON string values.
  if (trimmed.startsWith("```")) {
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]+?)```/);
    if (fenced) return fenced[1].trim();
  }

  // Find the opening bracket
  const start = text.indexOf("[");
  if (start === -1) throw new Error("No JSON array found in Claude response");

  // Bracket-count while properly tracking string state.
  // Without this, brackets inside content strings (e.g. @Index(['col'])) skew depth.
  let depth  = 0;
  let inStr  = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape)              { escape = false; continue; }
    if (ch === "\\" && inStr){ escape = true;  continue; }
    if (ch === '"')          { inStr = !inStr; continue; }
    if (!inStr) {
      if      (ch === "[") { depth++; }
      else if (ch === "]") { depth--; if (depth === 0) return text.slice(start, i + 1); }
    }
  }
  return text.slice(start);
}

// ─── Gate check ───────────────────────────────────────────────────────────────

export interface GateCheckResult {
  ok:     boolean;
  errors: string[];
}

export function checkExecutionGates(workOrderId: string): GateCheckResult {
  const errors: string[] = [];

  const orders = loadWorkOrders();
  const order  = orders.find(o => o.id === workOrderId);
  if (!order) {
    return { ok: false, errors: [`Work order '${workOrderId}' not found.`] };
  }

  if (order.status !== "ready") {
    errors.push(`Work order status is '${order.status}' — must be 'ready' to execute.`);
  }

  const plan = readExecutionPlan(workOrderId);
  if (!plan) {
    errors.push("No execution plan found for this work order. Run PLAN EXECUTION first.");
  } else if (plan.recommendation !== "proceed") {
    errors.push(`Execution plan recommends '${plan.recommendation}' — only 'proceed' allows execution.`);
  }

  return { ok: errors.length === 0, errors };
}

// ─── Main: execute ────────────────────────────────────────────────────────────

export async function executeWorkOrder(
  workOrderId: string,
  checkpointId: string,
): Promise<ExecutionResult> {
  const orders = loadWorkOrders();
  const order  = orders.find(o => o.id === workOrderId);
  if (!order) throw new Error(`Work order '${workOrderId}' not found.`);

  const plan = readExecutionPlan(workOrderId)!;
  const logs: string[] = [];
  const errors: string[] = [];

  logs.push(`[${new Date().toISOString()}] Execution started — ${order.agentName}`);
  logs.push(`[${new Date().toISOString()}] Checkpoint: ${checkpointId}`);

  // Call Claude
  const prompt = buildExecutionPrompt(order, plan);
  const response = await anthropic.messages.create({
    model:      "claude-sonnet-4-6",
    max_tokens: 8192,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: "user", content: prompt }],
  });

  const rawText = response.content
    .filter(b => b.type === "text")
    .map(b => (b as { type: "text"; text: string }).text)
    .join("");

  type RawAction = { type: string; path?: string; content?: string };
  let rawActions: RawAction[] = [];
  try {
    rawActions = JSON.parse(extractJsonArray(rawText)) as RawAction[];
  } catch (e) {
    errors.push(`Failed to parse Claude action list: ${e instanceof Error ? e.message : String(e)}`);
  }

  const ALLOWED_TYPES = new Set<string>(["create_file", "append_log", "generate_report"]);
  const executedActions: ExecutionAction[] = [];
  let actionsExecuted = 0;

  for (const raw of rawActions) {
    const actionType = raw.type as ActionType;

    // Reject forbidden action types
    if (!ALLOWED_TYPES.has(raw.type)) {
      executedActions.push({
        type:   actionType,
        path:   raw.path,
        status: "skipped",
        error:  `Action type '${raw.type}' is not permitted.`,
      });
      logs.push(`[SKIP] ${raw.type} — forbidden action type`);
      continue;
    }

    // Sanitize path
    const absPath = sanitizePath(raw.path ?? "", workOrderId);
    if (!absPath) {
      executedActions.push({
        type:   actionType,
        path:   raw.path,
        status: "skipped",
        error:  `Path '${raw.path ?? "(empty)"}' rejected by safety sanitizer.`,
      });
      logs.push(`[SKIP] ${raw.type} ${raw.path} — path rejected`);
      continue;
    }

    const content = raw.content ?? "";

    try {
      ensureDir(path.dirname(absPath));

      if (actionType === "create_file" || actionType === "generate_report") {
        writeFileSync(absPath, content, "utf-8");
      } else if (actionType === "append_log") {
        appendFileSync(absPath, content, "utf-8");
      }

      executedActions.push({ type: actionType, path: absPath, content, status: "completed" });
      logs.push(`[OK] ${actionType} → ${path.relative(PROJECT_ROOT, absPath)}`);
      actionsExecuted++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      executedActions.push({ type: actionType, path: absPath, status: "failed", error: msg });
      errors.push(`${actionType} ${absPath}: ${msg}`);
      logs.push(`[ERR] ${actionType} ${absPath}: ${msg}`);
    }
  }

  // Always add the update_status action
  let workOrderStatusUpdated = false;
  try {
    updateWorkOrderStatus(workOrderId, "completed");
    workOrderStatusUpdated = true;
    executedActions.push({ type: "update_status", status: "completed" });
    logs.push(`[OK] update_status → completed (cascade triggered)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`update_status: ${msg}`);
    executedActions.push({ type: "update_status", status: "failed", error: msg });
  }

  const status: ExecStatus =
    errors.length === 0             ? "success" :
    actionsExecuted > 0             ? "partial"  :
    "failed";

  logs.push(`[${new Date().toISOString()}] Execution ${status} — ${actionsExecuted}/${rawActions.length} actions executed`);

  const outputDir = path.join(
    PROJECT_ROOT, ".jarvas-data", "agents", "outputs", workOrderId,
  );

  const result: ExecutionResult = {
    id:                     randomUUID(),
    workOrderId,
    agentId:                order.agentId,
    agentName:              order.agentName,
    agentEmoji:             order.agentEmoji,
    agentColor:             order.agentColor,
    executedAt:             new Date().toISOString(),
    checkpointId,
    status,
    actionsPlanned:         rawActions.length,
    actionsExecuted,
    actions:                executedActions,
    logs,
    errors,
    workOrderStatusUpdated,
    outputDir:              path.relative(PROJECT_ROOT, outputDir),
  };

  saveExecution(result);
  return result;
}
