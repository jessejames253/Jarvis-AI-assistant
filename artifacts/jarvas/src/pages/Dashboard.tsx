/**
 * pages/Dashboard.tsx — Jarvis productivity & task management dashboard
 *
 * Sections:
 *   - Stats bar (total, completed today, rate, overdue)
 *   - Daily goals (today's intentions with checkbox toggle)
 *   - Projects (active + create new)
 *   - Task list (filterable by category / priority / status)
 *   - Completed history (collapsible)
 */

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  MessageSquare, Plus, ChevronDown, ChevronUp, Trash2,
  CheckCircle2, Circle, Target, FolderKanban, ListTodo,
  TrendingUp, AlertTriangle, Flame, Trophy,
} from "lucide-react";
import TaskCard from "@/components/TaskCard";
import QuickAddTask from "@/components/QuickAddTask";
import {
  fetchTasks, fetchStats, fetchProjects, fetchGoals,
  createTask, updateTask, deleteTask,
  createProject, deleteProject, updateProject,
  createGoal, toggleGoal, deleteGoal,
  todayIso,
  type Task, type TaskCategory, type TaskPriority, type TaskStatus,
} from "@/lib/tasksApi";

// ─── Session ──────────────────────────────────────────────────────────────────

const SESSION_KEY = "jarvas_session_id";
function getSessionId(): string {
  return localStorage.getItem(SESSION_KEY) ?? "default";
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_OPTIONS: { value: TaskCategory | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "work", label: "Work" },
  { value: "personal", label: "Personal" },
  { value: "coding", label: "Coding" },
  { value: "ideas", label: "Ideas" },
];

