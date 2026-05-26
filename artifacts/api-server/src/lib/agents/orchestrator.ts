/**
 * lib/agents/orchestrator.ts — Phase 4 / 4B agent orchestrator.
 *
 * Phase 4:  orchestrate() + runTask() — user-triggered single task execution.
 * Phase 4B: runPlan() + stepNext() + pause/resume — supervised sequential engine.
 *
 * SAFETY INVARIANT: No task is EVER executed automatically.
 *   runPlan() / stepNext() must be triggered by an explicit user API call.
 *   The orchestrator CANNOT grant or modify agent permissions.
 */

import { randomUUID }                from "crypto";
import { anthropic }                 from "@workspace/integrations-anthropic-ai";
import { getAgent }                  from "./registry";
import {
  createTask, getTask, updateTask, getTaskGraph,
  isSuccess, isTerminal, isTaskReady,
  type Task, type TaskPriority, type TaskStatus,
}                                    from "./taskGraph";
import { getSharedContext }          from "./contextBus";
import { assertPermission, PERMISSIONS } from "./permissions";
import type { AgentRunResult }       from "./baseAgent";
import {
  getOrCreateRun, getOrchestrationRun, setRunState, setActiveTask,
  addTimelineEvent, getTimeline,
  type TimelineEvent,
}                                    from "./executionState";
import { sendMessage }               from "./agentMessages";
import {
  canRetry, logRetry, classifyFailure,
}                                    from "./retryPolicy";
import { getRelevantMemory }         from "../memory/contextCompression";
import { addHistoryEvent }            from "../memory/projectHistory";
import { logDecision }               from "../memory/decisionLog";
import { updatePatternFromEvent }    from "../memory/patternLearning";

const MODEL      = "claude-sonnet-4-6";
const MAX_TOKENS = 2048;
const MAX_STEPS  = 20;

// ─── Public summary type ──────────────────────────────────────────────────────

export interface PlanRunResult {
  orchestrationId: string;
  state:           string;
  steps:           number;
  totalTasks:      number;
  passed:          number;
  failed:          number;
  blocked:         number;
  skipped:         number;
  rolledBack:      number;
  durationMs?:     number;
  currentAgentId?: string;
  activeTaskId?:   string;
  agentActions:    Array<{ agentId: string; taskTitle: string; status: string; retryCount: number }>;
  timeline:        TimelineEvent[];
  message:         string;
}

// ─── Phase 4: orchestrate + runTask ──────────────────────────────────────────

/**
 * Create a new orchestration from a user goal.
 * Registers a single PlannerAgent task; user must run it to get subtasks.
 */
export async function orchestrate(userGoal: string): Promise<{
  orchestrationId: string;
  plannerTaskId:   string;
  message:         string;
}> {
  const planner = getAgent("planner");
  if (!planner) throw new Error("PlannerAgent is not registered");

  const orchestrationId = randomUUID();

  const task = createTask({
    title:           `Plan: ${userGoal.slice(0, 80)}`,
    description:     userGoal,
    agentId:         "planner",
    dependencies:    [],
    priority:        "high",
    riskScore:       0,
    orchestrationId,
  });

  // Initialise the run state
  getOrCreateRun(orchestrationId);
  addTimelineEvent(orchestrationId, "task_created", {
    taskId:  task.id,
    agentId: "planner",
    message: `PlannerAgent task created: ${task.title}`,
  });

  return {
    orchestrationId,
    plannerTaskId: task.id,
    message:
      "Orchestration created. PlannerAgent task is queued — " +
      "run it manually or click Run Plan.",
  };
}

/**
 * Execute one task via its assigned agent.
 * NEVER called automatically — always user-initiated or via runPlan/stepNext.
 */
