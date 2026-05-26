/**
 * agents/testerAgent.ts — TesterAgent definition.
 *
 * Role: Runs validation/typecheck commands, analyses failures, and can
 *       trigger AutoFix analysis on the failed output.
 * Permissions: READ_FILES, READ_CONTEXT, TEST_RUNNER, AUTOFIX_TRIGGER, TASK_UPDATE
 * Execution mode: test (may run allowlisted commands — no file writes except safe auto-fix)
 *
 * TesterAgent does NOT write files. The only write side-effect is the
 * AutoFix engine applying "safe" auto-fixes (unused imports, etc.),
 * which always goes through the guarded pipeline (snapshot → validate → rollback if fail).
 *
 * Output contract:
 * {
 *   "validationSuggested": true,
 *   "project": "jarvas" | "api-server",
 *   "testCommand": "pnpm --filter @workspace/jarvas run typecheck",
 *   "findings": ["..."],
 *   "summary": "..."
 * }
 */

import { registerAgent }        from "../lib/agents/registry";
import { PERMISSIONS }          from "../lib/agents/permissions";
import type { AgentDefinition } from "../lib/agents/baseAgent";

const testerAgent: AgentDefinition = {
  id:            "tester",
  name:          "TesterAgent",
  role:          "Validator — runs type checks and analyses failures",
  description:
    "Runs allowlisted validation commands (typecheck, lint, build), " +
    "analyses failures, and can trigger AutoFix analysis on the failed output. " +
    "Does not write files directly — the only writes are through the " +
    "AutoFix safe-apply pipeline (always checkpointed and validated).",
  capabilities: [
    "Run TypeScript typecheck on jarvas or api-server",
    "Analyse TSC error output and classify issues",
    "Trigger AutoFix engine analysis on validation failures",
    "Identify root causes of build/runtime errors",
    "Recommend specific fixes for TypeScript errors",
  ],
  permissions: [
    PERMISSIONS.READ_FILES,
    PERMISSIONS.READ_CONTEXT,
    PERMISSIONS.TEST_RUNNER,
    PERMISSIONS.AUTOFIX_TRIGGER,
    PERMISSIONS.TASK_UPDATE,
  ],
  riskLimit:     "safe",
  executionMode: "test",

  systemPromptBuilder(ctx) {
    return `You are TesterAgent, the validation specialist for the Jarvis Self-Improving Dev System.

Your role is to analyse the current validation state and recommend specific test/fix actions.

PERMISSIONS: You may read files and run allowlisted validation commands. You CANNOT write files directly or interact with git.

PROJECT STATE:
- Health score: ${ctx.projectHealthScore ?? "unknown"}/100
- Last validation: ${ctx.lastValidationPassed == null ? "unknown" : ctx.lastValidationPassed ? "passed ✓" : "failed ✗"}
- AutoFix summary: ${ctx.autoFixSummary ?? "none"}

VALIDATION TARGETS:
- jarvas     (React frontend): pnpm --filter @workspace/jarvas run typecheck
- api-server (Express backend): pnpm --filter @workspace/api-server run typecheck

OUTPUT FORMAT: Reply with a JSON block:
\`\`\`json
{
  "validationSuggested": true,
  "project": "jarvas",
  "testCommand": "pnpm --filter @workspace/jarvas run typecheck",
  "findings": [
    "Describe what you found or expect to find",
    "List specific TS error patterns to look for"
  ],
  "autoFixCandidate": true,
  "summary": "What should be tested and why"
}
\`\`\`

RULES:
1. Always recommend the most targeted test command first
2. If the last validation failed, analyse the AutoFix summary and suggest next steps
3. autoFixCandidate: true only for unused-import or invalid-css-style errors (safe auto-fix patterns)
4. Never suggest commands outside the allowlist (pnpm run typecheck/check/lint/build/test)
5. Be specific about which files or patterns the errors are in

Current task: ${ctx.taskTitle}
Task description: ${ctx.taskDescription}`;
  },
};

registerAgent(testerAgent);
export default testerAgent;
