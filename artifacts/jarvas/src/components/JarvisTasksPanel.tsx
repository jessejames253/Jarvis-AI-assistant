/**
 * components/JarvisTasksPanel.tsx — Jarvis master task list panel
 *
 * Slide-in panel (from the right) that displays the task list stored in
 * .jarvas-data/tasks/master-task-list.json via GET /api/master-tasks.
 *
 * Features:
 *   - Task title, priority badge, status badge for every task
 *   - Refresh button to re-fetch on demand
 *   - Loading and error states
 *   - Mobile-friendly: full-screen on small viewports, 380px pane on desktop
 */

import { useState, useEffect, useCallback } from "react";
import { X, RefreshCw, ListChecks, AlertCircle, Loader2 } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskPriority = "high" | "medium" | "low";
export type TaskStatus   = "pending" | "in-progress" | "done" | "cancelled";

export interface MasterTask {
  id:         string;
  title:      string;
  priority:   TaskPriority;
  status:     TaskStatus;
  createdAt?: string;
  updatedAt?: string;
}

interface JarvisTasksPanelProps {
  isOpen:  boolean;
  onClose: () => void;
  apiBase: string;
}

// ─── Style helpers ────────────────────────────────────────────────────────────

const PRIORITY_STYLES: Record<TaskPriority, { bg: string; border: string; color: string; label: string }> = {
  high:   { bg: "hsl(355 80% 60% / 0.15)", border: "hsl(355 80% 60% / 0.4)", color: "hsl(355 90% 72%)", label: "HIGH" },
  medium: { bg: "hsl(38 100% 55% / 0.15)",  border: "hsl(38 100% 55% / 0.4)", color: "hsl(38 100% 70%)",  label: "MED" },
  low:    { bg: "hsl(150 60% 45% / 0.15)",  border: "hsl(150 60% 45% / 0.4)", color: "hsl(150 70% 65%)",  label: "LOW" },
};

const STATUS_STYLES: Record<TaskStatus, { bg: string; border: string; color: string; label: string }> = {
  "pending":     { bg: "hsl(210 15% 20% / 0.6)", border: "hsl(210 15% 35% / 0.5)", color: "hsl(210 20% 65%)",  label: "PENDING" },
  "in-progress": { bg: "hsl(194 100% 45% / 0.15)", border: "hsl(194 100% 55% / 0.4)", color: "hsl(194 100% 70%)", label: "IN PROGRESS" },
  "done":        { bg: "hsl(150 60% 40% / 0.15)", border: "hsl(150 60% 45% / 0.4)", color: "hsl(150 70% 65%)",  label: "DONE" },
  "cancelled":   { bg: "hsl(355 80% 55% / 0.1)",  border: "hsl(355 80% 55% / 0.3)", color: "hsl(355 60% 60%)",  label: "CANCELLED" },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const s = PRIORITY_STYLES[priority] ?? PRIORITY_STYLES.medium;
  return (
    <span
      className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold flex-shrink-0 tracking-wider"
      style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.color }}
    >
      {s.label}
    </span>
  );
}

function StatusBadge({ status }: { status: TaskStatus }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES["pending"];
  return (
    <span
      className="text-[9px] px-1.5 py-0.5 rounded font-mono flex-shrink-0 tracking-wide"
      style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.color }}
    >
      {s.label}
    </span>
  );
}

