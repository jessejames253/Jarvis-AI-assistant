/**
 * lib/agents/orchestrator.ts — Phase 4 agent orchestrator.
 *
 * Coordinates the multi-agent pipeline:
 *   User goal → PlannerAgent creates task graph
 *             → Individual tasks triggered manually (no autonomous execution)
 *             → Each task dispatched to its assigned agent via Claude
 *
 * SAFETY: runTask() is NEVER called automatically.
 *         It is only invoked by explicit POST /api/agents/tasks/:id/run requests.
 */

import { randomUUID }       from "crypto";
import { anthropic }        from "@workspace/integrations-anthropic-ai";
import { getAgent }         from "./registry";
import {
  createTask, getTask, updateTask, getTaskGraph,
  type Task, type TaskPriority,
}                           from "./taskGraph";
import { getSharedContext } from "./contextBus";
import { assertPermission, PERMISSIONS } from "./permissions";
import type { AgentRunResult }           from "./baseAgent";

const MODEL      = "claude-sonnet-4-6";
const MAX_TOKENS = 2048;

// ─── Orchestrate ──────────────────────────────────────────────────────────────

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

  return {
    orchestrationId,
    plannerTaskId: task.id,
    message:
      "Orchestration created. PlannerAgent task is queued — " +
      "run it manually to generate the task graph.",
  };
}

// ─── Run a single task ────────────────────────────────────────────────────────

/**
 * Execute one task via its assigned agent (calls Claude with the agent's
 * system prompt).  NEVER called automatically — always user-initiated.
 */
export async function runTask(taskId: string): Promise<AgentRunResult> {
  const task = getTask(taskId);
  if (!task)                          throw new Error(`Task '${taskId}' not found`);
  if (task.status === "running")      throw new Error(`Task '${taskId}' is already running`);
  if (task.status === "done")         throw new Error(`Task '${taskId}' is already complete`);
  if (task.status === "cancelled")    throw new Error(`Task '${taskId}' was cancelled`);

  // Dependency gate
  const unmet = task.dependencies.filter(d => getTask(d)?.status !== "done");
  if (unmet.length > 0) {
    throw new Error(
      `Task '${taskId}' has unmet dependencies: [${unmet.join(", ")}]`,
    );
  }

  const agent = getAgent(task.agentId);
  if (!agent) throw new Error(`Agent '${task.agentId}' is not registered`);

  // Permission gate: every agent must have TASK_UPDATE to write its result
  assertPermission(agent.permissions, PERMISSIONS.TASK_UPDATE, agent.id);

  // Mark running
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

    const systemPrompt = agent.systemPromptBuilder(agentContext);

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

    // PlannerAgent: parse subtasks from the plan and register them
    if (task.agentId === "planner") {
      const subtasks = structuredOutput.subtasks as Array<{
        title:       string;
        description: string;
        agentId:     string;
        dependsOn?:  number;
        riskScore?:  number;
        priority?:   TaskPriority;
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
          proposedTaskIds.push(created.id);
        }
      }
    }

    const result: AgentRunResult = {
      agentId:            agent.id,
      taskId,
      success:            true,
      output:             textContent,
      structuredOutput,
      actionsPerformed:   structuredOutput.actions as string[] | undefined,
      proposedTaskIds,
      durationMs:         Date.now() - start,
    };

    updateTask(taskId, {
      status:          "done",
      completedAt:     Date.now(),
      result:          textContent.slice(0, 3000),
      structuredResult: structuredOutput,
    });

    return result;
  } catch (err) {
    const errMsg = String(err);
    updateTask(taskId, {
      status:      "failed",
      completedAt: Date.now(),
      error:       errMsg,
      retryCount:  (task.retryCount ?? 0) + 1,
    });
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

// ─── Output parser ────────────────────────────────────────────────────────────

function extractStructuredOutput(
  agentId: string,
  text: string,
): Record<string, unknown> {
  // Try to extract a JSON block from the response
  const jsonMatch = /```json\s*([\s\S]+?)\s*```/.exec(text);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]) as Record<string, unknown>;
    } catch { /* fall through to defaults */ }
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

// ─── Orchestration status ─────────────────────────────────────────────────────

export function getOrchestrationStatus(orchestrationId: string): {
  tasks: Task[];
  total: number;
  done: number;
  failed: number;
  pending: number;
  running: number;
  complete: boolean;
} {
  const tasks = getTaskGraph().filter(t => t.orchestrationId === orchestrationId);
  const done    = tasks.filter(t => t.status === "done").length;
  const failed  = tasks.filter(t => t.status === "failed").length;
  const running = tasks.filter(t => t.status === "running").length;
  const pending = tasks.filter(t => t.status === "pending").length;

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
