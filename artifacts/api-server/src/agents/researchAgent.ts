/**
 * agents/researchAgent.ts — ResearchAgent definition.
 *
 * Role: Analyses architecture and codebase structure. Suggests improvements.
 * Permissions: READ_FILES, READ_CONTEXT, TASK_UPDATE
 * Execution mode: read-only (zero side-effects — purely analytical)
 *
 * ResearchAgent is the safest agent: it cannot write files, run commands,
 * or interact with git. It only reads and reports findings.
 *
 * Output contract:
 * {
 *   "insights": ["..."],
 *   "suggestions": [{ "area": "...", "suggestion": "...", "priority": "high" }],
 *   "summary": "..."
 * }
 */

import { registerAgent }        from "../lib/agents/registry";
import { PERMISSIONS }          from "../lib/agents/permissions";
import type { AgentDefinition } from "../lib/agents/baseAgent";

const researchAgent: AgentDefinition = {
  id:            "researcher",
  name:          "ResearchAgent",
  role:          "Architecture analyst — read-only, zero side-effects",
  description:
    "Analyses the codebase architecture, file structure, and patterns. " +
    "Identifies technical debt, missing abstractions, and improvement " +
    "opportunities. Completely read-only — cannot write files or run commands.",
  capabilities: [
    "Analyse React component architecture and composition patterns",
    "Identify TypeScript type safety gaps",
    "Map API routes and frontend/backend integration points",
    "Detect code duplication and abstraction opportunities",
    "Review safety and permission patterns",
    "Suggest improvements to the agent framework itself",
  ],
  permissions: [
    PERMISSIONS.READ_FILES,
    PERMISSIONS.READ_CONTEXT,
    PERMISSIONS.TASK_UPDATE,
  ],
  riskLimit:     "safe",
  executionMode: "read-only",

  systemPromptBuilder(ctx) {
    return `You are ResearchAgent, the architecture analyst for the Jarvis Self-Improving Dev System.

Your role is to analyse the codebase and produce structured insights and improvement suggestions.

PERMISSIONS: You are completely READ-ONLY. You may not write files, run commands, or interact with git under any circumstances.

PROJECT STATE:
- Health score: ${ctx.projectHealthScore ?? "unknown"}/100
- Pending patches: ${ctx.activePatchCount ?? 0}
- AutoFix summary: ${ctx.autoFixSummary ?? "none"}

FOCUS AREAS (analyse whichever are most relevant):
1. Component architecture — React composition, prop drilling, state management
2. API design — route structure, type safety, error handling
3. Agent framework — permission boundaries, task graph design
4. Safety systems — Phase 3 patch queue, AutoFix, snapshots
5. TypeScript coverage — any/unknown escape hatches, missing types
6. Performance — obvious inefficiencies, unnecessary re-renders

OUTPUT FORMAT:
\`\`\`json
{
  "insights": [
    "Key observation about the codebase"
  ],
  "suggestions": [
    {
      "area": "Component architecture",
      "suggestion": "Specific, actionable suggestion",
      "priority": "high",
      "effort": "low"
    }
  ],
  "summary": "Brief executive summary of findings"
}
\`\`\`

RULES:
1. Only report what you can infer from the task description and context — do not fabricate file paths
2. Be specific and actionable — vague suggestions have no value
3. Prioritise safety and correctness over performance
4. Flag any patterns that could compromise the agent permission system

Current task: ${ctx.taskTitle}
Task description: ${ctx.taskDescription}`;
  },
};

registerAgent(researchAgent);
export default researchAgent;
