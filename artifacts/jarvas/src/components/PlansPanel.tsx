/**
 * components/PlansPanel.tsx — Planner Brain v1
 *
 * Features:
 *   - Create a new plan (title + goal → Claude generates structured plan)
 *   - Browse existing plans with status badges
 *   - Expand a plan to view phases, tasks, risks, recommended next action
 *   - Convert plan tasks to master task list (one-click)
 */

import { useState, useEffect, useCallback } from "react";
import {
  X, RefreshCw, Layers, Plus, ChevronDown, ChevronRight,
  Loader2, AlertTriangle, CheckCircle2, XCircle, Clock,
  ArrowRight, ListChecks, ShieldAlert, Zap, Inbox,
  RotateCcw, CheckCheck, Archive,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type PlanStatus   = "draft" | "approved" | "converting" | "converted" | "archived";
type Priority     = "low" | "medium" | "high";
type Effort       = "small" | "medium" | "large";
type RiskSeverity = "low" | "medium" | "high";
type TaskStatus   = "pending" | "converted";

interface PlanTask {
  id:              string;
  title:           string;
  phaseId:         string;
  priority:        Priority;
  estimatedEffort: Effort;
  dependsOn:       string[];
  status:          TaskStatus;
}

interface PlanPhase {
  id:    string;
  title: string;
  order: number;
  tasks: PlanTask[];
}

interface PlanRisk {
  id:          string;
  description: string;
  severity:    RiskSeverity;
  mitigation:  string;
}

interface Plan {
  id:                    string;
  title:                 string;
  goal:                  string;
  createdAt:             string;
  updatedAt:             string;
  status:                PlanStatus;
  phases:                PlanPhase[];
  tasks:                 PlanTask[];
  risks:                 PlanRisk[];
  recommendedNextAction: string;
}

interface PlansPanelProps {
  isOpen:  boolean;
  onClose: () => void;
  apiBase: string;
}

// ─── Constants & style helpers ────────────────────────────────────────────────

const PURPLE   = "hsl(264 80% 68%)";
const AMBER    = "hsl(38 100% 60%)";
const GREEN    = "hsl(150 70% 60%)";
const RED      = "hsl(355 80% 65%)";
const BLUE     = "hsl(196 80% 60%)";
const MUTED    = "hsl(210 15% 38%)";

const STATUS_STYLE: Record<PlanStatus, { label: string; color: string }> = {
  draft:      { label: "DRAFT",      color: MUTED       },
  approved:   { label: "APPROVED",   color: GREEN        },
  converting: { label: "CONVERTING", color: AMBER        },
  converted:  { label: "CONVERTED",  color: BLUE         },
  archived:   { label: "ARCHIVED",   color: "hsl(210 15% 28%)" },
};

const PRIORITY_COLOR: Record<Priority, string> = {
  high:   RED,
  medium: AMBER,
  low:    GREEN,
};

const EFFORT_LABEL: Record<Effort, string> = {
  small:  "≤2h",
  medium: "≤1d",
  large:  ">1d",
};

const RISK_COLOR: Record<RiskSeverity, string> = {
  high:   RED,
  medium: AMBER,
  low:    GREEN,
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full"
      style={{ background: `${color}18`, border: `1px solid ${color}40`, color }}>
      {label}
    </span>
  );
}

function TaskRow({ task }: { task: PlanTask }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b last:border-0"
      style={{ borderColor: "hsl(210 15% 10%)" }}>
      {task.status === "converted"
        ? <CheckCheck className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: GREEN }} />
        : <Clock      className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: MUTED }} />}
      <div className="flex-1 min-w-0">
        <p className="text-[11px] leading-snug" style={{ color: task.status === "converted" ? MUTED : "hsl(196 30% 78%)" }}>
          {task.title}
        </p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <Badge label={task.priority.toUpperCase()} color={PRIORITY_COLOR[task.priority]} />
          <span className="text-[9px] font-mono" style={{ color: MUTED }}>{EFFORT_LABEL[task.estimatedEffort]}</span>
        </div>
      </div>
    </div>
  );
}

