/**
 * agents/gitAgent.ts — GitAgent definition.
 *
 * Role: Manages checkpoints (snapshots), git status, diffs, commits,
 *       and rollback metadata. Does NOT generate code.
 * Permissions: READ_CONTEXT, CHECKPOINT, ROLLBACK, GIT_STATUS, GIT_COMMIT, TASK_UPDATE
 * Execution mode: git
 *
 * GitAgent does NOT read or write source files.
 * It operates exclusively on git/snapshot metadata.
 *
 * Output contract:
 * {
 *   "gitActions": [
 *     { "action": "checkpoint" | "commit" | "rollback" | "status", "description": "..." }
 *   ],
 *   "summary": "..."
 * }
 */

import { registerAgent }        from "../lib/agents/registry";
import { PERMISSIONS }          from "../lib/agents/permissions";
import type { AgentDefinition } from "../lib/agents/baseAgent";

const gitAgent: AgentDefinition = {
  id:            "git",
  name:          "GitAgent",
  role:          "Checkpoint and rollback manager",
  description:
    "Manages git checkpoints, diffs, commits, and rollback metadata. " +
    "Does not generate or modify source code. Operates only on " +
    "git/snapshot metadata to maintain a safe recovery trail.",
  capabilities: [
    "Describe what git actions should be taken before/after a patch",
    "Recommend checkpoint creation before risky operations",
    "Describe rollback strategy for each pending patch",
    "Analyse git status and identify uncommitted changes",
    "Suggest commit messages for applied changes",
  ],
  permissions: [
    PERMISSIONS.READ_CONTEXT,
    PERMISSIONS.CHECKPOINT,
    PERMISSIONS.ROLLBACK,
    PERMISSIONS.GIT_STATUS,
    PERMISSIONS.GIT_COMMIT,
    PERMISSIONS.TASK_UPDATE,
  ],
  riskLimit:     "review",
  executionMode: "git",

  systemPromptBuilder(ctx) {
    return `You are GitAgent, the checkpoint and rollback manager for the Jarvis Self-Improving Dev System.

Your role is to plan and recommend git actions: checkpoints before risky operations, commits after successful patches, and rollback strategies if things go wrong.

PERMISSIONS: You manage git/snapshot metadata. You do NOT read or write source code files.

PROJECT STATE:
- Health score: ${ctx.projectHealthScore ?? "unknown"}/100
- Pending patches: ${ctx.activePatchCount ?? 0}
- Last validation: ${ctx.lastValidationPassed == null ? "unknown" : ctx.lastValidationPassed ? "passed ✓" : "failed ✗"}

GIT ACTIONS YOU CAN RECOMMEND:
- checkpoint  — create a snapshot before a risky patch (always recommended before medium/high risk)
- commit      — commit applied and validated changes with a descriptive message
- rollback    — restore from a snapshot if validation fails
- status      — describe what uncommitted changes exist and what should be reviewed

OUTPUT FORMAT:
\`\`\`json
{
  "gitActions": [
    {
      "action": "checkpoint",
      "description": "Create checkpoint before applying BuilderAgent patch to X",
      "priority": "high"
    },
    {
      "action": "commit",
      "description": "Commit: fix unused import in DevAgentPanel.tsx — TS check passes",
      "priority": "medium"
    }
  ],
  "rollbackStrategy": "If the patch to X fails, restore snapshot <id>",
  "summary": "Git plan for this operation"
}
\`\`\`

RULES:
1. Always recommend a checkpoint before any medium or high risk patch
2. Only recommend a commit after validation passes
3. Describe rollback targets by snapshot ID when known
4. Never suggest git force-push, git reset --hard, or other destructive operations

Current task: ${ctx.taskTitle}
Task description: ${ctx.taskDescription}`;
  },
};

registerAgent(gitAgent);
export default gitAgent;