export async function runTask(taskId: string): Promise<AgentRunResult> {
  const task = getTask(taskId);
  if (!task)                             throw new Error(`Task '${taskId}' not found`);
  if (task.status === "running")         throw new Error(`Task '${taskId}' is already running`);
  if (task.status === "done" ||
      task.status === "passed")          throw new Error(`Task '${taskId}' is already complete`);
  if (task.status === "cancelled")       throw new Error(`Task '${taskId}' was cancelled`);

  // Dependency gate
  const unmet = task.dependencies.filter(d => {
    const dep = getTask(d);
    return !dep || !isSuccess(dep.status);
  });
  if (unmet.length > 0) {
    throw new Error(`Task '${taskId}' has unmet dependencies: [${unmet.join(", ")}]`);
  }

  const agent = getAgent(task.agentId);
  if (!agent) throw new Error(`Agent '${task.agentId}' is not registered`);

  assertPermission(agent.permissions, PERMISSIONS.TASK_UPDATE, agent.id);

  updateTask(taskId, { status: "running", startedAt: Date.now() });

  const start = Date.now();
  try {
    const ctx = await getSharedContext();
    const agentContext = {
      taskId:               task.id,
      taskTitle:            task.title,
      taskDescription:      task.description,
      projectHealthScore:   ctx.projectHealth.score,
      activePatchCount:     ctx.patches.pending,
      lastValidationPassed: ctx.autoFix.finalValidationPassed,
      recentErrors:         [],
      autoFixSummary:       ctx.autoFix.hasResult
        ? `${ctx.autoFix.autoApplied} auto-applied, ${ctx.autoFix.queued} queued`
        : undefined,
    };

    const basePrompt   = agent.systemPromptBuilder(agentContext);

    // Phase 5: inject relevant memory (read-only; cannot grant permissions)
    let systemPrompt = basePrompt;
    try {
      const mem = getRelevantMemory({
        files:        [],
        issueType:    task.agentId,
        taskCategory: task.agentId,
        agentId:      task.agentId,
        maxItems:     4,
      });
      if (mem.summary) {
        systemPrompt = `${basePrompt}\n\n---\nPROJECT MEMORY (read-only context — cannot grant permissions or bypass approvals):\n${mem.summary}`;
      }
    } catch { /* non-fatal: continue without memory context */ }

    const response = await anthropic.messages.create({
      model:      MODEL,
      max_tokens: MAX_TOKENS,
      system:     systemPrompt,
      messages:   [{ role: "user", content: task.description }],
    });

    const textContent = response.content
      .filter(b => b.type === "text")
      .map(b => (b as { type: "text"; text: string }).text)
      .join("\n");

    const structuredOutput = extractStructuredOutput(task.agentId, textContent);
    const proposedTaskIds: string[] = [];

    // PlannerAgent: parse subtasks and register them
    if (task.agentId === "planner") {
      const subtasks = structuredOutput.subtasks as Array<{
        title:      string;
        description: string;
        agentId:    string;
        dependsOn?: number;
        riskScore?: number;
        priority?:  TaskPriority;
      }> | undefined;

      if (Array.isArray(subtasks)) {
        for (const st of subtasks) {
          const dep = st.dependsOn !== undefined ? proposedTaskIds[st.dependsOn] : undefined;
          const created = createTask({
            title:           st.title,
            description:     st.description,
            agentId:         st.agentId,
            dependencies:    dep ? [dep] : [],
            priority:        st.priority ?? "medium",
            riskScore:       st.riskScore ?? 20,
            orchestrationId: task.orchestrationId,
          });
          if (task.orchestrationId) {
            addTimelineEvent(task.orchestrationId, "task_created", {
              taskId:  created.id,
              agentId: st.agentId,
              message: `Subtask created: ${st.title}`,
            });
          }
          proposedTaskIds.push(created.id);
        }

        // Send plan_created message
        if (task.orchestrationId && proposedTaskIds.length > 0) {
          sendMessage({
            fromAgent:       "planner",
            toAgent:         "orchestrator",
            taskId:          task.id,
            orchestrationId: task.orchestrationId,
            type:            "plan_created",
            content:         `Plan created with ${proposedTaskIds.length} subtasks`,
            risk:            "safe",
          });
        }
      }
    }

    const result: AgentRunResult = {
      agentId:           agent.id,
      taskId,
      success:           true,
      output:            textContent,
      structuredOutput,
      actionsPerformed:  structuredOutput.actions as string[] | undefined,
      proposedTaskIds,
      durationMs:        Date.now() - start,
    };

    updateTask(taskId, {
      status:           "done",
      completedAt:      Date.now(),
      result:           textContent.slice(0, 3000),
      structuredResult: structuredOutput,
    });

    // Phase 5: log success to history and decision log
    try {
      const histEv = addHistoryEvent({
        type:            "fix_success",
        description:     `${task.agentId} completed task: ${task.title}`,
        agentId:         task.agentId,
        orchestrationId: task.orchestrationId,
      });
      updatePatternFromEvent(histEv);
      logDecision({
        type:            "agent_reasoning",
        agentId:         task.agentId,
        taskId:          task.id,
        orchestrationId: task.orchestrationId,
        reasoning:       `Task completed in ${Date.now() - start}ms. Agent: ${task.agentId}. Task: ${task.title}`,
        outcome:         "success",
      });
    } catch { /* non-fatal */ }

    return result;
  } catch (err) {
    const errMsg = String(err);
    updateTask(taskId, {
      status:      "failed",
      completedAt: Date.now(),
      error:       errMsg,
      retryCount:  (task.retryCount ?? 0) + 1,
    });

    // Phase 5: log failure to history and decision log
    try {
      const failureClass = classifyFailure(errMsg);
      const histEv = addHistoryEvent({
        type:            "fix_failure",
        description:     `${task.agentId} failed task: ${task.title}`,
        errorMessage:    errMsg.slice(0, 500),
        agentId:         task.agentId,
        orchestrationId: task.orchestrationId,
      });
      updatePatternFromEvent(histEv);
      logDecision({
        type:            "task_failed",
        agentId:         task.agentId,
        taskId:          task.id,
        orchestrationId: task.orchestrationId,
        reasoning:       `Task failed: ${task.title}. Error: ${errMsg.slice(0, 200)}`,
        riskRationale:   `Failure class: ${failureClass}`,
        outcome:         "failure",
      });
    } catch { /* non-fatal */ }

    return {
      agentId:   task.agentId,
      taskId,
      success:   false,
      output:    "",
      error:     errMsg,
      durationMs: Date.now() - start,
    };
  }
}

