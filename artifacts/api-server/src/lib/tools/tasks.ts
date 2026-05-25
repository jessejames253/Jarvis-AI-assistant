/**
 * lib/tools/tasks.ts — Task-management agent tool
 *
 * Handles task_management intent from the router.
 * Understands natural language commands:
 *   "add task X"              → create task
 *   "what tasks do I have"    → list open tasks
 *   "mark X done"             → complete task by fuzzy match
 *   "what should I work on"   → suggest top-priority task
 *   "break down X into steps" → generate subtask suggestions
 *
 * AI INTEGRATION NOTE:
 *   Replace the rule-based responses below with real AI completions.
 *   The manager functions already provide structured data; the AI just
 *   needs to narrate it in natural language.
 */

import type { Tool, ToolInput, ToolOutput } from "../types";
import {
  getTasks,
  createTask,
  updateTask,
  getTopPendingTasks,
  getStats,
} from "../tasks/manager";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function priorityEmoji(p: string): string {
  return { urgent: "🔴", high: "🟠", medium: "🟡", low: "🟢" }[p] ?? "⚪";
}

function categoryLabel(c: string): string {
  return { work: "Work", personal: "Personal", coding: "Coding", ideas: "Ideas" }[c] ?? c;
}

/** Very simple fuzzy match: does every word in the needle appear in the haystack? */
function fuzzyMatch(needle: string, haystack: string): boolean {
  const words = needle.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const h = haystack.toLowerCase();
  return words.length > 0 && words.every((w) => h.includes(w));
}

// ─── Sub-handlers ─────────────────────────────────────────────────────────────

async function handleList(sessionId: string): Promise<ToolOutput> {
  const tasks = await getTasks(sessionId);
  const open = tasks.filter((t) => t.status !== "done");

  if (open.length === 0) {
    return {
      response: "You have no open tasks right now. Want me to add one?",
      action: "task_list_empty",
      mode: "task_manager",
      reasoning: ["No open tasks found in session store"],
    };
  }

  const lines = open
    .slice(0, 10)
    .map((t) => `${priorityEmoji(t.priority)} **${t.title}** [${categoryLabel(t.category)}]${t.dueDate ? ` — due ${t.dueDate}` : ""}`);

  const suffix = open.length > 10 ? `\n…and ${open.length - 10} more. Check the dashboard for the full list.` : "";

  return {
    response: `You have **${open.length} open task${open.length !== 1 ? "s" : ""}**:\n\n${lines.join("\n")}${suffix}`,
    action: "task_list",
    mode: "task_manager",
    reasoning: [`Found ${open.length} open tasks`, "Formatted by priority"],
  };
}

async function handleCreate(msg: string, sessionId: string): Promise<ToolOutput> {
  // Extract title: strip "add task", "create task", "new task", "remind me to"
  const stripped = msg
    .replace(/^(add|create|new|make)\s+(a\s+)?(task|todo|reminder|item)\s*(to\s+|for\s+)?/i, "")
    .replace(/^remind\s+me\s+to\s+/i, "")
    .trim();

  const title = stripped.slice(0, 120) || "New task";

  // Detect category from keywords
  const lower = msg.toLowerCase();
  const category =
    lower.includes("work") || lower.includes("meeting") || lower.includes("client") ? "work"
    : lower.includes("code") || lower.includes("bug") || lower.includes("feature") || lower.includes("implement") ? "coding"
    : lower.includes("idea") || lower.includes("explore") || lower.includes("try") ? "ideas"
    : "personal";

  // Detect priority
  const priority =
    lower.includes("urgent") || lower.includes("asap") || lower.includes("immediately") ? "urgent"
    : lower.includes("high priority") || lower.includes("important") ? "high"
    : lower.includes("low priority") || lower.includes("sometime") ? "low"
    : "medium";

  const task = await createTask({ sessionId, title, category, priority });

  return {
    response: `Task added: **${task.title}**\n${priorityEmoji(task.priority)} ${task.priority} priority · ${categoryLabel(task.category)}`,
    action: "task_create",
    mode: "task_manager",
    reasoning: [
      `Extracted title: "${task.title}"`,
      `Detected category: ${category}`,
      `Detected priority: ${priority}`,
    ],
  };
}

