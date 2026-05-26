/**
 * lib/prioritizer.ts — Jarvis Task Prioritizer v1
 *
 * Scores every active task across 6 weighted factors:
 *   urgency (25%) · dependencies (15%) · riskLevel (10%)
 *   impact (25%)  · difficulty (10%)   · blocked (15%)
 *
 * Scores are stored persistently in .jarvas-data/tasks/priority-scores.json
 * and are recalculated automatically after task updates, plan conversions,
 * and execution completions.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path                           from "path";
import { PROJECT_ROOT }               from "./dev/tools";
import { listTasks, type MasterTask } from "./masterTasks";
import { listPlans }                  from "./plans";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScoreFactors {
  urgency:      number; // 0-100
  dependencies: number; // 0-100
  riskLevel:    number; // 0-100
  impact:       number; // 0-100
  difficulty:   number; // 0-100
  blocked:      number; // 0-100
}

export interface PriorityScore {
  taskId:       string;
  total:        number; // 0-100 weighted result
  factors:      ScoreFactors;
  reasoning:    string;
  calculatedAt: string;
}

export interface PlanTaskInfo {
  planId:     string;
  planTitle:  string;
  phaseId:    string;
  phaseTitle: string;
  phaseOrder: number;
  effort:     "small" | "medium" | "large";
}

export interface TaskRecommendation {
  rank:               number;
  task:               MasterTask;
  score:              PriorityScore;
  planInfo?:          PlanTaskInfo;
  estimatedExecOrder: number;
}

export interface RecommendationsResult {
  recommendations: TaskRecommendation[];
  totalPending:    number;
  totalScored:     number;
  lastCalculated:  string | null;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const SCORES_DIR  = path.join(PROJECT_ROOT, ".jarvas-data", "tasks");
const SCORES_FILE = path.join(SCORES_DIR, "priority-scores.json");

function ensureDir(): void {
  if (!existsSync(SCORES_DIR)) mkdirSync(SCORES_DIR, { recursive: true });
}

type ScoreMap = Record<string, PriorityScore>;

function readScores(): ScoreMap {
  ensureDir();
  if (!existsSync(SCORES_FILE)) return {};
  try { return JSON.parse(readFileSync(SCORES_FILE, "utf-8")) as ScoreMap; }
  catch { return {}; }
}

function writeScores(scores: ScoreMap): void {
  ensureDir();
  writeFileSync(SCORES_FILE, JSON.stringify(scores, null, 2) + "\n", "utf-8");
}

// ─── Public reads ─────────────────────────────────────────────────────────────

export function getScore(taskId: string): PriorityScore | undefined {
  return readScores()[taskId];
}

export function getAllScores(): PriorityScore[] {
  return Object.values(readScores());
}

// ─── Keyword tables ───────────────────────────────────────────────────────────

const HIGH_IMPACT_WORDS = [
  "core", "foundation", "setup", "init", "infrastructure", "api", "auth",
  "database", "schema", "model", "deploy", "launch", "release", "architecture",
  "critical", "main", "primary", "security", "gateway", "routing",
];
const LOW_IMPACT_WORDS = [
  "cleanup", "refactor", "comment", "readme", "format", "lint", "typo",
  "minor", "style", "cosmetic", "rename", "reorganize",
];

const HIGH_RISK_WORDS = [
  "delete", "remove", "drop", "migrate", "reset", "clear", "wipe",
  "destroy", "override", "replace", "truncate", "purge",
];
const LOW_RISK_WORDS = [
  "add", "create", "generate", "report", "document", "test", "review",
  "analyze", "read", "fetch", "log", "monitor", "check",
];

// ─── Plan task map (join tasks → plan metadata) ────────────────────────────────

function buildPlanTaskMap(): Map<string, PlanTaskInfo> {
  const map: Map<string, PlanTaskInfo> = new Map();
  for (const plan of listPlans()) {
    for (const phase of plan.phases) {
      for (const task of phase.tasks) {
        map.set(task.id, {
          planId:    plan.id,
          planTitle: plan.title,
          phaseId:   phase.id,
          phaseTitle: phase.title,
          phaseOrder: phase.order,
          effort:    task.estimatedEffort,
        });
      }
    }
  }
  return map;
}

// ─── Single task scorer ───────────────────────────────────────────────────────

function scoreTask(
  task:           MasterTask,
  planInfo:       PlanTaskInfo | undefined,
  allTasks:       MasterTask[],
  planTaskMap:    Map<string, PlanTaskInfo>,
): PriorityScore {
  const lower = task.title.toLowerCase();

  // Factor 1: Urgency — from task.priority field
  const urgency =
    task.priority === "high"   ? 90 :
    task.priority === "medium" ? 55 : 20;

  // Factor 2: Dependencies — proxy via plan phase order
  // Earlier-phase tasks block more downstream work → higher score
  const dependencies = planInfo
    ? Math.max(10, Math.min(90, 90 - (planInfo.phaseOrder - 1) * 14))
    : 45;

  // Factor 3: Risk level — from title keywords (high risk → lower score)
  const riskLevel =
    HIGH_RISK_WORDS.some(w => lower.includes(w)) ? 25 :
    LOW_RISK_WORDS.some(w =>  lower.includes(w)) ? 80 : 55;

  // Factor 4: Estimated impact — from title keywords + phase boost
  let impact =
    HIGH_IMPACT_WORDS.some(w => lower.includes(w)) ? 80 :
    LOW_IMPACT_WORDS.some(w =>  lower.includes(w)) ? 25 : 55;
  if (planInfo?.phaseOrder === 1) impact = Math.min(100, impact + 10); // phase-1 foundation boost

  // Factor 5: Execution difficulty — inverted effort (easy → higher score)
  const difficulty = !planInfo ? 55 :
    planInfo.effort === "small"  ? 80 :
    planInfo.effort === "medium" ? 55 : 28;

  // Factor 6: Blocked status — are earlier-phase tasks still pending?
  let blocked = 75; // default: not blocked
  if (planInfo && planInfo.phaseOrder > 1) {
    const pendingEarlier = allTasks.filter(t => {
      if (t.status !== "pending") return false;
      const info = planTaskMap.get(t.id);
      return info &&
             info.planId    === planInfo.planId &&
             info.phaseOrder < planInfo.phaseOrder;
    }).length;
    blocked = pendingEarlier === 0 ? 92 :
              pendingEarlier <= 2  ? 48 : 12;
  }

  // Weighted total (weights sum to 1.0)
  const total = Math.round(
    urgency      * 0.25 +
    dependencies * 0.15 +
    riskLevel    * 0.10 +
    impact       * 0.25 +
    difficulty   * 0.10 +
    blocked      * 0.15,
  );

  // Human-readable reasoning
  const parts: string[] = [];
  if (urgency >= 80)      parts.push("high urgency");
  else if (urgency <= 25) parts.push("low urgency");
  if (blocked <= 20)      parts.push("blocked by earlier tasks");
  else if (blocked >= 85) parts.push("clear to execute");
  if (impact >= 78)       parts.push("high impact");
  if (difficulty >= 75)   parts.push("quick win");
  else if (difficulty <= 35) parts.push("complex task");
  if (dependencies >= 75) parts.push("unblocks downstream work");
  if (riskLevel <= 30)    parts.push("high risk — review carefully");
  if (planInfo)           parts.push(`${planInfo.phaseTitle} · ${planInfo.effort} effort`);

  return {
    taskId:       task.id,
    total:        Math.min(100, Math.max(0, total)),
    factors:      { urgency, dependencies, riskLevel, impact, difficulty, blocked },
    reasoning:    parts.length ? parts.join(" · ") : "Standard priority task",
    calculatedAt: new Date().toISOString(),
  };
}

// ─── Public: recalculate all priorities ──────────────────────────────────────

export function recalculateAllPriorities(): PriorityScore[] {
  const allTasks   = listTasks();
  const planTaskMap = buildPlanTaskMap();
  const scores: ScoreMap = {};

  for (const task of allTasks) {
    if (task.status === "done" || task.status === "cancelled") continue;
    const planInfo = planTaskMap.get(task.id);
    scores[task.id] = scoreTask(task, planInfo, allTasks, planTaskMap);
  }

  writeScores(scores);
  return Object.values(scores);
}

// ─── Public: get recommendations ─────────────────────────────────────────────

export function getRecommendations(): RecommendationsResult {
  const allTasks    = listTasks();
  const planTaskMap = buildPlanTaskMap();
  const scores      = readScores();

  const pending = allTasks.filter(t => t.status === "pending");
  const scored  = Object.keys(scores).length;

  // Sort pending tasks by score descending
  const ranked = pending
    .map(task => ({
      task,
      score:    scores[task.id],
      planInfo: planTaskMap.get(task.id),
    }))
    .filter(x => x.score !== undefined)
    .sort((a, b) => b.score!.total - a.score!.total);

  const recommendations: TaskRecommendation[] = ranked
    .slice(0, 5)
    .map((x, i) => ({
      rank:               i + 1,
      task:               x.task,
      score:              x.score!,
      planInfo:           x.planInfo,
      estimatedExecOrder: i + 1,
    }));

  const lastCalculated = ranked[0]?.score?.calculatedAt ?? null;

  return { recommendations, totalPending: pending.length, totalScored: scored, lastCalculated };
}

// ─── Public: get all ranked pending tasks ─────────────────────────────────────

export function getRankedTasks(): Array<{
  task:     MasterTask;
  score:    PriorityScore | undefined;
  planInfo: PlanTaskInfo | undefined;
}> {
  const allTasks    = listTasks();
  const planTaskMap = buildPlanTaskMap();
  const scores      = readScores();

  return allTasks
    .filter(t => t.status !== "done" && t.status !== "cancelled")
    .map(task => ({
      task,
      score:    scores[task.id],
      planInfo: planTaskMap.get(task.id),
    }))
    .sort((a, b) => (b.score?.total ?? 0) - (a.score?.total ?? 0));
}