// ─── Phase 4B: supervised plan execution ─────────────────────────────────────

/**
 * Run all ready tasks in dependency order until:
 *   - all tasks complete/fail/block, OR
 *   - a high-risk task requires approval, OR
 *   - the plan is paused, OR
 *   - MAX_STEPS is reached.
 *
 * NEVER auto-invoked — requires explicit POST /api/agents/plan/:id/run.
 */
export async function runPlan(orchestrationId: string): Promise<PlanRunResult> {
  const run = getOrCreateRun(orchestrationId);
  if (run.state === "running") throw new Error("Plan is already running");

  setRunState(orchestrationId, "running");
  addTimelineEvent(orchestrationId, "plan_started", {
    message: "Plan execution started",
  });

  let steps = 0;
  let prevTaskId: string | undefined;

  while (steps < MAX_STEPS) {
    const currentRun = getOrchestrationRun(orchestrationId);
    if (currentRun?.state === "paused") break;

    // Find next ready task for this orchestration
    const orchTasks = getTaskGraph().filter(t => t.orchestrationId === orchestrationId);
    const readyTask = orchTasks.find(isTaskReady);

    if (!readyTask) {
      // Propagate blocked status for pending tasks with failed deps
      propagateBlocked(orchTasks);
      break;
    }

    // High-risk task → stop for approval
    if (readyTask.riskScore >= 60) {
      updateTask(readyTask.id, { status: "waiting_approval" });
      addTimelineEvent(orchestrationId, "approval_requested", {
        taskId:  readyTask.id,
        agentId: readyTask.agentId,
        message: `'${readyTask.title}' requires approval (risk ${readyTask.riskScore})`,
      });
      sendMessage({
        fromAgent:       readyTask.agentId,
        toAgent:         "orchestrator",
        taskId:          readyTask.id,
        orchestrationId,
        type:            "approval_required",
        content:         `Risk ${readyTask.riskScore} task requires approval: ${readyTask.title}`,
        risk:            "risky",
      });
      break;
    }

    // Handoff message when agent changes
    if (prevTaskId) {
      const prev = getTask(prevTaskId);
      if (prev && prev.agentId !== readyTask.agentId) {
        sendMessage({
          fromAgent:       prev.agentId,
          toAgent:         readyTask.agentId,
          taskId:          readyTask.id,
          orchestrationId,
          type:            "handoff_sent",
          content:         `Handoff: ${prev.agentId} → ${readyTask.agentId}`,
          risk:            "safe",
        });
        addTimelineEvent(orchestrationId, "handoff_sent", {
          taskId:  readyTask.id,
          agentId: readyTask.agentId,
          message: `${prev.agentId} → ${readyTask.agentId}`,
        });
      }
    }

    setActiveTask(orchestrationId, readyTask.id, readyTask.agentId);
    addTimelineEvent(orchestrationId, "task_started", {
      taskId:  readyTask.id,
      agentId: readyTask.agentId,
      message: `${readyTask.agentId}: ${readyTask.title}`,
    });

    const result = await runTask(readyTask.id);
    prevTaskId = readyTask.id;

    if (result.success) {
      addTimelineEvent(orchestrationId, "task_completed", {
        taskId:  readyTask.id,
        agentId: readyTask.agentId,
        message: `Completed: ${readyTask.title}`,
      });
      sendMessage({
        fromAgent:       readyTask.agentId,
        toAgent:         "orchestrator",
        taskId:          readyTask.id,
        orchestrationId,
        type:            "task_completed",
        content:         `Task completed: ${readyTask.title}`,
        risk:            "safe",
      });
    } else {
      addTimelineEvent(orchestrationId, "task_failed", {
        taskId:  readyTask.id,
        agentId: readyTask.agentId,
        message: `Failed: ${readyTask.title} — ${result.error ?? "unknown"}`,
        metadata: { error: result.error, failureClass: classifyFailure(result.error ?? "") },
      });
      sendMessage({
        fromAgent:       readyTask.agentId,
        toAgent:         "orchestrator",
        taskId:          readyTask.id,
        orchestrationId,
        type:            "task_failed",
        content:         `Task failed: ${result.error ?? "unknown"}`,
        risk:            "safe",
      });

      // Retry?
      const taskState = getTask(readyTask.id);
      if (taskState && canRetry(taskState, result.error ?? "")) {
        logRetry(readyTask.id, taskState.retryCount, result.error ?? "");
        addTimelineEvent(orchestrationId, "retry_attempted", {
          taskId:  readyTask.id,
          message: `Retry ${taskState.retryCount}/${taskState.maxRetries}: ${readyTask.title}`,
        });
        updateTask(readyTask.id, { status: "pending" });
        steps++; // count the failed attempt
        continue;
      } else {
        // Cascade block to dependents
        const orchTasksNow = getTaskGraph().filter(t => t.orchestrationId === orchestrationId);
        propagateBlocked(orchTasksNow);
      }
    }

    steps++;
  }

  // Finalize
  const finalTasks = getTaskGraph().filter(t => t.orchestrationId === orchestrationId);
  propagateBlocked(finalTasks);
  setActiveTask(orchestrationId, undefined, undefined);

  const allTerminal = finalTasks.every(
    t => isTerminal(t.status) || t.status === "waiting_approval",
  );
  const currentRun = getOrchestrationRun(orchestrationId);
  if (allTerminal && currentRun?.state === "running") {
    setRunState(orchestrationId, "completed");
    addTimelineEvent(orchestrationId, "plan_completed", {
      message: `Plan completed in ${steps} steps`,
    });
  } else if (currentRun?.state === "running") {
    // Still more to do but we stopped (paused / approval needed)
    setRunState(orchestrationId, "paused");
  }

  return buildSummary(orchestrationId, steps);
}

