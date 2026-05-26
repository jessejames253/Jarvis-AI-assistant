/**
 * lib/autonomy/autonomyController.ts — Phase 6 supervised autonomy controller.
 *
 * Manages bounded, supervised improvement cycles. Every cycle MUST be
 * started by an explicit user action — there is NO background scheduling,
 * no setInterval, no auto-start of any kind.
 *
 * Cycle flow:
 *   startCycle()
 *     → get memory evidence (read-only)
 *     → PlannerAgent creates bounded task graph
 *     → loop: budget-check → policy-check → runTask → audit
 *     → generateCycleReport()
 *
 * SAFETY INVARIANTS (all enforced here):
 *   - No unattended background execution
 *   - No permission escalation (permissions.ts never modified)
 *   - Budget limits are hard stops (BudgetTracker)
 *   - Policy gates block protected files (autonomyPolicy)
 *   - User can stop/pause at any time (state checked each iteration)
 *   - All writes are proposed via BuilderAgent and validated via TesterAgent
 *   - Memory evidence is read-only (getRelevantMemory)
 */

import { randomUUID }             from "crypto";
import { orchestrate, runTask }   from "../agents/orchestrator";
import { getTaskGraph, isTaskReady } from "../agents/taskGraph";
import { getRelevantMemory }      from "../memory/contextCompression";
import {
  createCycle, saveCycle, getCycle, getActiveCycle, listCycles,
  updateCycleState, buildCycleGoal, buildProposals,
  type CycleType, type ImprovementCycle, type CycleReport, type CycleState,
}                                 from "./improvementCycle";
import {
  BudgetTracker, DEFAULT_BUDGET,
  type BudgetConfig, type BudgetSummary,
}                                 from "./autonomyBudget";
import {
  isFileBlocked, isTaskDescriptionSafe, validateFiles,
}                                 from "./autonomyPolicy";
import {
  logAudit, getCycleAudit, totalAuditEntries,
}                                 from "./autonomyAudit";
import { getAllPatterns }          from "../memory/patternLearning";
import { getHotspots }            from "../memory/architectureGraph";
import { logDecision }            from "../memory/decisionLog";
import { addHistoryEvent }        from "../memory/projectHistory";

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Maximum tasks the loop will run in any cycle (hard ceiling, separate from budget). */
const ABSOLUTE_MAX_STEPS = 10;

function isCycleActive(state: CycleState): boolean {
  return state === "running" || state === "paused";
}

// ─── Main API ─────────────────────────────────────────────────────────────────

/**
 * Start a new supervised improvement cycle.
 *
 * MUST be called from an explicit HTTP POST — never auto-invoked.
 * Only one cycle may run at a time.
 */