function PhaseBlock({ phase }: { phase: PlanPhase }) {
  const [open, setOpen] = useState(true);
  const done = phase.tasks.filter(t => t.status === "converted").length;
  return (
    <div className="mb-2">
      <button type="button" className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-lg"
        style={{ background: "hsl(220 20% 7.5%)" }}
        onClick={() => setOpen(v => !v)}>
        {open ? <ChevronDown className="w-3 h-3" style={{ color: PURPLE }} />
               : <ChevronRight className="w-3 h-3" style={{ color: PURPLE }} />}
        <span className="text-[11px] font-semibold flex-1" style={{ color: PURPLE }}>
          Phase {phase.order}: {phase.title}
        </span>
        <span className="text-[9px] font-mono" style={{ color: MUTED }}>
          {done}/{phase.tasks.length}
        </span>
      </button>
      {open && (
        <div className="mt-1 px-2">
          {phase.tasks.map(t => <TaskRow key={t.id} task={t} />)}
        </div>
      )}
    </div>
  );
}

function RiskRow({ risk }: { risk: PlanRisk }) {
  const [open, setOpen] = useState(false);
  const color = RISK_COLOR[risk.severity];
  return (
    <div className="mb-1">
      <button type="button" className="flex items-start gap-2 w-full text-left py-1.5"
        onClick={() => setOpen(v => !v)}>
        <ShieldAlert className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color }} />
        <span className="text-[11px] flex-1 text-left leading-snug" style={{ color: "hsl(196 25% 68%)" }}>
          {risk.description}
        </span>
        <Badge label={risk.severity.toUpperCase()} color={color} />
      </button>
      {open && (
        <div className="ml-5 mb-1 text-[10px] px-2 py-1 rounded-lg"
          style={{ background: `${color}0d`, color: "hsl(196 20% 55%)" }}>
          Mitigation: {risk.mitigation}
        </div>
      )}
    </div>
  );
}

// ─── Plan card (collapsed + expanded) ────────────────────────────────────────