/**
 * Execute exactly one next ready task and return.
 * Respects pause state — throws if plan is currently paused.
 */
export async function stepNext(orchestrationId: string): Promise<PlanRunResult> {
  const run = getOrchestrationRun(orchestrationId);
  if (run?.state === "paused") throw new Error("Plan is paused — resume before stepping");

  const orchTasks = getTaskGraph().filter(t => t.orchestrationId === orchestrationId);
  propagateBlocked(orchTasks);
  const readyTask = orchTasks.find(isTaskReady);

  if (!readyTask) {
    return buildSummary(orchestrationId, 0);
  }

  // Initialise run if idle
  if (!run || run.state === "idle" || run.state === "completed") {
    setRunState(orchestrationId, "running");
  }

  // High-risk gate
  if (readyTask.riskScore >= 60) {
    updateTask(readyTask.id, { status: "waiting_approval" });
    addTimelineEvent(orchestrationId, "approval_requested", {
      taskId:  readyTask.id,
      agentId: readyTask.agentId,
      message: `'${readyTask.title}' requires approval (risk ${readyTask.riskScore})`,
    });
    return buildSummary(orchestrationId, 0);
  }

  setActiveTask(orchestrationId, readyTask.id, readyTask.agentId);
  addTimelineEvent(orchestrationId, "task_started", {
    taskId:  readyTask.id,
    agentId: readyTask.agentId,
    message: `Step: ${readyTask.agentId} — ${readyTask.title}`,
  });

  const result = await runTask(readyTask.id);

  if (result.success) {
    addTimelineEvent(orchestrationId, "task_completed", {
      taskId:  readyTask.id,
      agentId: readyTask.agentId,
      message: `Step completed: ${readyTask.title}`,
    });
    sendMessage({
      fromAgent:       readyTask.agentId,
      toAgent:         "orchestrator",
      taskId:          readyTask.id,
      orchestrationId,
      type:            "task_completed",
      content:         `Step completed: ${readyTask.title}`,
      risk:            "safe",
    });
  } else {
    addTimelineEvent(orchestrationId, "task_failed", {
      taskId:  readyTask.id,
      agentId: readyTask.agentId,
      message: `Step failed: ${result.error ?? "unknown"}`,
    });
    sendMessage({
      fromAgent:       readyTask.agentId,
      toAgent:         "orchestrator",
      taskId:          readyTask.id,
      orchestrationId,
      type:            "task_failed",
      content:         `Step failed: ${result.error ?? "unknown"}`,
      risk:            "safe",
    });
    const taskState = getTask(readyTask.id);
    if (taskState && canRetry(taskState, result.error ?? "")) {
      logRetry(readyTask.id, taskState.retryCount, result.error ?? "");
      addTimelineEvent(orchestrationId, "retry_attempted", {
        taskId:  readyTask.id,
        message: `Retry queued: ${readyTask.title}`,
      });
      updateTask(readyTask.id, { status: "pending" });
    } else {
      const updatedTasks = getTaskGraph().filter(t => t.orchestrationId === orchestrationId);
      propagateBlocked(updatedTasks);
    }
  }

  setActiveTask(orchestrationId, undefined, undefined);
  return buildSummary(orchestrationId, 1);
}