const PRIORITY_OPTIONS: { value: TaskPriority | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const STATUS_OPTIONS: { value: TaskStatus | "all"; label: string }[] = [
  { value: "all", label: "All Open" },
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
];

const PROJECT_COLOR_OPTIONS = [
  "hsl(194 100% 55%)", "hsl(264 80% 70%)", "hsl(142 71% 55%)",
  "hsl(38 100% 60%)", "hsl(355 80% 60%)", "hsl(220 80% 65%)",
];

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, accent }: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div
      className="rounded-xl border p-3 sm:p-4"
      style={{ background: "hsl(220 20% 7%)", borderColor: "hsl(210 15% 20%)" }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span style={{ color: accent ?? "hsl(194 100% 60%)" }}>{icon}</span>
        <span className="text-xs tracking-wider text-muted-foreground">{label}</span>
      </div>
      <p className="text-2xl font-bold font-display" style={{ color: accent ?? "hsl(194 100% 70%)" }}>
        {value}
      </p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Filter Pill ──────────────────────────────────────────────────────────────

function FilterPill({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-full px-3 py-1 text-xs font-medium transition-all duration-150"
      style={{
        background: active ? "hsl(194 100% 55% / 0.15)" : "transparent",
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: active ? "hsl(194 100% 55% / 0.5)" : "hsl(210 15% 22%)",
        color: active ? "hsl(194 100% 65%)" : "hsl(196 30% 45%)",
      }}
    >
      {children}
    </button>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const sessionId = getSessionId();
  const today = todayIso();

  // ── Filters
  const [categoryFilter, setCategoryFilter] = useState<TaskCategory | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | "all">("all");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all");
  const [showCompleted, setShowCompleted] = useState(false);

  // ── UI
  const [showAddTask, setShowAddTask] = useState(false);
  const [showAddProject, setShowAddProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectColor, setNewProjectColor] = useState(PROJECT_COLOR_OPTIONS[0]);
  const [newGoalTitle, setNewGoalTitle] = useState("");

  // ── Queries
  const tasks = useQuery({ queryKey: ["tasks", sessionId], queryFn: () => fetchTasks(sessionId) });
  const stats = useQuery({ queryKey: ["stats", sessionId], queryFn: () => fetchStats(sessionId) });
  const projects = useQuery({ queryKey: ["projects", sessionId], queryFn: () => fetchProjects(sessionId) });
  const goals = useQuery({ queryKey: ["goals", sessionId, today], queryFn: () => fetchGoals(sessionId, today) });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["tasks", sessionId] });
    qc.invalidateQueries({ queryKey: ["stats", sessionId] });
  }, [qc, sessionId]);

  // ── Task mutations
  const addTask = useMutation({
    mutationFn: (data: Parameters<typeof createTask>[0]) => createTask(data),
    onSuccess: invalidate,
  });

  const patchTask = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Parameters<typeof updateTask>[2] }) =>
      updateTask(id, sessionId, updates),
    onSuccess: invalidate,
  });

  const removeTask = useMutation({
    mutationFn: (id: string) => deleteTask(id, sessionId),
    onSuccess: invalidate,
  });

  // ── Project mutations
  const addProject = useMutation({
    mutationFn: (data: Parameters<typeof createProject>[0]) => createProject(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects", sessionId] }),
  });

  const removeProject = useMutation({
    mutationFn: (id: string) => deleteProject(id, sessionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects", sessionId] }),
  });

  const archiveProject = useMutation({
    mutationFn: (id: string) => updateProject(id, sessionId, { status: "archived" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects", sessionId] }),
  });

  // ── Goal mutations
  const addGoal = useMutation({
    mutationFn: (title: string) => createGoal({ sessionId, title, date: today }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals", sessionId, today] }),
  });

  const toggleGoalMutation = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => toggleGoal(id, sessionId, done),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals", sessionId, today] }),
  });

  const removeGoal = useMutation({
    mutationFn: (id: string) => deleteGoal(id, sessionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals", sessionId, today] }),
  });

  // ── Computed filtered tasks
  const allTasks = tasks.data ?? [];
  const openTasks = allTasks
    .filter((t) => t.status !== "done")
    .filter((t) => categoryFilter === "all" || t.category === categoryFilter)
    .filter((t) => priorityFilter === "all" || t.priority === priorityFilter)
    .filter((t) => statusFilter === "all" || t.status === statusFilter)
    .sort((a, b) => {
      const pr: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
      return pr[a.priority] - pr[b.priority];
    });

  const doneTasks = allTasks
    .filter((t) => t.status === "done")
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));

  const s = stats.data;
  const goalsList = goals.data ?? [];
  const projectList = (projects.data ?? []).filter((p) => p.status === "active");

  const handleStatusChange = (id: string, status: Task["status"]) => {
    patchTask.mutate({ id, updates: { status } });
  };

  const handleAddTask = async (data: {
    title: string; category: TaskCategory; priority: TaskPriority;
    dueDate?: string; description?: string;
  }) => {
    await addTask.mutateAsync({ sessionId, ...data });
  };

  const handleAddProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    await addProject.mutateAsync({
      sessionId, name: newProjectName.trim(), color: newProjectColor,
    });
    setNewProjectName("");
    setShowAddProject(false);
  };

  const handleAddGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGoalTitle.trim()) return;
    await addGoal.mutateAsync(newGoalTitle.trim());
    setNewGoalTitle("");
  };

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-screen w-full bg-background scan-overlay">
      <div className="fixed inset-0 bg-grid opacity-40 pointer-events-none" />

      {/* ── Header ── */}
      <header className="sticky top-0 z-20 flex-shrink-0 flex items-center justify-between px-4 sm:px-8 py-3 sm:py-4 border-b border-border/60 bg-background/90 backdrop-blur-sm pt-safe">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-xs font-medium tracking-wider transition-colors hover:text-primary"
            style={{ color: "hsl(196 40% 45%)" }}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            CHAT
          </button>
          <span style={{ color: "hsl(210 15% 25%)" }}>·</span>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/40 flex items-center justify-center">
              <span className="font-display text-primary font-black text-sm">J</span>
            </div>
            <h1 className="font-display font-bold text-lg tracking-widest" style={{ color: "hsl(194 100% 60%)" }}>
              DASHBOARD
            </h1>
          </div>
        </div>

        <button
          onClick={() => setShowAddTask(true)}
          className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold tracking-wider transition-all duration-200 hover:opacity-80 glow-primary"
          style={{ background: "hsl(194 100% 55%)", color: "hsl(220 20% 6%)" }}
        >
          <Plus className="w-3.5 h-3.5" />
          ADD TASK
        </button>
      </header>

      <div className="relative z-10 flex-1 px-4 sm:px-8 py-6 max-w-6xl mx-auto w-full">

        {/* ── Stats bar ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <StatCard
            icon={<ListTodo className="w-4 h-4" />}
            label="OPEN TASKS"
            value={s ? s.total - s.completed : "—"}
            sub={s ? `${s.total} total` : undefined}
          />
          <StatCard
            icon={<Trophy className="w-4 h-4" />}
            label="DONE TODAY"
            value={s?.completedToday ?? "—"}
            sub="completed today"
            accent="hsl(142 71% 55%)"
          />
          <StatCard
            icon={<TrendingUp className="w-4 h-4" />}
            label="COMPLETION"
            value={s ? `${s.completionRate}%` : "—"}
            sub={s ? `${s.completed} of ${s.total}` : undefined}
            accent="hsl(264 80% 70%)"
          />
          <StatCard
            icon={<AlertTriangle className="w-4 h-4" />}
            label="OVERDUE"
            value={s?.overdue ?? "—"}
            sub="past due date"
            accent={s && s.overdue > 0 ? "hsl(355 80% 60%)" : "hsl(196 40% 45%)"}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── Left column: Goals + Projects ── */}
          <div className="lg:col-span-1 flex flex-col gap-6">

            {/* Daily Goals */}
            <section
              className="rounded-2xl border p-5"
              style={{ background: "hsl(220 20% 7%)", borderColor: "hsl(210 15% 20%)" }}
            >
              <div className="flex items-center gap-2 mb-4">
                <Target className="w-4 h-4" style={{ color: "hsl(194 100% 60%)" }} />
                <h2 className="font-display font-bold text-sm tracking-widest" style={{ color: "hsl(194 100% 60%)" }}>
                  TODAY'S GOALS
                </h2>
                <span className="ml-auto text-xs text-muted-foreground">{today}</span>
              </div>

              {/* Goal list */}
              <div className="flex flex-col gap-2 mb-4">
                {goalsList.length === 0 && (
                  <p className="text-xs text-muted-foreground py-2">No goals set for today. Add one below.</p>
                )}
                {goalsList.map((g) => (
                  <div key={g.id} className="group flex items-center gap-2.5">
                    <button
                      onClick={() => toggleGoalMutation.mutate({ id: g.id, done: !g.done })}
                      className="flex-shrink-0 transition-all duration-200 hover:scale-110"
                      style={{ color: g.done ? "hsl(142 71% 55%)" : "hsl(196 40% 45%)" }}
                    >
                      {g.done
                        ? <CheckCircle2 className="w-4 h-4" />
                        : <Circle className="w-4 h-4" />}
                    </button>
                    <span
                      className="flex-1 text-sm"
                      style={{
                        color: g.done ? "hsl(196 20% 40%)" : "hsl(196 80% 85%)",
                        textDecoration: g.done ? "line-through" : "none",
                      }}
                    >
                      {g.title}
                    </span>
                    <button
                      onClick={() => removeGoal.mutate(g.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ color: "hsl(355 80% 55%)" }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Add goal form */}
              <form onSubmit={handleAddGoal} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Add a goal..."
                  value={newGoalTitle}
                  onChange={(e) => setNewGoalTitle(e.target.value)}
                  className="flex-1 rounded-lg border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary/60 transition-colors placeholder:text-muted-foreground"
                  style={{ borderColor: "hsl(210 15% 22%)", color: "hsl(196 80% 85%)" }}
                />
                <button
                  type="submit"
                  disabled={!newGoalTitle.trim() || addGoal.isPending}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-40"
                  style={{ background: "hsl(194 100% 55% / 0.15)", color: "hsl(194 100% 60%)", border: "1px solid hsl(194 100% 55% / 0.3)" }}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </form>

              {/* Goal progress */}
              {goalsList.length > 0 && (
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>Progress</span>
                    <span>{goalsList.filter((g) => g.done).length}/{goalsList.length}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.round((goalsList.filter((g) => g.done).length / goalsList.length) * 100)}%`,
                        background: "hsl(194 100% 55%)",
                      }}
                    />
                  </div>
                </div>
              )}
            </section>

            {/* Projects */}
            <section
              className="rounded-2xl border p-5"
              style={{ background: "hsl(220 20% 7%)", borderColor: "hsl(210 15% 20%)" }}
            >
              <div className="flex items-center gap-2 mb-4">
                <FolderKanban className="w-4 h-4" style={{ color: "hsl(264 80% 70%)" }} />
                <h2 className="font-display font-bold text-sm tracking-widest" style={{ color: "hsl(264 80% 70%)" }}>
                  PROJECTS
                </h2>
                <button
                  onClick={() => setShowAddProject((v) => !v)}
                  className="ml-auto rounded p-1 transition-colors hover:bg-white/5"
                  style={{ color: "hsl(264 80% 70%)" }}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Add project form */}
              {showAddProject && (
                <form onSubmit={handleAddProject} className="mb-4 flex flex-col gap-2">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Project name..."
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    className="rounded-lg border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary/60 transition-colors placeholder:text-muted-foreground"
                    style={{ borderColor: "hsl(210 15% 22%)", color: "hsl(196 80% 85%)" }}
                  />
                  <div className="flex gap-1.5 items-center">
                    {PROJECT_COLOR_OPTIONS.map((c) => (
                      <button
                        key={c} type="button"
                        onClick={() => setNewProjectColor(c)}
                        className="w-5 h-5 rounded-full transition-all duration-150"
                        style={{
                          background: c,
                          outline: newProjectColor === c ? `2px solid ${c}` : "none",
                          outlineOffset: "2px",
                        }}
                      />
                    ))}
                    <button
                      type="submit"
                      disabled={!newProjectName.trim()}
                      className="ml-auto rounded-lg px-3 py-1 text-xs font-semibold disabled:opacity-40"
                      style={{ background: "hsl(264 80% 70% / 0.15)", color: "hsl(264 80% 70%)" }}
                    >
                      Create
                    </button>
                  </div>
                </form>
              )}

              {/* Project list */}
              {projectList.length === 0 && !showAddProject && (
                <p className="text-xs text-muted-foreground">No active projects. Click + to create one.</p>
              )}
              <div className="flex flex-col gap-2">
                {projectList.map((p) => {
                  const taskCount = allTasks.filter((t) => t.projectId === p.id && t.status !== "done").length;
                  return (
                    <div key={p.id} className="group flex items-center gap-3 rounded-xl border p-3"
                      style={{ borderColor: "hsl(210 15% 20%)", background: "hsl(220 20% 6%)" }}>
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: "hsl(196 80% 85%)" }}>{p.name}</p>
                        <p className="text-xs text-muted-foreground">{taskCount} open task{taskCount !== 1 ? "s" : ""}</p>
                      </div>
                      <button
                        onClick={() => archiveProject.mutate(p.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ color: "hsl(196 40% 45%)" }}
                        title="Archive project"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Category breakdown */}
            {s && s.total > 0 && (
              <section
                className="rounded-2xl border p-5"
                style={{ background: "hsl(220 20% 7%)", borderColor: "hsl(210 15% 20%)" }}
              >
                <div className="flex items-center gap-2 mb-4">
                  <Flame className="w-4 h-4" style={{ color: "hsl(38 100% 60%)" }} />
                  <h2 className="font-display font-bold text-sm tracking-widest" style={{ color: "hsl(38 100% 60%)" }}>
                    BY CATEGORY
                  </h2>
                </div>
                {(["work", "personal", "coding", "ideas"] as TaskCategory[]).map((cat) => {
                  const count = s.byCategory[cat];
                  const total = Object.values(s.byCategory).reduce((a, b) => a + b, 0);
                  if (count === 0) return null;
                  return (
                    <div key={cat} className="mb-2">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="capitalize text-muted-foreground">{cat}</span>
                        <span style={{ color: "hsl(196 80% 75%)" }}>{count}</span>
                      </div>
                      <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: total === 0 ? "0%" : `${Math.round((count / total) * 100)}%`,
                            background: cat === "work" ? "hsl(194 100% 55%)" : cat === "personal" ? "hsl(264 80% 70%)" : cat === "coding" ? "hsl(142 71% 55%)" : "hsl(38 100% 60%)",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </section>
            )}
          </div>

          {/* ── Right column: Tasks ── */}
          <div className="lg:col-span-2 flex flex-col gap-6">

            {/* Task list */}
            <section
              className="rounded-2xl border p-5"
              style={{ background: "hsl(220 20% 7%)", borderColor: "hsl(210 15% 20%)" }}
            >
              <div className="flex items-center gap-2 mb-4">
                <ListTodo className="w-4 h-4" style={{ color: "hsl(194 100% 60%)" }} />
                <h2 className="font-display font-bold text-sm tracking-widest" style={{ color: "hsl(194 100% 60%)" }}>
                  TASKS
                </h2>
                <span
                  className="ml-1 rounded-full px-2 py-0.5 text-xs"
                  style={{ background: "hsl(194 100% 55% / 0.12)", color: "hsl(194 100% 65%)" }}
                >
                  {openTasks.length}
                </span>
                <button
                  onClick={() => setShowAddTask(true)}
                  className="ml-auto flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors hover:bg-white/5"
                  style={{ color: "hsl(194 100% 60%)" }}
                >
                  <Plus className="w-3.5 h-3.5" /> Add
                </button>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap gap-1.5 mb-4">
                <div className="flex gap-1 flex-wrap">
                  {CATEGORY_OPTIONS.map((o) => (
                    <FilterPill key={o.value} active={categoryFilter === o.value} onClick={() => setCategoryFilter(o.value as TaskCategory | "all")}>
                      {o.label}
                    </FilterPill>
                  ))}
                </div>
                <span className="text-muted-foreground text-xs self-center px-1">·</span>
                <div className="flex gap-1 flex-wrap">
                  {STATUS_OPTIONS.map((o) => (
                    <FilterPill key={o.value} active={statusFilter === o.value} onClick={() => setStatusFilter(o.value as TaskStatus | "all")}>
                      {o.label}
                    </FilterPill>
                  ))}
                </div>
                <span className="text-muted-foreground text-xs self-center px-1">·</span>
                <div className="flex gap-1 flex-wrap">
                  {PRIORITY_OPTIONS.map((o) => (
                    <FilterPill key={o.value} active={priorityFilter === o.value} onClick={() => setPriorityFilter(o.value as TaskPriority | "all")}>
                      {o.label}
                    </FilterPill>
                  ))}
                </div>
              </div>

              {/* Task list */}
              {tasks.isLoading && (
                <p className="text-xs text-muted-foreground py-4 text-center">Loading tasks…</p>
              )}
              {!tasks.isLoading && openTasks.length === 0 && (
                <div className="py-8 text-center">
                  <p className="text-xs text-muted-foreground mb-3">No tasks match the current filters.</p>
                  <button
                    onClick={() => setShowAddTask(true)}
                    className="text-xs font-medium underline"
                    style={{ color: "hsl(194 100% 60%)" }}
                  >
                    Add your first task
                  </button>
                </div>
              )}
              <div className="flex flex-col gap-2">
                {openTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onStatusChange={handleStatusChange}
                    onDelete={(id) => removeTask.mutate(id)}
                  />
                ))}
              </div>
            </section>

            {/* Completed history */}
            {doneTasks.length > 0 && (
              <section
                className="rounded-2xl border p-5"
                style={{ background: "hsl(220 20% 7%)", borderColor: "hsl(210 15% 20%)" }}
              >
                <button
                  className="flex w-full items-center gap-2 mb-1"
                  onClick={() => setShowCompleted((v) => !v)}
                >
                  <CheckCircle2 className="w-4 h-4" style={{ color: "hsl(142 71% 55%)" }} />
                  <h2 className="font-display font-bold text-sm tracking-widest" style={{ color: "hsl(142 71% 55%)" }}>
                    COMPLETED
                  </h2>
                  <span
                    className="rounded-full px-2 py-0.5 text-xs"
                    style={{ background: "hsl(142 71% 55% / 0.12)", color: "hsl(142 71% 65%)" }}
                  >
                    {doneTasks.length}
                  </span>
                  <span className="ml-auto text-muted-foreground">
                    {showCompleted ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </span>
                </button>

                {showCompleted && (
                  <div className="flex flex-col gap-2 mt-4">
                    {doneTasks.slice(0, 20).map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        onStatusChange={handleStatusChange}
                        onDelete={(id) => removeTask.mutate(id)}
                        compact
                      />
                    ))}
                    {doneTasks.length > 20 && (
                      <p className="text-xs text-center text-muted-foreground py-2">
                        + {doneTasks.length - 20} more completed tasks
                      </p>
                    )}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      </div>

      {/* Quick add modal */}
      <QuickAddTask
        isOpen={showAddTask}
        onClose={() => setShowAddTask(false)}
        onAdd={handleAddTask}
        projects={projectList}
      />
    </div>
  );
}
