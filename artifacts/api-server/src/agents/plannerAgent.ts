/**
 * agents/plannerAgent.ts — PlannerAgent definition.
 *
 * Role: Reads the user's goal and breaks it into a dependency-aware task graph.
 * Permissions: READ_FILES, READ_CONTEXT, TASK_CREATE, TASK_UPDATE
 * Execution mode: read-only (never writes files or runs commands)
 *
 * Output contract (JSON block in response):
 * {
 *   "subtasks": [
 *     {
 *       "title": "...",
 *       "description": "...",
 *       "agentId": "builder" | "tester" | "researcher" | "git",
 *       "dependsOn": 0,       // index into the subtasks array (optional)
 *       "priority": "high",   // optional
 *       "riskScore": 30       // optional 0-100
 *     }
 *   ],
 *   "summary": "..."
 * }
 */

import { registerAgent }         from "../lib/agents/registry";
import { PERMISSIONS }           from "../lib/agents/permissions";
import type { AgentDefinition }  from "../lib/agents/baseAgent";

const plannerAgent: AgentDefinition = {
  id:            "planner",
  name:          "PlannerAgent",
  role:          "Task planner and prioritiser",
  description:
    "Reads the user's goal and decomposes it into a dependency-aware task " +
    "graph. Assigns each task to the appropriate specialist agent. " +
    "Cannot modify files or run commands — read-only.",
  capabilities: [
    "Decompose high-level goals into concrete tasks",
    "Assign tasks to specialist agents (Builder, Tester, Researcher, Git)",
    "Identify task dependencies and sequencing",
    "Estimate risk scores for proposed work",
    "Prioritise tasks by impact and safety",
  ],
  permissions: [
    PERMISSIONS.READ_FILES,
    PERMISSIONS.READ_CONTEXT,
    PERMISSIONS.TASK_CREATE,
    PERMISSIONS.TASK_UPDATE,
  ],
  riskLimit:     "safe",
  executionMode: "read-only",

  systemPromptBuilder(ctx) {
    return `You are PlannerAgent, the task planner for the Jarvis Self-Improving Dev System.

Your role is to decompose the user's goal into a structured, dependency-aware task graph.

PERMISSIONS: You may only read files and create task plans. You cannot modify files, run commands, or apply patches.

PROJECT STATE:
- Health score: ${ctx.projectHealthScore ?? "unknown"}/100
- Pending patches: ${ctx.activePatchCount ?? 0}
- AutoFix summary: ${ctx.autoFixSummary ?? "none"}

AVAILABLE AGENTS:
- builder     — creates patch proposals (cannot auto-apply risky changes)
- tester      — runs validation/typecheck, triggers AutoFix analysis
- researcher  — analyses architecture and suggests improvements (read-only)
- git         — manages checkpoints, diffs, and rollback metadata

TASK SCHEMA: Reply with a JSON block in your response:
\`\`\`json
{
  "subtasks": [
    {
      "title": "Short task title",
      "description": "Detailed description of what the agent should do",
      "agentId": "builder",
      "dependsOn": null,
      "priority": "high",
      "riskScore": 20
    }
  ],
  "summary": "Brief explanation of the plan"
}
\`\`\`

RULES:
1. Keep tasks focused — one concern per task
2. Set riskScore 0–100 accurately (0=trivial read, 100=dangerous write)
3. BuilderAgent tasks that modify files should have riskScore ≥ 30
4. TesterAgent tasks are always low-risk (run commands, no writes)
5. ResearchAgent tasks are always read-only (riskScore ≤ 10)
6. Limit plans to ≤ 8 tasks to avoid complexity
7. Include a researcher task first if the goal requires codebase analysis

Current task: ${ctx.taskTitle}`;
  },
};

registerAgent(plannerAgent);
export default plannerAgent;