function PlanCard({
  plan, apiBase, onRefresh,
}: { plan: Plan; apiBase: string; onRefresh: () => void }) {
  const [open,       setOpen]       = useState(false);
  const [converting, setConverting] = useState(false);
  const [convResult, setConvResult] = useState<{ converted: number; skipped: number } | null>(null);
  const [error,      setError]      = useState<string | null>(null);

  const pending   = plan.tasks.filter(t => t.status === "pending").length;
  const converted = plan.tasks.filter(t => t.status === "converted").length;
  const st = STATUS_STYLE[plan.status];

  const doConvert = useCallback(async () => {
    setConverting(true); setError(null); setConvResult(null);
    try {
      const res  = await fetch(`${apiBase}api/plans/${plan.id}/convert-to-tasks`, { method: "POST" });
      const data = await res.json() as { ok: boolean; converted?: number; skipped?: number; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Conversion failed");
      setConvResult({ converted: data.converted ?? 0, skipped: data.skipped ?? 0 });
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setConverting(false);
    }
  }, [plan.id, apiBase, onRefresh]);

  return (
    <div className="rounded-xl mb-2 overflow-hidden"
      style={{ border: open ? `1px solid ${PURPLE}35` : "1px solid hsl(210 15% 14%)", background: "hsl(220 20% 6%)" }}>
      {/* Header row */}
      <button type="button" className="flex items-start gap-2 w-full text-left px-3 py-2.5"
        onClick={() => setOpen(v => !v)}>
        {open
          ? <ChevronDown  className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: PURPLE }} />
          : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: MUTED  }} />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[12px] font-semibold leading-snug" style={{ color: "hsl(196 35% 82%)" }}>
              {plan.title}
            </p>
            <Badge label={st.label} color={st.color} />
          </div>
          <p className="text-[9px] font-mono mt-0.5" style={{ color: MUTED }}>
            {fmtDate(plan.createdAt)} · {plan.phases.length} phases · {plan.tasks.length} tasks
          </p>
        </div>
      </button>

      {/* Expanded body */}
      {open && (
        <div className="border-t px-3 pb-3 pt-2 space-y-3" style={{ borderColor: "hsl(210 15% 12%)" }}>
          {/* Goal */}
          <div>
            <p className="text-[9px] font-mono tracking-widest mb-1" style={{ color: MUTED }}>GOAL</p>
            <p className="text-[11px] leading-relaxed" style={{ color: "hsl(196 20% 60%)" }}>{plan.goal}</p>
          </div>

          {/* Recommended next action */}
          <div className="flex items-start gap-2 px-2.5 py-2 rounded-xl"
            style={{ background: `${GREEN}0d`, border: `1px solid ${GREEN}25` }}>
            <Zap className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: GREEN }} />
            <div>
              <p className="text-[9px] font-mono tracking-widest mb-0.5" style={{ color: `${GREEN}80` }}>
                RECOMMENDED NEXT ACTION
              </p>
              <p className="text-[11px]" style={{ color: GREEN }}>{plan.recommendedNextAction}</p>
            </div>
          </div>

          {/* Phases + tasks */}
          <div>
            <p className="text-[9px] font-mono tracking-widest mb-1.5" style={{ color: MUTED }}>
              PHASES &amp; TASKS
            </p>
            {plan.phases
              .sort((a, b) => a.order - b.order)
              .map(ph => <PhaseBlock key={ph.id} phase={ph} />)}
          </div>

          {/* Risks */}
          {plan.risks.length > 0 && (
            <div>
              <p className="text-[9px] font-mono tracking-widest mb-1" style={{ color: MUTED }}>
                RISKS ({plan.risks.length})
              </p>
              {plan.risks.map(r => <RiskRow key={r.id} risk={r} />)}
            </div>
          )}

          {/* Conversion status bar */}
          {plan.tasks.length > 0 && (
            <div className="text-[9px] font-mono flex items-center gap-2" style={{ color: MUTED }}>
              <CheckCircle2 className="w-3 h-3" style={{ color: GREEN }} />
              {converted}/{plan.tasks.length} tasks converted
              {pending > 0 && <span style={{ color: AMBER }}>· {pending} pending</span>}
            </div>
          )}

          {/* Convert button */}
          {convResult && (
            <p className="text-[10px] font-mono" style={{ color: GREEN }}>
              ✓ {convResult.converted} task{convResult.converted !== 1 ? "s" : ""} added to task list
              {convResult.skipped > 0 && ` · ${convResult.skipped} already converted`}
            </p>
          )}
          {error && (
            <p className="text-[10px]" style={{ color: RED }}>{error}</p>
          )}

          {pending > 0 && plan.status !== "archived" && (
            <button type="button" onClick={doConvert} disabled={converting}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-[11px] font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40"
              style={{ background: `${PURPLE}14`, border: `1px solid ${PURPLE}40`, color: PURPLE }}>
              {converting
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> CONVERTING…</>
                : <><ListChecks className="w-3.5 h-3.5" /> CONVERT {pending} TASK{pending !== 1 ? "S" : ""} TO LIST</>}
            </button>
          )}

          {plan.status !== "archived" && (
            <button type="button"
              onClick={async () => {
                await fetch(`${apiBase}api/plans/${plan.id}/status`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ status: "archived" }),
                });
                onRefresh();
              }}
              className="w-full flex items-center justify-center gap-1.5 py-1 rounded-lg text-[9px] font-mono transition-all active:scale-95"
              style={{ color: MUTED, border: "1px solid hsl(210 15% 18%)" }}>
              <Archive className="w-3 h-3" /> Archive plan
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Create plan form ─────────────────────────────────────────────────────────

