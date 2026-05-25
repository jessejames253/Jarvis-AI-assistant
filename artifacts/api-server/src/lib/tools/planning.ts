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

    let response: string;
    let action: string;

    switch (subtype) {
      case "todo":
        action = "todo_list";
        response =
          `Here's a clean starting structure${goal ? ` for "${goal}"` : ""}:\n\n` +
          `**Define**\n` +
          `☐ Clarify the goal and what "done" looks like\n` +
          `☐ Identify constraints — time, people, budget\n\n` +
          `**Plan**\n` +
          `☐ List all required tasks\n` +
          `☐ Prioritise by impact and urgency\n\n` +
          `**Execute**\n` +
          `☐ Start with the highest-leverage item\n` +
          `☐ Review and adjust weekly\n\n` +
          `Share more about your project and I can make this specific to your situation.`;
        break;

      case "project":
        action = "project_roadmap";
        response =
          `Roadmap framework${goal ? ` for "${goal}"` : ""}:\n\n` +
          `**1. Discovery** — Define scope, requirements, stakeholders\n` +
          `**2. Design** — Architecture, wireframes, technical decisions\n` +
          `**3. Build** — Iterative development, short cycles\n` +
          `**4. Test & Launch** — QA, deployment, monitoring\n` +
          `**5. Iterate** — Feedback loops, improvements\n\n` +
          `What's the project? I can make this far more specific.`;
        break;

      case "breakdown":
        action = "task_breakdown";
        response = goal
          ? `Breaking down "${goal}":\n\n` +
            `**1. Define the end state** — What does done look like? Write it in one sentence.\n\n` +
            `**2. Find the blockers** — What could stop you? Address those first.\n\n` +
            `**3. Sequence the work** — What depends on what? Build the dependency chain.\n\n` +
            `**4. First action** — Something you can complete in under 30 minutes that moves the needle.\n\n` +
            `Want me to apply this to your specific situation?`
          : "What are you trying to accomplish? Give me the goal and I'll break it into concrete steps.";
        break;

      default:
        action = "planning_assist";
        response = goal
          ? `Happy to help plan "${goal}". What's the timeline and what does success look like?`
          : "What are you planning? Give me the goal — project, list, or breakdown — and I'll structure it with you.";
    }

    return {
      response,
      action,
      mode: "planning_assistant",
      reasoning: [`subtype: ${subtype}`, goal ? `goal: "${goal.slice(0, 50)}"` : "goal: not specified"],
    };
  },
};
