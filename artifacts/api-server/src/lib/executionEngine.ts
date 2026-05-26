/**
 * lib/executionEngine.ts — Safe Execution Engine
 *
 * Executes ONLY the following operations, using ONLY the Node.js `fs` module:
 *   create_directory    mkdirSync under .jarvas-data/
 *   create_file         writeFileSync under .jarvas-data/files/   (new files only)
 *   append_log          appendFileSync to .jarvas-data/logs/
 *   update_task_status  calls listTasks / updateTaskStatus from lib/masterTasks
 *   generate_report     writeFileSync under .jarvas-data/reports/
 *
 * ABSOLUTELY FORBIDDEN (throws ExecutionBlockedError if detected):
 *   - Deleting / removing files
 *   - Modifying package.json
 *   - Installing dependencies (npm / pnpm / yarn)
 *   - Git danger commands (reset / rebase / push / checkout)
 *   - Deployment commands
 *   - Shell execution (exec / spawn / eval)
 *
 * SAFETY CONTRACT:
 *   - No execSync, exec, spawn, or eval anywhere in this file.
 *   - All output paths are resolved relative to .jarvas-data/ and asserted safe.
 *   - Only LOW-risk APPROVED actions may be executed.
 *   - Every real execution (non-dry-run) auto-creates a checkpoint first.
 *   - Dry-runs analyse and return a plan without writing anything.
 */

import {
  mkdirSync, writeFileSync, appendFileSync, existsSync, statSync,
} from "fs";
import path from "path";
import { PROJECT_ROOT } from "./dev/tools";
import { createCheckpoint } from "./checkpoints";
import { listTasks, updateTaskStatus, type MasterTask } from "./masterTasks";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExecutionOpType =
  | "create_directory"
  | "create_file"
  | "append_log"
  | "update_task_status"
  | "generate_report"
  | "unsupported";

export interface EngineInput {
  id:          string;
  title:       string;
  description: string;
  riskLevel:   string;
  status:      string;
}

export interface ExecutionPlan {
  operationType: ExecutionOpType;
  targetPath:    string;
  description:   string;
}

export interface ExecutionResult {
  operationType:  ExecutionOpType;
  affectedFiles:  string[];
  checkpointId?:  string;
  report:         string;
  dryRun:         boolean;
}

// ─── Safety: blocked patterns ─────────────────────────────────────────────────

const BLOCKED: { pattern: RegExp; reason: string }[] = [
  { pattern: /\b(delete|remove|unlink|rmdir|rm\s)\b/i,           reason: "File deletion is not permitted." },
  { pattern: /package\.json/i,                                    reason: "Modifying package.json is not permitted." },
  { pattern: /\b(npm|pnpm|yarn)\s+(install|add|remove|update)\b/i, reason: "Dependency installs are not permitted." },
  { pattern: /git\s+(reset|rebase|push|checkout|restore|clean)\b/i, reason: "Destructive git commands are not permitted." },
  { pattern: /\b(deploy|heroku|vercel|fly|netlify|render)\b/i,    reason: "Deployment commands are not permitted." },
  { pattern: /\b(execSync|exec|spawn|eval|shell)\b/i,             reason: "Shell execution is not permitted." },
  { pattern: /process\.(exit|kill|env\.SECRET|env\.KEY)/i,        reason: "Process manipulation is not permitted." },
];

export class ExecutionBlockedError extends Error {
  constructor(reason: string) {
    super(`Execution blocked: ${reason}`);
    this.name = "ExecutionBlockedError";
  }
}

export class ExecutionGateError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ExecutionGateError";
  }
}

// ─── Safety helpers ────────────────────────────────────────────────────────────

const SAFE_ROOT = path.join(PROJECT_ROOT, ".jarvas-data");

function assertSafePath(p: string): string {
  const abs = path.resolve(SAFE_ROOT, p);
  if (!abs.startsWith(SAFE_ROOT + path.sep) && abs !== SAFE_ROOT) {
    throw new ExecutionBlockedError(`Path "${p}" is outside the allowed output directory (.jarvas-data/).`);
  }
  return abs;
}

function assertActionSafe(action: EngineInput, text: string): void {
  for (const { pattern, reason } of BLOCKED) {
    if (pattern.test(text)) throw new ExecutionBlockedError(reason);
  }
}