/** Pause a running plan. */
export function pausePlan(orchestrationId: string): void {
  const run = getOrchestrationRun(orchestrationId);
  if (!run) throw new Error(`Orchestration '${orchestrationId}' not found`);
  if (run.state !== "running") throw new Error(`Plan is not running (state: ${run.state})`);
  setRunState(orchestrationId, "paused");
  addTimelineEvent(orchestrationId, "plan_paused", { message: "Plan paused by user" });
}

/** Resume a paused plan. Does not auto-advance — user must call stepNext or runPlan. */
export function resumePlan(orchestrationId: string): void {
  const run = getOrchestrationRun(orchestrationId);
  if (!run) throw new Error(`Orchestration '${orchestrationId}' not found`);
  if (run.state !== "paused") throw new Error(`Plan is not paused (state: ${run.state})`);
  setRunState(orchestrationId, "running");
  addTimelineEvent(orchestrationId, "plan_resumed", { message: "Plan resumed by user" });
}

// ─── Phase 4: orchestration status ───────────────────────────────────────────

export function getOrchestrationStatus(orchestrationId: string): {
  tasks:    Task[];
  total:    number;
  done:     number;
  failed:   number;
  pending:  number;
  running:  number;
  complete: boolean;
} {
  const tasks   = getTaskGraph().filter(t => t.orchestrationId === orchestrationId);
  const done    = tasks.filter(t => t.status === "done" || t.status === "passed").length;
  const failed  = tasks.filter(t => t.status === "failed").length;
  const running = tasks.filter(t => t.status === "running").length;
  const pending = tasks.filter(t => t.status === "pending" || t.status === "ready").length;

  return {
    tasks,
    total:    tasks.length,
    done,
    failed,
    pending,
    running,
    complete: tasks.length > 0 && pending === 0 && running === 0,
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Cascade "blocked" status to tasks whose dependency has failed and
 * has exhausted retries.  Iterates until no new tasks are blocked.
 */
function propagateBlocked(orchTasks: Task[]): void {
  const taskMap = new Map(orchTasks.map(t => [t.id, t]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of orchTasks) {
      if (t.status !== "pending" && t.status !== "ready") continue;
      const hasFailedDep = t.dependencies.some(depId => {
        const dep = taskMap.get(depId);
        return dep?.status === "failed" || dep?.status === "blocked";
      });
      if (hasFailedDep) {
        updateTask(t.id, {
          status: "blocked",
          error:  `Upstream dependency failed`,
        });
        taskMap.set(t.id, { ...t, status: "blocked" });
        changed = true;
      }
    }
  }
}

function buildSummary(orchestrationId: string, steps: number): PlanRunResult {
  const allTasks = getTaskGraph().filter(t => t.orchestrationId === orchestrationId);
  const run      = getOrchestrationRun(orchestrationId);
  const timeline = getTimeline(orchestrationId);

  const passed    = allTasks.filter(t => isSuccess(t.status)).length;
  const failed    = allTasks.filter(t => t.status === "failed").length;
  const blocked   = allTasks.filter(t => t.status === "blocked").length;
  const skipped   = allTasks.filter(t => t.status === "skipped").length;
  const rolledBack = allTasks.filter(t => t.status === "rolled_back").length;

  const statusMessages: Record<string, string> = {
    running:   "Plan is running",
    paused:    "Plan paused — click Resume or Step Next",
    completed: "Plan complete",
    failed:    "Plan failed",
    idle:      "Plan not started",
  };

  return {
    orchestrationId,
    state:           run?.state ?? "idle",
    steps,
    totalTasks:      allTasks.length,
    passed,
    failed,
    blocked,
    skipped,
    rolledBack,
    durationMs:      run?.startedAt ? Date.now() - run.startedAt : undefined,
    currentAgentId:  run?.currentAgentId,
    activeTaskId:    run?.activeTaskId,
    agentActions:    allTasks.map(t => ({
      agentId:    t.agentId,
      taskTitle:  t.title,
      status:     t.status,
      retryCount: t.retryCount,
    })),
    timeline:        timeline.slice(-30),
    message:         statusMessages[run?.state ?? "idle"] ?? "Unknown state",
  };
}

function extractStructuredOutput(
  agentId: string,
  text: string,
): Record<string, unknown> {
  const jsonMatch = /```json\s*([\s\S]+?)\s*```/.exec(text);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]) as Record<string, unknown>;
    } catch { /* fall through */ }
  }
  switch (agentId) {
    case "planner":    return { subtasks: [], summary: text, actions: ["plan_created"] };
    case "builder":    return { patches: [], summary: text, actions: ["patch_analysis_done"] };
    case "tester":     return { validationSuggested: true, summary: text, actions: ["test_analysis_done"] };
    case "researcher": return { insights: [], summary: text, actions: ["research_done"] };
    case "git":        return { gitActions: [], summary: text, actions: ["git_analysis_done"] };
    default:           return { summary: text, actions: [] };
  }
}
