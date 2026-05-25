/**
 * agent/tools/reminders.ts — Create and list tasks/reminders
 */

import { createTask, getTasks } from "../../tasks/manager";
import type { Task } from "../../tasks/types";

export interface CreateReminderInput {
  title: string;
  due?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  category?: "work" | "personal" | "coding" | "ideas";
}

export interface ReminderResult {
  id: string;
  title: string;
  priority: string;
  category: string;
  due?: string;
  status: string;
}

export async function createReminder(
  sessionId: string,
  input: CreateReminderInput,
): Promise<ReminderResult> {
  const task = await createTask({
    sessionId,
    title: input.title,
    priority: input.priority ?? "medium",
    category: input.category ?? "personal",
    dueDate: input.due,
  });
  return {
    id: task.id,
    title: task.title,
    priority: task.priority,
    category: task.category,
    due: task.dueDate,
    status: task.status,
  };
}

export async function listReminders(
  sessionId: string,
  filter?: string,
): Promise<ReminderResult[]> {
  const tasks = await getTasks(sessionId);
  let filtered: Task[] = tasks.filter((t) => t.status !== "done");

  if (filter) {
    const q = filter.toLowerCase();
    filtered = filtered.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.priority.toLowerCase().includes(q),
    );
  }

  return filtered.slice(0, 10).map((t) => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    category: t.category,
    due: t.dueDate,
    status: t.status,
  }));
}