function assertGates(action: EngineInput): void {
  if (action.status !== "approved") {
    throw new ExecutionGateError(`Only approved actions may be executed (current status: "${action.status}").`);
  }
  if (action.riskLevel !== "low") {
    throw new ExecutionGateError(`Only LOW-risk actions may be executed (current risk: "${action.riskLevel}").`);
  }
}

// ─── Operation detection ──────────────────────────────────────────────────────

const OP_PATTERNS: { type: ExecutionOpType; pattern: RegExp }[] = [
  { type: "create_directory",   pattern: /creat.*(dir|folder|path)|mkdir/i },
  { type: "create_file",        pattern: /creat.*(file|document|json|txt|text|config)|write.*file|new.*file|generat.*(file|json)/i },
  { type: "append_log",         pattern: /(append|add|write).*(log|entry|record)|log.*entr/i },
  { type: "update_task_status", pattern: /(update|set|change|mark).*(task|status)|task.*(complet|done|finish|close)/i },
  { type: "generate_report",    pattern: /(generate|creat|write|produc).*(report|summary|digest)|report.*generat/i },
];

function detectOperation(action: EngineInput): ExecutionOpType {
  const text = `${action.title} ${action.description}`;
  for (const { type, pattern } of OP_PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return "unsupported";
}

// ─── Path / slug helpers ──────────────────────────────────────────────────────

function toSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

function tsPrefix(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

// ─── Plan builder ─────────────────────────────────────────────────────────────

export function buildPlan(action: EngineInput): ExecutionPlan {
  const op   = detectOperation(action);
  const slug = toSlug(action.title);
  const ts   = tsPrefix();

  const targetPath: Record<ExecutionOpType, string> = {
    create_directory:   `.jarvas-data/${slug}/`,
    create_file:        `.jarvas-data/files/${ts}-${slug}.json`,
    append_log:         `.jarvas-data/logs/agent-execution.log`,
    update_task_status: `.jarvas-data/tasks/master-tasks.json`,
    generate_report:    `.jarvas-data/reports/${ts}-${slug}.md`,
    unsupported:        "(none)",
  };

  const desc: Record<ExecutionOpType, string> = {
    create_directory:   `Create directory .jarvas-data/${slug}/`,
    create_file:        `Create file .jarvas-data/files/${ts}-${slug}.json`,
    append_log:         `Append log entry to .jarvas-data/logs/agent-execution.log`,
    update_task_status: `Update matching task status to 'done' in master-tasks.json`,
    generate_report:    `Write report .jarvas-data/reports/${ts}-${slug}.md`,
    unsupported:        "Operation type could not be determined from action metadata.",
  };

  return { operationType: op, targetPath: targetPath[op], description: desc[op] };
}

// ─── Executor ─────────────────────────────────────────────────────────────────

function execCreateDirectory(plan: ExecutionPlan): string[] {
  const abs = assertSafePath(plan.targetPath.replace(/^\.jarvas-data\//, ""));
  mkdirSync(abs, { recursive: true });
  return [plan.targetPath];
}

function execCreateFile(plan: ExecutionPlan, action: EngineInput): string[] {
  const rel = plan.targetPath.replace(/^\.jarvas-data\/files\//, "files/");
  const abs = assertSafePath(rel);
  mkdirSync(path.dirname(abs), { recursive: true });

  if (existsSync(abs)) {
    throw new ExecutionBlockedError(`File already exists at "${plan.targetPath}". Will not overwrite.`);
  }

  const content = JSON.stringify({
    createdAt:   new Date().toISOString(),
    title:       action.title,
    description: action.description,
    data:        {},
  }, null, 2) + "\n";

  writeFileSync(abs, content, "utf-8");
  return [plan.targetPath];
}

function execAppendLog(plan: ExecutionPlan, action: EngineInput): string[] {
  const abs = assertSafePath("logs/agent-execution.log");
  mkdirSync(path.dirname(abs), { recursive: true });

  const entry = `[${new Date().toISOString()}] [EXECUTE] action="${action.title}" — ${action.description}\n`;
  appendFileSync(abs, entry, "utf-8");
  return [plan.targetPath];
}

function execUpdateTaskStatus(plan: ExecutionPlan, action: EngineInput): string[] {
  const keywords = `${action.title} ${action.description}`.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  const tasks    = listTasks();

  const match: MasterTask | undefined = tasks.find(t =>
    t.status !== "done" &&
    keywords.some(kw => t.title.toLowerCase().includes(kw)),
  );

  if (match) {
    updateTaskStatus(match.id, "done");
    return [plan.targetPath, `task:${match.id}`];
  }

  // Still succeed — just note no task was found
  return [];
}

function execGenerateReport(plan: ExecutionPlan, action: EngineInput): string[] {
  const rel = plan.targetPath.replace(/^\.jarvas-data\/reports\//, "reports/");
  const abs = assertSafePath(rel);
  mkdirSync(path.dirname(abs), { recursive: true });

  const lines = [
    `# Execution Report`,
    ``,
    `**Action:** ${action.title}`,
    `**Generated:** ${new Date().toISOString()}`,
    `**Risk level:** ${action.riskLevel}`,
    ``,
    `## Description`,
    ``,
    action.description,
    ``,
    `## Status`,
    ``,
    `Report generated successfully by the Jarvis Safe Execution Engine.`,
    ``,
  ];

  writeFileSync(abs, lines.join("\n"), "utf-8");
  return [plan.targetPath];
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runExecution(
  action: EngineInput,
  dryRun: boolean,
): Promise<ExecutionResult> {
  // 1. Gate checks
  assertGates(action);
  assertActionSafe(action, `${action.title} ${action.description}`);

  // 2. Build plan
  const plan = buildPlan(action);

  if (plan.operationType === "unsupported") {
    throw new ExecutionGateError(
      `Cannot determine a safe operation type from this action's title and description. ` +
      `Supported types: create directory, create file, append log, update task status, generate report.`,
    );
  }

  // 3. Dry-run: return plan without writing anything
  if (dryRun) {
    const report = [
      `**DRY RUN — no files were written.**`,
      ``,
      `Operation: ${plan.operationType.replace(/_/g, " ").toUpperCase()}`,
      `Target: ${plan.targetPath}`,
      `Description: ${plan.description}`,
      ``,
      `This action would ${plan.description.toLowerCase()}.`,
    ].join("\n");

    return {
      operationType: plan.operationType,
      affectedFiles: [plan.targetPath],
      report,
      dryRun: true,
    };
  }

  // 4. Auto-checkpoint before writing anything
  const checkpoint = createCheckpoint({
    description: `Auto-checkpoint before executing: ${action.title}`,
  });

  // 5. Execute the safe operation
  let affectedFiles: string[] = [];
  let taskNote = "";

  switch (plan.operationType) {
    case "create_directory":
      affectedFiles = execCreateDirectory(plan);
      break;
    case "create_file":
      affectedFiles = execCreateFile(plan, action);
      break;
    case "append_log":
      affectedFiles = execAppendLog(plan, action);
      break;
    case "update_task_status":
      affectedFiles = execUpdateTaskStatus(plan, action);
      taskNote = affectedFiles.some(f => f.startsWith("task:"))
        ? `\nMatched and updated task: ${affectedFiles.find(f => f.startsWith("task:"))?.replace("task:", "")}`
        : "\nNo matching pending task found — no task status was changed.";
      break;
    case "generate_report":
      affectedFiles = execGenerateReport(plan, action);
      break;
  }

  // 6. Build report
  const report = [
    `**Execution completed successfully.**`,
    ``,
    `Operation: ${plan.operationType.replace(/_/g, " ").toUpperCase()}`,
    `Target: ${plan.targetPath}`,
    affectedFiles.length > 0 ? `Files affected: ${affectedFiles.filter(f => !f.startsWith("task:")).join(", ")}` : "No files affected.",
    taskNote,
    ``,
    `Auto-checkpoint created: ${checkpoint.id.slice(0, 8)} (${checkpoint.commitHash?.slice(0, 7) ?? "no git"})`,
    `Executed at: ${new Date().toISOString()}`,
  ].filter(l => l !== undefined).join("\n");

  return {
    operationType: plan.operationType,
    affectedFiles: affectedFiles.filter(f => !f.startsWith("task:")),
    checkpointId:  checkpoint.id,
    report,
    dryRun:        false,
  };
}
