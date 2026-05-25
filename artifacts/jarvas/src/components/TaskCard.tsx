import { Check, Trash2, Circle, Clock, Loader } from "lucide-react";
import type { Task, TaskPriority, TaskCategory } from "@/lib/tasksApi";

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  urgent: "hsl(355 80% 60%)",
  high:   "hsl(38 100% 60%)",
  medium: "hsl(48 100% 55%)",
  low:    "hsl(142 71% 55%)",
};

const CATEGORY_COLORS: Record<TaskCategory, string> = {
  work:     "hsl(194 100% 55%)",
  personal: "hsl(264 80% 70%)",
  coding:   "hsl(142 71% 55%)",
  ideas:    "hsl(38 100% 60%)",
};

const CATEGORY_LABELS: Record<TaskCategory, string> = {
  work: "Work", personal: "Personal", coding: "Coding", ideas: "Ideas",
};

const STATUS_ICONS = {
  todo:        <Circle className="w-4 h-4" />,
  in_progress: <Loader className="w-4 h-4" />,
  done:        <Check className="w-4 h-4" />,
};

function isOverdue(task: Task): boolean {
  if (!task.dueDate || task.status === "done") return false;
  return task.dueDate < new Date().toISOString().slice(0, 10);
}

interface Props {
  task: Task;
  onStatusChange: (taskId: string, status: Task["status"]) => void;
  onDelete: (taskId: string) => void;
  compact?: boolean;
}

export default function TaskCard({ task, onStatusChange, onDelete, compact }: Props) {
  const priorityColor = PRIORITY_COLORS[task.priority];
  const categoryColor = CATEGORY_COLORS[task.category];
  const overdue = isOverdue(task);
  const done = task.status === "done";

  const nextStatus = (current: Task["status"]): Task["status"] =>
    current === "todo" ? "in_progress" : current === "in_progress" ? "done" : "todo";

  return (
    <div
      className="group relative flex items-start gap-3 rounded-xl border bg-card px-4 py-3 transition-all duration-200 hover:border-white/10"
      style={{
        borderColor: done ? "hsl(210 15% 20%)" : "hsl(210 15% 22%)",
        opacity: done ? 0.6 : 1,
        borderLeftWidth: "3px",
        borderLeftColor: priorityColor,
      }}
    >
      {/* Status toggle */}
      <button
        onClick={() => onStatusChange(task.id, nextStatus(task.status))}
        className="mt-0.5 flex-shrink-0 rounded-full transition-all duration-200 hover:scale-110"
        style={{ color: done ? "hsl(142 71% 55%)" : priorityColor }}
        title={`Status: ${task.status}`}
      >
        {STATUS_ICONS[task.status]}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p
          className="text-sm font-medium leading-snug"
          style={{
            color: done ? "hsl(196 20% 45%)" : "hsl(196 80% 85%)",
            textDecoration: done ? "line-through" : "none",
          }}
        >
          {task.title}
        </p>

        {!compact && task.description && (
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground line-clamp-1">
            {task.description}
          </p>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {/* Category */}
          <span
            className="rounded px-1.5 py-0.5 text-xs font-medium"
            style={{ color: categoryColor, background: `${categoryColor}18` }}
          >
            {CATEGORY_LABELS[task.category]}
          </span>

          {/* Priority */}
          <span
            className="rounded px-1.5 py-0.5 text-xs font-medium capitalize"
            style={{ color: priorityColor, background: `${priorityColor}18` }}
          >
            {task.priority}
          </span>

          {/* Due date */}
          {task.dueDate && (
            <span
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs"
              style={{
                color: overdue ? "hsl(355 80% 65%)" : "hsl(196 40% 55%)",
                background: overdue ? "hsl(355 80% 60% / 0.12)" : "transparent",
              }}
            >
              <Clock className="w-3 h-3" />
              {overdue ? "Overdue · " : ""}{task.dueDate}
            </span>
          )}
        </div>
      </div>

      {/* Delete (appears on hover) */}
      <button
        onClick={() => onDelete(task.id)}
        className="flex-shrink-0 rounded p-1 opacity-0 transition-all duration-200 group-hover:opacity-100 hover:bg-red-500/10"
        style={{ color: "hsl(355 80% 60%)" }}
        title="Delete task"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