async function handleComplete(msg: string, sessionId: string): Promise<ToolOutput> {
  const tasks = await getTasks(sessionId);
  const open = tasks.filter((t) => t.status !== "done");

  // Strip "mark done", "complete", "finish", "done with"
  const needle = msg
    .replace(/^(mark|complete|finish|done\s+with|completed?)\s+/i, "")
    .replace(/\s+as\s+(done|complete|finished)$/i, "")
    .trim();

  const match = open.find((t) => fuzzyMatch(needle, t.title));
  if (!match) {
    const titles = open.slice(0, 5).map((t) => `• ${t.title}`).join("\n");
    return {
      response: `I couldn't find a task matching "${needle}". Your open tasks:\n${titles}`,
      action: "task_complete_not_found",
      mode: "task_manager",
      reasoning: [`Fuzzy match failed for: "${needle}"`],
    };
  }

  await updateTask(sessionId, match.id, { sessionId, status: "done" });

  return {
    response: `Done! Marked **${match.title}** as complete.`,
    action: "task_complete",
    mode: "task_manager",
    reasoning: [`Fuzzy matched "${needle}" → "${match.title}"`, "Updated status to done"],
  };
}

async function handleSuggest(sessionId: string): Promise<ToolOutput> {
  const top = await getTopPendingTasks(sessionId, 3);

  if (top.length === 0) {
    return {
      response: "You have no pending tasks. Great work! Want to add something for today?",
      action: "task_suggest_empty",
      mode: "task_manager",
      reasoning: ["No pending tasks"],
    };
  }

  const [first, ...rest] = top;
  const lines = rest.map((t) => `  ${priorityEmoji(t.priority)} ${t.title}`).join("\n");

  return {
    response: `I'd focus on **${first.title}** first ${priorityEmoji(first.priority)} — it's your highest-priority open task.\n\nAlso queued up:\n${lines || "  (nothing else pending)"}`,
    action: "task_suggest",
    mode: "task_manager",
    reasoning: [
      `Top priority: ${first.title} (${first.priority})`,
      `${rest.length} other tasks queued`,
    ],
  };
}

async function handleBreakdown(msg: string): Promise<ToolOutput> {
  const topic = msg
    .replace(/^(break\s+down|split|divide|decompose)\s+(my\s+)?(goal|task|project)?\s*/i, "")
    .replace(/\s+into\s+(steps|tasks|subtasks|pieces)?/i, "")
    .trim() || "your goal";

  return {
    response: `Here's how I'd break down **${topic}** into steps:\n\n1. Define what "done" looks like — write a clear success criterion\n2. Identify blockers or dependencies before starting\n3. Split into the smallest units that can be completed in one sitting\n4. Assign a priority to each unit\n5. Schedule the first step for today\n\n💡 Once you've decided on the steps, I can add them as individual tasks for you — just say "add task <step>".`,
    action: "task_breakdown",
    mode: "task_manager",
    reasoning: [
      `Detected breakdown request for: "${topic}"`,
      "Generated structured step guidance",
    ],
  };
}

async function handleStats(sessionId: string): Promise<ToolOutput> {
  const stats = await getStats(sessionId);

  return {
    response: `Here's your productivity snapshot:\n\n📊 **${stats.total} total tasks** · ${stats.completed} completed · ${stats.inProgress} in progress\n✅ **Completion rate:** ${stats.completionRate}%\n🏁 **Completed today:** ${stats.completedToday}\n${stats.overdue > 0 ? `⚠️ **Overdue:** ${stats.overdue}\n` : ""}📁 **Active projects:** ${stats.activeProjects}\n\nOpen the dashboard for the full breakdown.`,
    action: "task_stats",
    mode: "task_manager",
    reasoning: ["Fetched live stats from task store"],
  };
}

// ─── Main execute ─────────────────────────────────────────────────────────────

export const tasksTool: Tool = {
  name: "tasks",
  description: "Creates, lists, updates, and tracks tasks, projects, and daily goals",
  handles: ["task_management"],

  async execute(input: ToolInput): Promise<ToolOutput> {
    const msg = input.message.toLowerCase();
    const sessionId = (input.memoryContext as Record<string, string> & { sessionId?: string })?.sessionId ?? "default";

    // Route by sub-intent
    if (/\b(add|create|new|make|remind)\b/.test(msg) && /\b(task|todo|reminder|item)\b/.test(msg)) {
      return handleCreate(input.message, sessionId);
    }
    if (/\b(mark|complete|finish|done\s+with|completed?)\b/.test(msg)) {
      return handleComplete(input.message, sessionId);
    }
    if (/\b(what|show|list|see|view)\b.*\b(task|todo|work|doing)\b/.test(msg)) {
      return handleList(sessionId);
    }
    if (/\bwhat\s+should\s+i\s+(work|do|focus|start)\b/.test(msg)) {
      return handleSuggest(sessionId);
    }
    if (/\b(break\s+down|split|decompose|subtask)\b/.test(msg)) {
      return handleBreakdown(input.message);
    }
    if (/\b(stat|progress|how.*(doing|going)|productivity|overview)\b/.test(msg)) {
      return handleStats(sessionId);
    }

    // Default: list open tasks as a helpful starting point
    return handleList(sessionId);
  },
};
