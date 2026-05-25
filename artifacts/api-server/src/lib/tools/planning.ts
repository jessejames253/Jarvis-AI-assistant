import type { Tool, ToolInput, ToolOutput } from "../types";

type PlanSubtype = "todo" | "project" | "breakdown" | "general";

function detectSubtype(msg: string): PlanSubtype {
  const t = msg.toLowerCase();
  if (/\b(todo|to-do|to do list|action items?|checklist)\b/.test(t)) return "todo";
  if (/\b(project|roadmap|timeline|milestone|sprint|deadline)\b/.test(t)) return "project";
  if (/\b(break(down| it down)|step by step|how (do i|should i|can i) (approach|tackle|start))\b/.test(t)) return "breakdown";
  return "general";
}

function extractGoal(msg: string): string {
  return msg
    .replace(/^(help me (plan|organize|figure out|think through|break down)|plan|i need to|i want to|how do i|how should i)/i, "")
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

export const planningTool: Tool = {
  name: "planning",
  description: "Helps with task planning, project breakdowns, and todo lists",
  handles: ["planning"],
  async execute(input: ToolInput): Promise<ToolOutput> {
    const subtype = detectSubtype(input.message);
    const goal = extractGoal(input.message);
    const reasoning: string[] = [
      "Intent: planning request",
      `Sub-type: ${subtype}`,
      goal ? `Goal extracted: "${goal.slice(0, 50)}"` : "Goal: not specified",
    ];

    let response: string;
    let action: string;

    switch (subtype) {
      case "todo":
        action = "todo_list";
        reasoning.push("Generating structured todo list format");
        response =
          `Here's a starting structure for your task list${goal ? ` on "${goal}"` : ""}:\n\n` +
          `**Phase 1 — Define**\n` +
          `☐ Clarify the goal and success criteria\n` +
          `☐ Identify constraints (time, budget, people)\n\n` +
          `**Phase 2 — Plan**\n` +
          `☐ List all required tasks\n` +
          `☐ Prioritize by impact and urgency\n` +
          `☐ Assign owners or deadlines if applicable\n\n` +
          `**Phase 3 — Execute**\n` +
          `☐ Start with the highest-priority item\n` +
          `☐ Review and adjust as you go\n\n` +
          `Want me to customize this for your specific project?`;
        break;

      case "project":
        action = "project_roadmap";
        reasoning.push("Generating project roadmap structure");
        response =
          `Here's a high-level roadmap framework${goal ? ` for "${goal}"` : ""}:\n\n` +
          `**1. Discovery (Week 1)**\n` +
          `Define scope, gather requirements, identify stakeholders\n\n` +
          `**2. Design (Week 2–3)**\n` +
          `Architecture decisions, wireframes, technical stack\n\n` +
          `**3. Build (Week 4+)**\n` +
          `Iterative development in short cycles, regular reviews\n\n` +
          `**4. Test & Launch**\n` +
          `QA, user testing, deployment, monitoring\n\n` +
          `**5. Iterate**\n` +
          `Feedback loops, improvements, scale\n\n` +
          `Tell me more about your project and I can make this much more specific.`;
        break;

      case "breakdown":
        action = "task_breakdown";
        reasoning.push("Breaking down a goal into actionable steps");
        response = goal
          ? `To break down "${goal}", let's start with the first principles:\n\n` +
            `**Step 1 — Understand the end state**\n` +
            `What does "done" look like? Write that clearly first.\n\n` +
            `**Step 2 — Identify the biggest unknowns**\n` +
            `What could block you? Address those first.\n\n` +
            `**Step 3 — Sequence the work**\n` +
            `What must happen before what? Build a dependency chain.\n\n` +
            `**Step 4 — Start small**\n` +
            `The first action should take under 30 minutes and move you forward.\n\n` +
            `Want me to apply this to your specific situation?`
          : "To give you a useful breakdown, could you describe the goal or task you're trying to accomplish? " +
            "The more specific, the more actionable I can make the steps.";
        break;

      default:
        action = "planning_assist";
        reasoning.push("General planning request — asking for specifics");
        response = goal
          ? `Happy to help plan "${goal}". ` +
            "To give you something useful: what's the timeline, and what does success look like? " +
            "That'll let me structure a concrete approach."
          : "I can help with planning. Tell me what you're trying to accomplish — " +
            "project, task list, step-by-step breakdown, or something else — and I'll structure it with you.";
    }

    return { response, action, mode: "planning_assistant", reasoning };
  },
};
