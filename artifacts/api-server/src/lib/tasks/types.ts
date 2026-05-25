/**
 * lib/tasks/types.ts — Data models for the Jarvas task management system
 *
 * All types are designed to be AI-ready:
 *   - Tasks can be created/classified by an AI
 *   - Priorities and categories can be AI-suggested
 *   - Subtask breakdowns can be AI-generated
 */

export type TaskCategory = "work" | "personal" | "coding" | "ideas";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskStatus = "todo" | "in_progress" | "done";
export type ProjectStatus = "active" | "completed" | "archived";

export interface SubTask {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  category: TaskCategory;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate?: string;        // ISO date string YYYY-MM-DD
  projectId?: string;
  subtasks: SubTask[];
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
  color: string;           // CSS color token for the UI badge
  status: ProjectStatus;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface DailyGoal {
  id: string;
  title: string;
  date: string;            // YYYY-MM-DD
  done: boolean;
  sessionId: string;
  createdAt: string;
}

/** The full on-disk store for one session */
export interface TaskStore {
  sessionId: string;
  tasks: Task[];
  projects: Project[];
  goals: DailyGoal[];
  updatedAt: string;
}

/** Computed productivity stats returned by /api/tasks/stats */
export interface TaskStats {
  total: number;
  completed: number;
  inProgress: number;
  overdue: number;
  completedToday: number;
  completionRate: number;   // 0–100
  byCategory: Record<TaskCategory, number>;
  byPriority: Record<TaskPriority, number>;
  activeProjects: number;
}

/** Shape of create-task request body */
export interface CreateTaskBody {
  sessionId: string;
  title: string;
  description?: string;
  category?: TaskCategory;
  priority?: TaskPriority;
  dueDate?: string;
  projectId?: string;
  tags?: string[];
}

/** Shape of update-task request body */
export interface UpdateTaskBody {
  sessionId: string;
  title?: string;
  description?: string;
  category?: TaskCategory;
  priority?: TaskPriority;
  status?: TaskStatus;
  dueDate?: string;
  projectId?: string;
  tags?: string[];
}

/** Shape of create-project request body */
export interface CreateProjectBody {
  sessionId: string;
  name: string;
  description?: string;
  category?: TaskCategory;
  color?: string;
}

/** Shape of create-goal request body */
export interface CreateGoalBody {
  sessionId: string;
  title: string;
  date: string;
}