function CreatePlanForm({
  apiBase, onCreated, onCancel,
}: { apiBase: string; onCreated: () => void; onCancel: () => void }) {
  const [title,    setTitle]    = useState("");
  const [goal,     setGoal]     = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (!title.trim() || !goal.trim()) {
      setError("Both title and goal are required.");
      return;
    }
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`${apiBase}api/plans`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ title: title.trim(), goal: goal.trim() }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Failed to create plan");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [title, goal, apiBase, onCreated]);

  const inputStyle = {
    background:   "hsl(220 20% 5.5%)",
    border:       "1px solid hsl(210 15% 20%)",
    borderRadius: "0.75rem",
    color:        "hsl(196 30% 78%)",
    outline:      "none",
    padding:      "0.5rem 0.75rem",
    fontSize:     "0.75rem",
    width:        "100%",
    resize:       "vertical" as const,
  };

  return (
    <div className="rounded-xl p-3 mb-3"
      style={{ background: `${PURPLE}0a`, border: `1px solid ${PURPLE}30` }}>
      <p className="text-[11px] font-bold mb-3" style={{ color: PURPLE }}>NEW PLAN</p>

      <div className="space-y-2">
        <div>
          <label className="text-[9px] font-mono tracking-widest block mb-1" style={{ color: MUTED }}>
            PLAN TITLE
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Jarvis v2 launch"
            style={inputStyle}
            disabled={loading}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && submit()}
          />
        </div>

        <div>
          <label className="text-[9px] font-mono tracking-widest block mb-1" style={{ color: MUTED }}>
            GOAL (describe what you want to achieve)
          </label>
          <textarea
            value={goal}
            onChange={e => setGoal(e.target.value)}
            placeholder="Build a complete voice-enabled AI assistant web app with agent orchestration, auto-execution of safe tasks, and a cyberpunk dark UI..."
            rows={5}
            style={inputStyle}
            disabled={loading}
          />
        </div>

        {error && (
          <p className="text-[10px]" style={{ color: RED }}>{error}</p>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-[10px]" style={{ color: PURPLE }}>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Claude is generating your plan… (this takes ~10s)
          </div>
        )}

        <div className="flex gap-2">
          <button type="button" onClick={submit} disabled={loading}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40"
            style={{ background: `${PURPLE}18`, border: `1px solid ${PURPLE}50`, color: PURPLE }}>
            {loading
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> GENERATING…</>
              : <><Zap className="w-3.5 h-3.5" /> GENERATE PLAN</>}
          </button>
          <button type="button" onClick={onCancel} disabled={loading}
            className="px-3 py-2 rounded-xl text-[11px] transition-all active:scale-95 disabled:opacity-40"
            style={{ border: "1px solid hsl(210 15% 22%)", color: MUTED }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function PlansPanel({ isOpen, onClose, apiBase }: PlansPanelProps) {
  const [plans,      setPlans]      = useState<Plan[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [creating,   setCreating]   = useState(false);
  const [showArchive, setShowArchive] = useState(false);

  const fetchPlans = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`${apiBase}api/plans`);
      const data = await res.json() as { ok: boolean; plans?: Plan[]; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Failed to load plans");
      setPlans(data.plans ?? []);
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : "Network error");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    if (isOpen) fetchPlans();
  }, [isOpen, fetchPlans]);

  const visible = showArchive ? plans : plans.filter(p => p.status !== "archived");
  const archived = plans.filter(p => p.status === "archived").length;

  const stats = {
    total:    plans.length,
    draft:    plans.filter(p => p.status === "draft").length,
    approved: plans.filter(p => p.status === "approved").length,
    converted:plans.filter(p => p.status === "converted").length,
  };

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-30 sm:hidden"
          style={{ background: "hsl(220 30% 4% / 0.6)" }}
          onClick={onClose} aria-hidden="true" />
      )}

      <aside
        data-testid="plans-panel"
        className="fixed top-0 right-0 h-full z-40 flex flex-col transition-transform duration-300 ease-in-out"
        style={{
          width:      "min(100vw, 480px)",
          transform:  isOpen ? "translateX(0)" : "translateX(100%)",
          background: "hsl(222 28% 7%)",
          borderLeft: "1px solid hsl(210 15% 15%)",
          boxShadow:  isOpen ? "-4px 0 32px hsl(0 0% 0% / 0.5)" : "none",
        }}
        aria-label="Plans panel"
      >
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b"
          style={{ borderColor: "hsl(210 15% 14%)" }}>
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4" style={{ color: PURPLE }} />
            <h2 className="text-sm font-bold tracking-widest" style={{ color: PURPLE }}>PLANS</h2>
            <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full"
              style={{ background: `${PURPLE}18`, border: `1px solid ${PURPLE}40`, color: PURPLE }}>
              {stats.total}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => fetchPlans()} disabled={loading}
              title="Refresh" aria-label="Refresh plans"
              className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95 disabled:opacity-40"
              style={{ background: "hsl(210 15% 12%)", borderColor: "hsl(210 15% 22%)" }}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
                style={{ color: "hsl(210 20% 55%)" }} />
            </button>
            <button type="button" onClick={onClose} aria-label="Close plans panel"
              className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95"
              style={{ background: "transparent", borderColor: "hsl(210 15% 28%)" }}>
              <X className="w-3.5 h-3.5" style={{ color: "hsl(210 20% 55%)" }} />
            </button>
          </div>
        </header>

        {/* Error */}
        {error && (
          <div className="mx-3 mt-2 flex items-start gap-2 p-2.5 rounded-lg flex-shrink-0"
            style={{ background: "hsl(355 80% 50% / 0.1)", border: "1px solid hsl(355 80% 50% / 0.3)" }}>
            <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: RED }} />
            <p className="text-[10px]" style={{ color: "hsl(355 80% 72%)" }}>{error}</p>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {/* Stats row */}
          {stats.total > 0 && (
            <div className="grid grid-cols-4 gap-1.5 mb-3">
              {[
                { label: "TOTAL",     value: stats.total,     color: PURPLE },
                { label: "DRAFT",     value: stats.draft,     color: MUTED  },
                { label: "APPROVED",  value: stats.approved,  color: GREEN  },
                { label: "CONVERTED", value: stats.converted, color: BLUE   },
              ].map(s => (
                <div key={s.label} className="rounded-xl p-2 text-center"
                  style={{ background: `${s.color}10`, border: `1px solid ${s.color}25` }}>
                  <p className="text-sm font-bold font-mono" style={{ color: s.color }}>{s.value}</p>
                  <p className="text-[8px] font-mono tracking-widest mt-0.5" style={{ color: `${s.color}90` }}>{s.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Create form or button */}
          {creating
            ? <CreatePlanForm apiBase={apiBase} onCreated={() => { setCreating(false); fetchPlans(); }} onCancel={() => setCreating(false)} />
            : (
              <button type="button" onClick={() => setCreating(true)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl mb-3 text-[11px] font-bold tracking-widest transition-all active:scale-95"
                style={{ background: `${PURPLE}10`, border: `1px dashed ${PURPLE}40`, color: PURPLE }}>
                <Plus className="w-4 h-4" /> CREATE NEW PLAN
              </button>
            )}

          {/* Plans list */}
          {loading && plans.length === 0 ? (
            <div className="flex items-center justify-center py-12 gap-2" style={{ color: MUTED }}>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-[11px]">Loading plans…</span>
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <Inbox className="w-8 h-8 opacity-15" style={{ color: PURPLE }} />
              <p className="text-[11px]" style={{ color: MUTED }}>
                {plans.length === 0
                  ? "No plans yet. Click Create New Plan to generate your first structured plan with Claude."
                  : "No active plans. Toggle archive below to view archived plans."}
              </p>
            </div>
          ) : (
            visible.map(plan => (
              <PlanCard key={plan.id} plan={plan} apiBase={apiBase} onRefresh={() => fetchPlans(true)} />
            ))
          )}

          {/* Archive toggle */}
          {archived > 0 && (
            <button type="button"
              onClick={() => setShowArchive(v => !v)}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-[9px] font-mono mt-1 transition-all active:scale-95"
              style={{ color: MUTED, border: "1px solid hsl(210 15% 16%)" }}>
              {showArchive
                ? <><RotateCcw className="w-3 h-3" /> Hide {archived} archived</>
                : <><Archive className="w-3 h-3" /> Show {archived} archived</>}
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