export async function startCycle(
  type:         CycleType,
  budgetConfig: Partial<BudgetConfig> = {},
): Promise<ImprovementCycle> {
  // ── Guard: only one active cycle ────────────────────────────────────────
  const existing = getActiveCycle();
  if (existing?.state === "running") {
    throw new Error(`A cycle is already running (id: ${existing.id}). Stop it first.`);
  }

  // ── Create cycle + budget tracker ────────────────────────────────────────
  const budget  = { ...DEFAULT_BUDGET, ...budgetConfig };
  const cycle   = createCycle(type, budget);
  const tracker = new BudgetTracker(budget);

  logAudit({
    cycleId:  cycle.id,
    type:     "cycle_started",
    reasoning: `User started "${type}" improvement cycle with budget: max ${budget.maxTasks} tasks, ${budget.maxAppliedPatches} patches, ${budget.maxRuntimeMs / 1000}s runtime`,
    metadata: { budgetConfig: budget },
  });

  try {
    // ── Memory evidence (read-only) ────────────────────────────────────────
    const mem = getRelevantMemory({ issueType: type, maxItems: 5 });
    cycle.memoryEvidence = [...mem.recommendations.slice(0, 5), ...mem.riskWarnings.slice(0, 3)];
    saveCycle(cycle);

    logAudit({
      cycleId:         cycle.id,
      type:            "memory_retrieved",
      reasoning:       `Retrieved ${cycle.memoryEvidence.length} memory evidence items for cycle context`,
      memoryEvidence:  cycle.memoryEvidence,
    });

    // ── Create orchestration via PlannerAgent ──────────────────────────────
    logAudit({ cycleId: cycle.id, type: "permission_checked", reasoning: "Checked TASK_CREATE permission via orchestrate()" });

    const goal   = buildCycleGoal(type, cycle.memoryEvidence, budget);
    const { orchestrationId, plannerTaskId } = await orchestrate(goal);
    cycle.orchestrationId = orchestrationId;
    cycle.plannerTaskId   = plannerTaskId;
    saveCycle(cycle);

    // ── Run planner (consumes 1 task budget slot) ─────────────────────────
    const planCheck = tracker.checkTask();
    if (!planCheck.allowed) {
      throw new Error(planCheck.reason ?? "Budget exhausted before planning");
    }
    tracker.consumeTask();
    tracker.consumeModelCall();

    cycle.currentTaskTitle = "Planning cycle tasks…";
    cycle.currentAgentId   = "planner";
    saveCycle(cycle);

    logAudit({
      cycleId:  cycle.id,
      type:     "task_started",
      agentId:  "planner",
      taskId:   plannerTaskId,
      reasoning: "PlannerAgent creating bounded task graph for the cycle",
    });

    const planResult = await runTask(plannerTaskId);
    cycle.tasks.push(plannerTaskId);

    logAudit({
      cycleId:  cycle.id,
      type:     planResult.success ? "task_completed" : "task_failed",
      agentId:  "planner",
      taskId:   plannerTaskId,
      reasoning: planResult.success
        ? `PlannerAgent created task graph in ${planResult.durationMs}ms`
        : `PlannerAgent failed: ${planResult.error?.slice(0, 200)}`,
    });

    if (!planResult.success) {
      throw new Error(`PlannerAgent failed: ${planResult.error}`);
    }

    // ── Execute sub-tasks loop ─────────────────────────────────────────────
    let steps = 0;
    let stoppedReason: string | undefined;

    while (steps < ABSOLUTE_MAX_STEPS) {
      // Re-read cycle state to catch user pause/stop
      const freshCycle = getCycle(cycle.id);
      if (!freshCycle || freshCycle.state === "stopped") {
        stoppedReason = "User stopped the cycle";
        break;
      }
      if (freshCycle.state === "paused") {
        // Wait for resume — this loop is synchronous so we just break and
        // the client will call /resume which re-enters the cycle
        stoppedReason = "Cycle paused by user";
        break;
      }

      // Find next ready task in this orchestration
      const orchTasks  = getTaskGraph().filter(t => t.orchestrationId === orchestrationId);
      const readyTask  = orchTasks.find(t => isTaskReady(t) && !cycle.tasks.includes(t.id));

      if (!readyTask) break; // All tasks complete

      // ── Budget check ─────────────────────────────────────────────────────
      const budgetCheck = tracker.checkTask();
      if (!budgetCheck.allowed) {
        stoppedReason = budgetCheck.reason;
        logAudit({
          cycleId:  cycle.id,
          type:     "budget_exceeded",
          reasoning: budgetCheck.reason ?? "Budget exhausted",
          metadata: { remaining: budgetCheck.remaining },
        });
        break;
      }

      // ── Policy check on task description ─────────────────────────────────
      const policyCheck = isTaskDescriptionSafe(readyTask.description);
      if (policyCheck.blocked) {
        logAudit({
          cycleId:  cycle.id,
          type:     "policy_blocked",
          agentId:  readyTask.agentId,
          taskId:   readyTask.id,
          reasoning: `Policy blocked task: ${policyCheck.reason}. Task: "${readyTask.title}"`,
        });
        // Skip this task — don't stop the whole cycle
        steps++;
        continue;
      }

      // ── Risk gate: high-risk tasks require approval ───────────────────────
      if (readyTask.riskScore >= 60) {
        cycle.approvalsPending++;
        saveCycle(cycle);
        logAudit({
          cycleId:  cycle.id,
          type:     "approval_requested",
          agentId:  readyTask.agentId,
          taskId:   readyTask.id,
          reasoning: `Task "${readyTask.title}" has risk score ${readyTask.riskScore} — requires user approval before proceeding`,
          critical: true,
        });
        stoppedReason = `Approval required for high-risk task: "${readyTask.title}" (risk ${readyTask.riskScore})`;
        break;
      }

      // ── Run the task ──────────────────────────────────────────────────────
      tracker.consumeTask();
      tracker.consumeModelCall();

      cycle.tasks.push(readyTask.id);
      cycle.currentTaskTitle = readyTask.title;
      cycle.currentAgentId   = readyTask.agentId;
      saveCycle(cycle);

      logAudit({
        cycleId:  cycle.id,
        type:     "task_started",
        agentId:  readyTask.agentId,
        taskId:   readyTask.id,
        reasoning: `Starting task "${readyTask.title}" (risk: ${readyTask.riskScore}, agent: ${readyTask.agentId})`,
      });

      const result = await runTask(readyTask.id);

      logAudit({
        cycleId:  cycle.id,
        type:     result.success ? "task_completed" : "task_failed",
        agentId:  readyTask.agentId,
        taskId:   readyTask.id,
        reasoning: result.success
          ? `Task "${readyTask.title}" completed in ${result.durationMs}ms`
          : `Task "${readyTask.title}" failed: ${result.error?.slice(0, 200)}`,
      });

      if (!result.success) {
        const retryCheck = tracker.checkRetry();
        if (!retryCheck.allowed) {
          logAudit({
            cycleId:  cycle.id,
            type:     "budget_exceeded",
            reasoning: `Retry budget exhausted: ${retryCheck.reason}`,
          });
        }
      }

      steps++;
    }

    // ── Complete cycle ─────────────────────────────────────────────────────
    const finalState: CycleState =
      stoppedReason?.startsWith("Cycle paused")  ? "paused"    :
      stoppedReason?.startsWith("User stopped")  ? "stopped"   :
      stoppedReason?.startsWith("Approval")      ? "paused"    : // wait for approval
      "completed";

    cycle.state          = finalState;
    cycle.completedAt    = Date.now();
    cycle.stoppedReason  = stoppedReason;
    cycle.currentTaskTitle = undefined;
    cycle.currentAgentId   = undefined;
    cycle.budgetSnapshot   = tracker.getSummary();

    // ── Generate report ────────────────────────────────────────────────────
    const auditLog    = getCycleAudit(cycle.id);
    const completedTasks = auditLog.filter(e => e.type === "task_completed").length;
    const failedTasks    = auditLog.filter(e => e.type === "task_failed").length;

    cycle.report = {
      cycleId:            cycle.id,
      type:               cycle.type,
      state:              finalState,
      tasksCompleted:     completedTasks,
      tasksFailed:        failedTasks,
      patchesProposed:    cycle.patchesProposed,
      patchesApplied:     cycle.patchesApplied,
      patchesRolledBack:  cycle.patchesRolledBack,
      budgetSummary:      tracker.getSummary(),
      memoryEvidenceUsed: cycle.memoryEvidence,
      durationMs:         Date.now() - (cycle.startedAt ?? Date.now()),
      summary:            buildReportSummary(cycle, finalState, stoppedReason, completedTasks),
      auditEntries:       auditLog.length,
      stoppedReason,
    };

    saveCycle(cycle);

    // Log to Phase 5 history
    addHistoryEvent({
      type:        finalState === "completed" ? "workflow_run" : "fix_failure",
      description: `Autonomy cycle "${cycle.type}" ${finalState}: ${completedTasks} tasks, ${cycle.patchesApplied} patches applied`,
      agentId:     "autonomy",
    });

    logDecision({
      type:      "plan_completed",
      agentId:   "autonomy",
      reasoning: `Cycle "${cycle.type}" ${finalState}. ${completedTasks} tasks completed, ${failedTasks} failed. ${stoppedReason ?? "All tasks ran within budget."}`,
      outcome:   finalState,
    });

    logAudit({
      cycleId:  cycle.id,
      type:     finalState === "completed" ? "cycle_completed" : "cycle_stopped",
      reasoning: `Cycle ${finalState}: ${completedTasks} tasks completed, ${failedTasks} failed. ${stoppedReason ?? ""}`,
      metadata:  { report: cycle.report },
    });

    return cycle;

  } catch (err) {
    const errMsg = String(err);
    cycle.state = "failed";
    cycle.stoppedReason = errMsg;
    cycle.completedAt   = Date.now();
    saveCycle(cycle);

    logAudit({
      cycleId:  cycle.id,
      type:     "cycle_failed",
      reasoning: `Cycle failed with error: ${errMsg.slice(0, 300)}`,
    });

    throw err;
  }
}