function TaskRow({ task }: { task: MasterTask }) {
  return (
    <div
      className="flex items-start gap-2 px-3 py-2.5 rounded-lg"
      style={{ background: "hsl(220 20% 6.5%)", border: "1px solid hsl(210 15% 14%)" }}
    >
      {/* Coloured left accent based on priority */}
      <div
        className="w-0.5 self-stretch rounded-full flex-shrink-0 mt-0.5"
        style={{ background: PRIORITY_STYLES[task.priority]?.color ?? "hsl(210 15% 35%)", minHeight: "16px" }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-xs leading-snug font-medium truncate" style={{ color: "hsl(196 40% 80%)" }}>
          {task.title}
        </p>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <PriorityBadge priority={task.priority} />
          <StatusBadge   status={task.status} />
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function JarvisTasksPanel({ isOpen, onClose, apiBase }: JarvisTasksPanelProps) {
  const [tasks,      setTasks]      = useState<MasterTask[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [lastFetch,  setLastFetch]  = useState<Date | null>(null);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`${apiBase}api/master-tasks`);
      const data = await res.json() as { ok: boolean; tasks?: MasterTask[]; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Failed to load tasks");
      setTasks(data.tasks ?? []);
      setLastFetch(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  // Fetch when the panel first opens
  useEffect(() => {
    if (isOpen) fetchTasks();
  }, [isOpen, fetchTasks]);

  const byPriority = (a: MasterTask, b: MasterTask) => {
    const order: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };
    return (order[a.priority] ?? 1) - (order[b.priority] ?? 1);
  };

  const sorted = [...tasks].sort(byPriority);
  const counts = {
    pending:     tasks.filter(t => t.status === "pending").length,
    inProgress:  tasks.filter(t => t.status === "in-progress").length,
    done:        tasks.filter(t => t.status === "done").length,
  };

  return (
    <>
      {/* Backdrop — closes panel on tap (mobile) */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 sm:hidden"
          style={{ background: "hsl(220 30% 4% / 0.6)" }}
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Slide-in panel */}
      <aside
        data-testid="jarvis-tasks-panel"
        className="fixed top-0 right-0 h-full z-40 flex flex-col transition-transform duration-300 ease-in-out"
        style={{
          width: "min(100vw, 380px)",
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
          background: "hsl(222 28% 7%)",
          borderLeft: "1px solid hsl(210 15% 15%)",
          boxShadow: isOpen ? "-4px 0 32px hsl(0 0% 0% / 0.5)" : "none",
        }}
        aria-label="Jarvis task list"
      >
        {/* ── Header ── */}
        <header
          className="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b"
          style={{ borderColor: "hsl(210 15% 14%)" }}
        >
          <div className="flex items-center gap-2">
            <ListChecks className="w-4 h-4" style={{ color: "hsl(194 100% 60%)" }} />
            <h2 className="text-sm font-bold tracking-widest" style={{ color: "hsl(194 100% 75%)" }}>
              JARVIS TASKS
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {/* Refresh button */}
            <button
              type="button"
              onClick={fetchTasks}
              disabled={loading}
              title="Refresh task list"
              aria-label="Refresh tasks"
              className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all duration-150 active:scale-95 disabled:opacity-40"
              style={{
                background:   "hsl(194 100% 50% / 0.08)",
                borderColor:  "hsl(194 100% 50% / 0.3)",
              }}
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
                style={{ color: "hsl(194 100% 65%)" }}
              />
            </button>

            {/* Close */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close task panel"
              className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all duration-150 active:scale-95"
              style={{
                background:  "transparent",
                borderColor: "hsl(210 15% 28%)",
              }}
            >
              <X className="w-3.5 h-3.5" style={{ color: "hsl(210 20% 55%)" }} />
            </button>
          </div>
        </header>

        {/* ── Stats row ── */}
        {tasks.length > 0 && (
          <div
            className="flex items-center gap-4 px-4 py-2 border-b flex-shrink-0"
            style={{ borderColor: "hsl(210 15% 12%)" }}
          >
            {[
              { label: "Pending",     count: counts.pending,    color: "hsl(210 20% 58%)" },
              { label: "In Progress", count: counts.inProgress, color: "hsl(194 100% 65%)" },
              { label: "Done",        count: counts.done,       color: "hsl(150 70% 60%)" },
            ].map(({ label, count, color }) => (
              <div key={label} className="flex flex-col items-center">
                <span className="text-base font-bold font-mono leading-tight" style={{ color }}>
                  {count}
                </span>
                <span className="text-[9px] tracking-widest uppercase" style={{ color: "hsl(210 15% 40%)" }}>
                  {label}
                </span>
              </div>
            ))}
            {lastFetch && (
              <span className="ml-auto text-[9px] font-mono" style={{ color: "hsl(210 15% 35%)" }}>
                {lastFetch.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
        )}

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">

          {/* Loading skeleton */}
          {loading && tasks.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: "hsl(194 100% 55%)" }} />
              <span className="text-xs tracking-wider" style={{ color: "hsl(210 15% 45%)" }}>
                Loading tasks…
              </span>
            </div>
          )}

          {/* Error state */}
          {error && (
            <div
              className="flex items-start gap-2 p-3 rounded-lg"
              style={{ background: "hsl(355 80% 50% / 0.1)", border: "1px solid hsl(355 80% 50% / 0.3)" }}
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "hsl(355 80% 65%)" }} />
              <div>
                <p className="text-xs font-semibold" style={{ color: "hsl(355 80% 72%)" }}>Failed to load</p>
                <p className="text-[10px] mt-0.5 leading-snug" style={{ color: "hsl(355 60% 60%)" }}>{error}</p>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && tasks.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-12">
              <ListChecks className="w-7 h-7 opacity-20" style={{ color: "hsl(194 100% 60%)" }} />
              <p className="text-xs" style={{ color: "hsl(210 15% 40%)" }}>No tasks found.</p>
            </div>
          )}

          {/* Task list */}
          {sorted.map(task => (
            <TaskRow key={task.id} task={task} />
          ))}
        </div>

        {/* ── Footer ── */}
        {tasks.length > 0 && (
          <footer
            className="px-4 py-2.5 border-t flex-shrink-0"
            style={{ borderColor: "hsl(210 15% 12%)" }}
          >
            <p className="text-[10px] text-center" style={{ color: "hsl(210 15% 32%)" }}>
              {tasks.length} task{tasks.length !== 1 ? "s" : ""} · sorted by priority
            </p>
          </footer>
        )}
      </aside>
    </>
  );
}
