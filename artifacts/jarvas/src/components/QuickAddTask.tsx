import { useState } from "react";
import { X, Plus } from "lucide-react";
import type { TaskCategory, TaskPriority } from "@/lib/tasksApi";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (data: {
    title: string;
    category: TaskCategory;
    priority: TaskPriority;
    dueDate?: string;
    description?: string;
  }) => Promise<void>;
  projects?: { id: string; name: string }[];
}

const CATEGORIES: { value: TaskCategory; label: string }[] = [
  { value: "personal", label: "Personal" },
  { value: "work",     label: "Work" },
  { value: "coding",   label: "Coding" },
  { value: "ideas",    label: "Ideas" },
];

const PRIORITIES: { value: TaskPriority; label: string; color: string }[] = [
  { value: "low",    label: "Low",    color: "hsl(142 71% 55%)" },
  { value: "medium", label: "Medium", color: "hsl(48 100% 55%)" },
  { value: "high",   label: "High",   color: "hsl(38 100% 60%)" },
  { value: "urgent", label: "Urgent", color: "hsl(355 80% 60%)" },
];

export default function QuickAddTask({ isOpen, onClose, onAdd }: Props) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<TaskCategory>("personal");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!isOpen) return null;

  const reset = () => {
    setTitle(""); setCategory("personal"); setPriority("medium");
    setDueDate(""); setDescription(""); setError("");
  };

  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError("Title is required"); return; }
    setLoading(true);
    setError("");
    try {
      await onAdd({ title: title.trim(), category, priority, dueDate: dueDate || undefined, description: description.trim() || undefined });
      reset();
      onClose();
    } catch {
      setError("Failed to add task. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const selectClass = "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60 transition-colors";
  const selectStyle = { borderColor: "hsl(210 15% 22%)", color: "hsl(196 80% 85%)" };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Panel */}
      <div
        className="relative z-10 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border p-6 shadow-2xl"
        style={{ background: "hsl(220 20% 8%)", borderColor: "hsl(194 100% 55% / 0.3)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4" style={{ color: "hsl(194 100% 60%)" }} />
            <h2 className="font-display font-bold tracking-widest text-sm" style={{ color: "hsl(194 100% 60%)" }}>
              ADD TASK
            </h2>
          </div>
          <button onClick={handleClose} className="rounded-lg p-1 hover:bg-white/5 transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Title */}
          <div>
            <input
              autoFocus
              type="text"
              placeholder="What needs to be done?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary/60 transition-colors placeholder:text-muted-foreground"
              style={{ borderColor: "hsl(210 15% 22%)", color: "hsl(196 80% 85%)" }}
            />
          </div>

          {/* Description */}
          <div>
            <textarea
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60 transition-colors placeholder:text-muted-foreground resize-none"
              style={{ borderColor: "hsl(210 15% 22%)", color: "hsl(196 80% 85%)" }}
            />
          </div>

          {/* Category + Priority row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs tracking-wider text-muted-foreground">CATEGORY</label>
              <select value={category} onChange={(e) => setCategory(e.target.value as TaskCategory)} className={selectClass} style={selectStyle}>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs tracking-wider text-muted-foreground">PRIORITY</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className={selectClass} style={selectStyle}>
                {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>

          {/* Due date */}
          <div>
            <label className="mb-1 block text-xs tracking-wider text-muted-foreground">DUE DATE (optional)</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={selectClass}
              style={selectStyle}
            />
          </div>

          {error && (
            <p className="text-xs" style={{ color: "hsl(355 80% 65%)" }}>{error}</p>
          )}

          {/* Priority pills for quick select */}
          <div className="flex gap-2">
            {PRIORITIES.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPriority(p.value)}
                className="flex-1 rounded-lg border py-1.5 text-xs font-medium transition-all duration-150"
                style={{
                  borderColor: priority === p.value ? p.color : "hsl(210 15% 22%)",
                  background: priority === p.value ? `${p.color}20` : "transparent",
                  color: priority === p.value ? p.color : "hsl(196 40% 45%)",
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !title.trim()}
            className="w-full rounded-xl py-2.5 text-sm font-semibold tracking-wider transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed glow-primary"
            style={{ background: "hsl(194 100% 55%)", color: "hsl(220 20% 6%)" }}
          >
            {loading ? "ADDING..." : "ADD TASK"}
          </button>
        </form>
      </div>
    </div>
  );
}
