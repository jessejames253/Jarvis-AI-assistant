/**
 * lib/agents/baseAgent.ts — Phase 4 agent interface contract.
 *
 * Defines the shape every agent must conform to.
 * Agents are stateless definitions — all state lives in the task graph.
 */

import type { Permission } from "./permissions";

// ─── Risk + execution vocabulary ─────────────────────────────────────────────

/** Maximum risk level an agent is allowed to propose/apply. */
export type RiskLimit = "safe" | "review" | "risky";

/**
 * Execution mode constrains what class of side-effects an agent can have:
 *  read-only  — no writes, no commands, no git
 *  proposal   — may propose patches (pending-patch queue only)
 *  test       — may run allowlisted test/typecheck commands
 *  git        — may interact with git (checkpoint / commit / rollback)
 */
export type ExecutionMode = "read-only" | "proposal" | "test" | "git";

// ─── Context passed to every agent at run time ────────────────────────────────

export interface AgentContext {
  taskId:               string;
  taskTitle:            string;
  taskDescription:      string;
  projectHealthScore?:  number;
  activePatchCount?:    number;
  lastValidationPassed?: boolean;
  gitBranch?:           string;
  recentErrors?:        string[];
  autoFixSummary?:      string;
}

// ─── Result returned after a task run ────────────────────────────────────────

export interface AgentRunResult {
  agentId:           string;
  taskId:            string;
  success:           boolean;
  output:            string;
  structuredOutput?: Record<string, unknown>;
  error?:            string;
  actionsPerformed?: string[];
  /** Task IDs created by PlannerAgent as subtasks. */
  proposedTaskIds?:  string[];
  /** Patch IDs created by BuilderAgent. */
  proposedPatchIds?: string[];
  durationMs:        number;
}

// ─── Agent definition ─────────────────────────────────────────────────────────

export interface AgentDefinition {
  /** Unique, stable identifier (kebab-case, e.g. "planner"). */
  id:            string;
  /** Human-readable name. */
  name:          string;
  /** Short role description used in logs and UI. */
  role:          string;
  /** Longer description shown in the Multi-Agent panel. */
  description:   string;
  /** Plain-language list of what this agent can do. */
  capabilities:  string[];
  /** Exhaustive list of permissions this agent holds. */
  permissions:   Permission[];
  /** Maximum risk level for any action this agent proposes. */
  riskLimit:     RiskLimit;
  /** Controls which class of side-effects the agent may have. */
  executionMode: ExecutionMode;
  /**
   * Build the agent's system prompt given the current task context.
   * Called immediately before the Claude API call.
   */
  systemPromptBuilder(context: AgentContext): string;
}