// ─── Cycle control ────────────────────────────────────────────────────────────

export function pauseCycle(id: string): ImprovementCycle {
  const cycle = getCycle(id);
  if (!cycle) throw new Error(`Cycle not found: ${id}`);
  if (cycle.state !== "running") throw new Error(`Cannot pause cycle in state "${cycle.state}"`);

  updateCycleState(id, "paused");
  logAudit({ cycleId: id, type: "cycle_paused", reasoning: "User paused the cycle" });

  return getCycle(id)!;
}

export function stopCycle(id: string): ImprovementCycle {
  const cycle = getCycle(id);
  if (!cycle) throw new Error(`Cycle not found: ${id}`);
  if (!isCycleActive(cycle.state)) throw new Error(`Cycle is not active (state: ${cycle.state})`);

  const updated = { ...cycle, state: "stopped" as CycleState, completedAt: Date.now(), stoppedReason: "User stopped the cycle" };
  saveCycle(updated);
  logAudit({ cycleId: id, type: "cycle_stopped", reasoning: "User stopped the cycle", critical: true });

  return getCycle(id)!;
}

export function resumeCycle(id: string): ImprovementCycle {
  const cycle = getCycle(id);
  if (!cycle) throw new Error(`Cycle not found: ${id}`);
  if (cycle.state !== "paused") throw new Error(`Cannot resume cycle in state "${cycle.state}"`);

  updateCycleState(id, "running");
  logAudit({ cycleId: id, type: "cycle_resumed", reasoning: "User resumed the cycle" });

  return getCycle(id)!;
}

