/**
 * agents/builderAgent.ts — BuilderAgent definition.
 *
 * Role: Analyses the codebase and proposes concrete patch changes.
 * Permissions: READ_FILES, READ_CONTEXT, PATCH_PROPOSAL, TASK_UPDATE
 * Execution mode: proposal (patches go to queue — human must approve)
 *
 * BuilderAgent NEVER auto-applies patches. All changes go to the
 * pending-patch queue where a human clicks "Apply".
 *
 * Output contract (JSON block in response):
 * {
 *   "patches": [
 *     {
 *       "file": "relative/path.ts",
 *       "description": "...",
 *       "riskLevel": "low" | "medium" | "high",
 *       "changeDescription": "what and why"
 *     }
 *   ],
 *   "summary": "..."
 * }
 */

import { registerAgent }        from "../lib/agents/registry";
import { PERMISSIONS }          from "../lib/agents/permissions";
import type { AgentDefinition } from "../lib/agents/baseAgent";

const builderAgent: AgentDefinition = {
  id:            "builder",
  name:          "BuilderAgent",
  role:          "Patch proposer — all changes require human approval",
  description:
    "Analyses the codebase and proposes code patches. All proposals enter " +
    "the pending-patch queue and require explicit human approval before " +
    "being applied. Cannot auto-apply risky changes or interact with git.",
  capabilities: [
    "Analyse TypeScript/React code for bugs and improvements",
    "Propose patch diffs for specific files",
    "Describe risk level and impact of each change",
    "Suggest test commands to verify patches",
    "Generate refactoring proposals with clear rationale",
  ],
  permissions: [
    PERMISSIONS.READ_FILES,
    PERMISSIONS.READ_CONTEXT,
    PERMISSIONS.PATCH_PROPOSAL,
    PERMISSIONS.TASK_UPDATE,
  ],
  riskLimit:     "review",
  executionMode: "proposal",

  systemPromptBuilder(ctx) {
    return `You are BuilderAgent, the code patch proposer for the Jarvis Self-Improving Dev System.

Your role is to analyse the codebase and describe concrete patch proposals.

PERMISSIONS: You may read files and propose patches. You CANNOT apply patches, run commands, or interact with git.

PROJECT STATE:
- Health score: ${ctx.projectHealthScore ?? "unknown"}/100
- Pending patches: ${ctx.activePatchCount ?? 0}
- Last validation: ${ctx.lastValidationPassed == null ? "unknown" : ctx.lastValidationPassed ? "passed ✓" : "failed ✗"}

PATCH PROPOSAL FORMAT: Reply with a JSON block describing the patches you recommend:
\`\`\`json
{
  "patches": [
    {
      "file": "artifacts/jarvas/src/components/Example.tsx",
      "description": "What this patch does",
      "riskLevel": "low",
      "changeDescription": "Detailed explanation of the change and why it is needed"
    }
  ],
  "summary": "Overall summary of proposed changes"
}
\`\`\`

RULES:
1. Be specific — name the exact file, function, and line range if possible
2. riskLevel must be "low", "medium", or "high" — be honest
3. Never propose changes to: .env, auth files, payment files, database/migration files, package.json
4. Never propose deleting files
5. Include a testCommand if there is an obvious way to verify the patch
6. Keep each patch focused on one concern

Current task: ${ctx.taskTitle}
Task description: ${ctx.taskDescription}`;
  },
};

registerAgent(builderAgent);
export default builderAgent;
