/**
 * lib/tasksApi.ts — Typed API client for the Jarvas task management endpoints
 *
 * All functions return the raw response data. Use with TanStack Query for
 * caching and refetching:
 *   const { data } = useQuery({ queryKey: ["tasks", sessionId], queryFn: () => fetchTasks(sessionId) })
 */

const BASE = import.meta.env.BASE_URL;

function api(path: string) {
  return `${BASE}api/${path}`;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ─── Types (mirrors backend task types) ───────────────────────────────────────

export type TaskCategory = "work" | "personal" | "coding" | "ideas";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskStatus = "todo" | "in_progress" | "done";

export interface Task {
  id: string;
  title: string;
  description?: string;
  category: TaskCategory;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate?: string;
  projectId?: string;
  subtasks: { id: string; title: string; done: boolean }[];
  tags: string[];
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  category: TaskCategory;
  color: string;
  status: "active" | "completed" | "archived";
  sessionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface DailyGoal {
  id: string;
  title: string;
  date: string;
  done: boolean;
  sessionId: string;
  createdAt: string;
}

export interface TaskStats {
  total: number;
  completed: number;
  inProgress: number;
  overdue: number;
  completedToday: number;
  completionRate: number;
  byCategory: Record<TaskCategory, number>;
  byPriority: Record<TaskPriority, number>;
  activeProjects: number;
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export function fetchTasks(sessionId: string): Promise<Task[]> {
  return request(api(`tasks/${sessionId}`));
}

export function fetchStats(sessionId: string): Promise<TaskStats> {
  return request(api(`tasks/stats/${sessionId}`));
}

export function createTask(body: {
  sessionId: string;
  title: string;
  description?: string;
  category?: TaskCategory;
  priority?: TaskPriority;
  dueDate?: string;
  projectId?: string;
}): Promise<Task> {
  return request(api("tasks"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function updateTask(
  taskId: string,
  sessionId: string,
  updates: Partial<Pick<Task, "title" | "status" | "priority" | "category" | "dueDate" | "description">>
): Promise<Task> {
  return request(api(`tasks/${taskId}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, ...updates }),
  });
}

export function deleteTask(taskId: string, sessionId: string): Promise<{ success: boolean }> {
  return request(api(`tasks/${taskId}?sessionId=${encodeURIComponent(sessionId)}`), {
    method: "DELETE",
  });
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export function fetchProjects(sessionId: string): Promise<Project[]> {
  return request(api(`projects/${sessionId}`));
}

export function createProject(body: {
  sessionId: string;
  name: string;
  description?: string;
  category?: TaskCategory;
}): Promise<Project> {
  return request(api("projects"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function updateProject(
  projectId: string,
  sessionId: string,
  updates: { status?: string; name?: string }
): Promise<Project> {
  return request(api(`projects/${projectId}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, ...updates }),
  });
}

export function deleteProject(projectId: string, sessionId: string): Promise<{ success: boolean }> {
  return request(api(`projects/${projectId}?sessionId=${encodeURIComponent(sessionId)}`), {
    method: "DELETE",
  });
}

// ─── Daily Goals ──────────────────────────────────────────────────────────────

export function fetchGoals(sessionId: string, date?: string): Promise<DailyGoal[]> {
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  return request(api(`goals/${sessionId}${query}`));
}

export function createGoal(body: {
  sessionId: string;
  title: string;
  date: string;
}): Promise<DailyGoal> {
  return request(api("goals"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function toggleGoal(goalId: string, sessionId: string, done: boolean): Promise<DailyGoal> {
  return request(api(`goals/${goalId}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, done }),
  });
}

export function deleteGoal(goalId: string, sessionId: string): Promise<{ success: boolean }> {
  return request(api(`goals/${goalId}?sessionId=${encodeURIComponent(sessionId)}`), {
    method: "DELETE",
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export const PRIORITY_ORDER: Record<TaskPriority, number> = {
  urgent: 0, high: 1, medium: 2, low: 3,
};

export const CATEGORY_LABELS: Record<TaskCategory, string> = {
  work: "Work", personal: "Personal", coding: "Coding", ideas: "Ideas",
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  urgent: "Urgent", high: "High", medium: "Medium", low: "Low",
};