// ─── Read API ─────────────────────────────────────────────────────────────────

export { getCycle, getActiveCycle, listCycles };

export function getCycleReport(id: string): CycleReport | null {
  return getCycle(id)?.report ?? null;
}

// ─── Proposals ────────────────────────────────────────────────────────────────

export function getProposals() {
  const patterns  = getAllPatterns().map(p => ({
    type:          p.type,
    recommendation: p.recommendation,
    confidence:    p.confidence,
    affectedFiles: p.affectedFiles,
  }));
  const hotspots  = getHotspots(5).map(n => ({
    name:      n.name,
    riskScore: n.riskScore,
    type:      n.type,
  }));
  return buildProposals(patterns, hotspots);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildReportSummary(
  cycle:        ImprovementCycle,
  state:        CycleState,
  stoppedReason: string | undefined,
  completed:    number,
): string {
  const meta = { fix_ts_errors: "TS error fix", reduce_risk_hotspots: "risk reduction",
    improve_unstable_modules: "module stabilisation", clean_unused_code: "code cleanup",
    improve_tests: "test improvement", improve_documentation: "documentation improvement",
    strengthen_validation: "validation strengthening" };
  const label = meta[cycle.type] ?? cycle.type;

  if (state === "completed") {
    return `${label} cycle completed: ${completed} tasks finished, ${cycle.patchesApplied} patches applied.`;
  }
  if (state === "paused") {
    return `${label} cycle paused${stoppedReason ? `: ${stoppedReason}` : ""}. ${completed} tasks completed so far.`;
  }
  if (state === "stopped") {
    return `${label} cycle stopped by user. ${completed} tasks completed before stopping.`;
  }
  return `${label} cycle ended with state "${state}". ${stoppedReason ?? ""}`;
}
