/**
 * lib/tasks/manager.ts — CRUD and stats for the task management system
 *
 * All operations are pure functions over the TaskStore. Storage is injected
 * by the route layer. This design makes it easy to test or swap storage.
 *
 * AI INTEGRATION NOTE:
 *   - createTask / updateTask accept partial fields so an AI can fill in
 *     priorities, categories, and due dates automatically.
 *   - getStats returns the data shape an AI can use to summarise productivity.
 */

import { getOrCreateStore, writeStore } from "./storage";
import type {
  Task,
  Project,
  DailyGoal,
  TaskStats,
  TaskCategory,
  TaskPriority,
  CreateTaskBody,
  UpdateTaskBody,
  CreateProjectBody,
  CreateGoalBody,
} from "./types";

function uuid(): string {
  return crypto.randomUUID();
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export async function getTasks(sessionId: string): Promise<Task[]> {
  const store = await getOrCreateStore(sessionId);
  return store.tasks;
}

export async function createTask(body: CreateTaskBody): Promise<Task> {
  const store = await getOrCreateStore(body.sessionId);
  const now = new Date().toISOString();
  const task: Task = {
    id: uuid(),
    title: body.title,
    description: body.description,
    category: body.category ?? "personal",
    priority: body.priority ?? "medium",
    status: "todo",
    dueDate: body.dueDate,
    projectId: body.projectId,
    subtasks: [],
    tags: body.tags ?? [],
    sessionId: body.sessionId,
    createdAt: now,
    updatedAt: now,
  };
  store.tasks.push(task);
  await writeStore(store);
  return task;
}

export async function updateTask(
  sessionId: string,
  taskId: string,
  updates: UpdateTaskBody
): Promise<Task | null> {
  const store = await getOrCreateStore(sessionId);
  const idx = store.tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return null;

  const task = store.tasks[idx];
  const wasComplete = task.status === "done";
  const nowComplete = updates.status === "done";

  store.tasks[idx] = {
    ...task,
    ...updates,
    updatedAt: new Date().toISOString(),
    completedAt: !wasComplete && nowComplete ? new Date().toISOString() : task.completedAt,
  };

  await writeStore(store);
  return store.tasks[idx];
}

export async function deleteTask(sessionId: string, taskId: string): Promise<boolean> {
  const store = await getOrCreateStore(sessionId);
  const before = store.tasks.length;
  store.tasks = store.tasks.filter((t) => t.id !== taskId);
  if (store.tasks.length === before) return false;
  await writeStore(store);
  return true;
}

// ─── Projects ─────────────────────────────────────────────────────────────────

const PROJECT_COLORS = [
  "hsl(194 100% 55%)",  // cyan
  "hsl(264 80% 70%)",   // purple
  "hsl(142 71% 55%)",   // green
  "hsl(38 100% 60%)",   // amber
  "hsl(355 80% 60%)",   // red
  "hsl(220 80% 65%)",   // blue
];

export async function getProjects(sessionId: string): Promise<Project[]> {
  const store = await getOrCreateStore(sessionId);
  return store.projects;
}

export async function createProject(body: CreateProjectBody): Promise<Project> {
  const store = await getOrCreateStore(body.sessionId);
  const now = new Date().toISOString();
  const color = body.color ?? PROJECT_COLORS[store.projects.length % PROJECT_COLORS.length];
  const project: Project = {
    id: uuid(),
    name: body.name,
    description: body.description,
    category: body.category ?? "work",
    color,
    status: "active",
    sessionId: body.sessionId,
    createdAt: now,
    updatedAt: now,
  };
  store.projects.push(project);
  await writeStore(store);
  return project;
}

export async function updateProject(
  sessionId: string,
  projectId: string,
  updates: Partial<Pick<Project, "name" | "description" | "status" | "category" | "color">>
): Promise<Project | null> {
  const store = await getOrCreateStore(sessionId);
  const idx = store.projects.findIndex((p) => p.id === projectId);
  if (idx === -1) return null;
  store.projects[idx] = { ...store.projects[idx], ...updates, updatedAt: new Date().toISOString() };
  await writeStore(store);
  return store.projects[idx];
}

export async function deleteProject(sessionId: string, projectId: string): Promise<boolean> {
  const store = await getOrCreateStore(sessionId);
  const before = store.projects.length;
  store.projects = store.projects.filter((p) => p.id !== projectId);
  if (store.projects.length === before) return false;
  await writeStore(store);
  return true;
}

// ─── Daily Goals ──────────────────────────────────────────────────────────────

export async function getGoals(sessionId: string, date?: string): Promise<DailyGoal[]> {
  const store = await getOrCreateStore(sessionId);
  const target = date ?? todayStr();
  return store.goals.filter((g) => g.date === target);
}

export async function createGoal(body: CreateGoalBody): Promise<DailyGoal> {
  const store = await getOrCreateStore(body.sessionId);
  const goal: DailyGoal = {
    id: uuid(),
    title: body.title,
    date: body.date,
    done: false,
    sessionId: body.sessionId,
    createdAt: new Date().toISOString(),
  };
  store.goals.push(goal);
  await writeStore(store);
  return goal;
}

export async function updateGoal(
  sessionId: string,
  goalId: string,
  done: boolean
): Promise<DailyGoal | null> {
  const store = await getOrCreateStore(sessionId);
  const idx = store.goals.findIndex((g) => g.id === goalId);
  if (idx === -1) return null;
  store.goals[idx] = { ...store.goals[idx], done };
  await writeStore(store);
  return store.goals[idx];
}

export async function deleteGoal(sessionId: string, goalId: string): Promise<boolean> {
  const store = await getOrCreateStore(sessionId);
  const before = store.goals.length;
  store.goals = store.goals.filter((g) => g.id !== goalId);
  if (store.goals.length === before) return false;
  await writeStore(store);
  return true;
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export async function getStats(sessionId: string): Promise<TaskStats> {
  const store = await getOrCreateStore(sessionId);
  const tasks = store.tasks;
  const today = todayStr();

  const completed = tasks.filter((t) => t.status === "done").length;
  const inProgress = tasks.filter((t) => t.status === "in_progress").length;
  const overdue = tasks.filter(
    (t) => t.status !== "done" && t.dueDate && t.dueDate < today
  ).length;
  const completedToday = tasks.filter(
    (t) => t.status === "done" && t.completedAt?.startsWith(today)
  ).length;

  const byCategory: Record<TaskCategory, number> = {
    work: 0, personal: 0, coding: 0, ideas: 0,
  };
  const byPriority: Record<TaskPriority, number> = {
    low: 0, medium: 0, high: 0, urgent: 0,
  };

  for (const t of tasks) {
    if (t.status !== "done") {
      byCategory[t.category]++;
      byPriority[t.priority]++;
    }
  }

  const activeProjects = store.projects.filter((p) => p.status === "active").length;
  const completionRate = tasks.length === 0 ? 0 : Math.round((completed / tasks.length) * 100);

  return {
    total: tasks.length,
    completed,
    inProgress,
    overdue,
    completedToday,
    completionRate,
    byCategory,
    byPriority,
    activeProjects,
  };
}

// ─── Helpers for the chat tool ─────────────────────────────────────────────────

/** Returns the top-N pending tasks sorted by priority then due date */
export async function getTopPendingTasks(sessionId: string, limit = 5): Promise<Task[]> {
  const store = await getOrCreateStore(sessionId);
  const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

  return store.tasks
    .filter((t) => t.status !== "done")
    .sort((a, b) => {
      const pd = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (pd !== 0) return pd;
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return 0;
    })
    .slice(0, limit);
}
