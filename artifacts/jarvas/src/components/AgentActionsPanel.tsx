/**
 * components/AgentActionsPanel.tsx — Agent Action Approval panel
 *
 * Lists all agent-proposed actions from GET /api/agent-actions.
 * Each pending action has Approve / Reject buttons that call
 * PATCH /api/agent-actions/:id/approve|reject.
 * Approved / rejected actions are shown read-only with their outcome.
 * No side-effects beyond status change — safe to use at any time.
 */

import { useState, useEffect, useCallback } from "react";
import {
  X, RefreshCw, ShieldCheck, ShieldAlert, ShieldOff,
  CheckCircle2, XCircle, Clock, Loader2, Plus, Inbox,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type RiskLevel    = "low" | "medium" | "high";
type ActionStatus = "pending" | "approved" | "rejected";
type FilterTab    = "all" | ActionStatus;

interface AgentAction {
  id:          string;
  title:       string;
  description: string;
  riskLevel:   RiskLevel;
  proposedBy:  string;
  status:      ActionStatus;
  createdAt:   string;
  updatedAt:   string;
}

interface AgentActionsPanelProps {
  isOpen:  boolean;
  onClose: () => void;
  apiBase: string;
}

// ─── Style maps ───────────────────────────────────────────────────────────────

const RISK: Record<RiskLevel, { color: string; bg: string; border: string; label: string; Icon: React.ElementType }> = {
  low:    { color: "hsl(150 70% 60%)", bg: "hsl(150 70% 55% / 0.12)", border: "hsl(150 70% 55% / 0.35)", label: "LOW",    Icon: ShieldCheck },
  medium: { color: "hsl(38 100% 65%)", bg: "hsl(38 100% 55% / 0.12)", border: "hsl(38 100% 55% / 0.35)", label: "MEDIUM", Icon: ShieldAlert },
  high:   { color: "hsl(355 90% 68%)", bg: "hsl(355 80% 55% / 0.12)", border: "hsl(355 80% 55% / 0.35)", label: "HIGH",   Icon: ShieldOff },
};

const STATUS: Record<ActionStatus, { color: string; bg: string; border: string; label: string; Icon: React.ElementType }> = {
  pending:  { color: "hsl(194 100% 65%)", bg: "hsl(194 100% 50% / 0.1)",  border: "hsl(194 100% 50% / 0.3)", label: "PENDING",  Icon: Clock },
  approved: { color: "hsl(150 70% 60%)",  bg: "hsl(150 70% 55% / 0.1)",   border: "hsl(150 70% 55% / 0.3)",  label: "APPROVED", Icon: CheckCircle2 },
  rejected: { color: "hsl(210 15% 42%)",  bg: "hsl(210 15% 14% / 0.5)",   border: "hsl(210 15% 22%)",         label: "REJECTED", Icon: XCircle },
};

const TABS: { key: FilterTab; label: string }[] = [
  { key: "all",      label: "All"      },
  { key: "pending",  label: "Pending"  },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

// ─── Action card ──────────────────────────────────────────────────────────────

function ActionCard({
  action,
  onApprove,
  onReject,
  busy,
}: {
  action:    AgentAction;
  onApprove: (id: string) => void;
  onReject:  (id: string) => void;
  busy:      boolean;
}) {
  const risk   = RISK[action.riskLevel]   ?? RISK.medium;
  const status = STATUS[action.status]    ?? STATUS.pending;
  const { Icon: RiskIcon }   = risk;
  const { Icon: StatusIcon } = status;

  return (
    <div className="rounded-xl overflow-hidden"
      style={{ border: `1px solid ${risk.border}`, background: risk.bg }}>
      {/* Card header */}
      <div className="flex items-start gap-2 px-3 pt-3 pb-2">
        <RiskIcon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: risk.color }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold"
              style={{ background: `${risk.color}22`, border: `1px solid ${risk.color}55`, color: risk.color }}>
              {risk.label} RISK
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded font-mono flex items-center gap-0.5"
              style={{ background: status.bg, border: `1px solid ${status.border}`, color: status.color }}>
              <StatusIcon className="w-2.5 h-2.5" />
              {status.label}
            </span>
          </div>
          <p className="text-xs font-semibold leading-snug" style={{ color: "hsl(196 40% 85%)" }}>
            {action.title}
          </p>
        </div>
      </div>

      {/* Description */}
      <div className="px-3 pb-2">
        <p className="text-[10px] leading-relaxed" style={{ color: "hsl(210 15% 58%)" }}>
          {action.description}
        </p>
        <div className="flex items-center gap-3 mt-1.5">
          <span className="text-[9px] font-mono" style={{ color: "hsl(210 15% 38%)" }}>
            by {action.proposedBy}
          </span>
          <span className="text-[9px] font-mono" style={{ color: "hsl(210 15% 32%)" }}>
            {new Date(action.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}{" "}
            {new Date(action.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      </div>

      {/* Actions row — only for pending */}
      {action.status === "pending" && (
        <div className="flex gap-2 px-3 pb-3">
          <button type="button"
            onClick={() => onApprove(action.id)}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40"
            style={{ background: "hsl(150 70% 45% / 0.15)", border: "1px solid hsl(150 70% 45% / 0.4)", color: "hsl(150 70% 60%)" }}>
            <CheckCircle2 className="w-3 h-3" />
            APPROVE
          </button>
          <button type="button"
            onClick={() => onReject(action.id)}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40"
            style={{ background: "hsl(355 80% 55% / 0.1)", border: "1px solid hsl(355 80% 55% / 0.3)", color: "hsl(355 80% 65%)" }}>
            <XCircle className="w-3 h-3" />
            REJECT
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Create form ──────────────────────────────────────────────────────────────

function CreateForm({ apiBase, onCreated }: { apiBase: string; onCreated: () => void }) {
  const [open, setOpen]       = useState(false);
  const [title, setTitle]     = useState("");
  const [desc, setDesc]       = useState("");
  const [risk, setRisk]       = useState<RiskLevel>("medium");
  const [by, setBy]           = useState("user");
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim() || !desc.trim()) { setErr("Title and description are required."); return; }
    setSaving(true); setErr(null);
    try {
      const res  = await fetch(`${apiBase}api/agent-actions`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ title: title.trim(), description: desc.trim(), riskLevel: risk, proposedBy: by || "user" }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Failed to create");
      setTitle(""); setDesc(""); setRisk("medium"); setBy("user"); setOpen(false);
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl overflow-hidden"
      style={{ border: "1px solid hsl(210 15% 18%)", background: "hsl(220 20% 6.5%)" }}>
      <button type="button"
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
        onClick={() => setOpen(v => !v)}>
        <Plus className="w-3.5 h-3.5" style={{ color: "hsl(194 100% 60%)" }} />
        <span className="text-xs font-semibold tracking-wide" style={{ color: "hsl(194 100% 70%)" }}>
          Propose new action
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 border-t space-y-2" style={{ borderColor: "hsl(210 15% 14%)" }}>
          {err && (
            <p className="text-[10px] pt-2" style={{ color: "hsl(355 80% 65%)" }}>{err}</p>
          )}
          <div className="pt-2">
            <label className="text-[9px] font-mono tracking-widest block mb-1" style={{ color: "hsl(210 15% 42%)" }}>
              TITLE
            </label>
            <input
              value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Short action title"
              className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none"
              style={{ background: "hsl(220 25% 9%)", border: "1px solid hsl(210 15% 20%)", color: "hsl(196 40% 80%)" }}
            />
          </div>
          <div>
            <label className="text-[9px] font-mono tracking-widest block mb-1" style={{ color: "hsl(210 15% 42%)" }}>
              DESCRIPTION
            </label>
            <textarea
              value={desc} onChange={e => setDesc(e.target.value)}
              rows={2} placeholder="What will this action do?"
              className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none resize-none"
              style={{ background: "hsl(220 25% 9%)", border: "1px solid hsl(210 15% 20%)", color: "hsl(196 40% 80%)" }}
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[9px] font-mono tracking-widest block mb-1" style={{ color: "hsl(210 15% 42%)" }}>
                RISK
              </label>
              <select value={risk} onChange={e => setRisk(e.target.value as RiskLevel)}
                className="w-full px-2 py-1.5 rounded-lg text-xs outline-none"
                style={{ background: "hsl(220 25% 9%)", border: "1px solid hsl(210 15% 20%)", color: "hsl(196 40% 80%)" }}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="text-[9px] font-mono tracking-widest block mb-1" style={{ color: "hsl(210 15% 42%)" }}>
                PROPOSED BY
              </label>
              <input value={by} onChange={e => setBy(e.target.value)} placeholder="agent / user"
                className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none"
                style={{ background: "hsl(220 25% 9%)", border: "1px solid hsl(210 15% 20%)", color: "hsl(196 40% 80%)" }}
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)}
              className="flex-1 py-1.5 rounded-lg text-[10px] font-bold tracking-widest transition-all active:scale-95"
              style={{ background: "transparent", border: "1px solid hsl(210 15% 22%)", color: "hsl(210 15% 48%)" }}>
              CANCEL
            </button>
            <button type="button" onClick={submit} disabled={saving}
              className="flex-1 py-1.5 rounded-lg text-[10px] font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40"
              style={{ background: "hsl(194 100% 45% / 0.15)", border: "1px solid hsl(194 100% 50% / 0.4)", color: "hsl(194 100% 70%)" }}>
              {saving ? "SAVING…" : "PROPOSE"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AgentActionsPanel({ isOpen, onClose, apiBase }: AgentActionsPanelProps) {
  const [actions,  setActions]  = useState<AgentAction[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [busy,     setBusy]     = useState(false);
  const [filter,   setFilter]   = useState<FilterTab>("all");

  const fetchActions = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`${apiBase}api/agent-actions`);
      const data = await res.json() as { ok: boolean; actions?: AgentAction[]; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Failed to load");
      setActions(data.actions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => { if (isOpen) fetchActions(); }, [isOpen, fetchActions]);

  const mutate = useCallback(async (id: string, verb: "approve" | "reject") => {
    setBusy(true);
    try {
      const res  = await fetch(`${apiBase}api/agent-actions/${encodeURIComponent(id)}/${verb}`, { method: "PATCH" });
      const data = await res.json() as { ok: boolean; action?: AgentAction; error?: string };
      if (!data.ok) throw new Error(data.error ?? `Failed to ${verb}`);
      if (data.action) {
        setActions(prev => prev.map(a => a.id === id ? data.action! : a));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }, [apiBase]);

  const visible = filter === "all" ? actions : actions.filter(a => a.status === filter);
  const pendingCount = actions.filter(a => a.status === "pending").length;

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-30 sm:hidden"
          style={{ background: "hsl(220 30% 4% / 0.6)" }}
          onClick={onClose} aria-hidden="true" />
      )}

      <aside
        data-testid="agent-actions-panel"
        className="fixed top-0 right-0 h-full z-40 flex flex-col transition-transform duration-300 ease-in-out"
        style={{
          width:     "min(100vw, 420px)",
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
          background: "hsl(222 28% 7%)",
          borderLeft: "1px solid hsl(210 15% 15%)",
          boxShadow:  isOpen ? "-4px 0 32px hsl(0 0% 0% / 0.5)" : "none",
        }}
        aria-label="Agent actions panel"
      >
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b"
          style={{ borderColor: "hsl(210 15% 14%)" }}>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" style={{ color: "hsl(320 80% 70%)" }} />
            <h2 className="text-sm font-bold tracking-widest" style={{ color: "hsl(320 80% 78%)" }}>
              AGENT ACTIONS
            </h2>
            {pendingCount > 0 && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full font-mono font-bold"
                style={{ background: "hsl(38 100% 55% / 0.18)", border: "1px solid hsl(38 100% 55% / 0.4)", color: "hsl(38 100% 70%)" }}>
                {pendingCount} pending
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={fetchActions} disabled={loading}
              title="Refresh" aria-label="Refresh actions"
              className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95 disabled:opacity-40"
              style={{ background: "hsl(320 80% 55% / 0.08)", borderColor: "hsl(320 80% 55% / 0.3)" }}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
                style={{ color: "hsl(320 80% 70%)" }} />
            </button>
            <button type="button" onClick={onClose} aria-label="Close actions panel"
              className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95"
              style={{ background: "transparent", borderColor: "hsl(210 15% 28%)" }}>
              <X className="w-3.5 h-3.5" style={{ color: "hsl(210 20% 55%)" }} />
            </button>
          </div>
        </header>

        {/* Filter tabs */}
        <div className="flex gap-0.5 px-3 py-2 border-b flex-shrink-0"
          style={{ borderColor: "hsl(210 15% 12%)" }}>
          {TABS.map(tab => {
            const count = tab.key === "all"
              ? actions.length
              : actions.filter(a => a.status === tab.key).length;
            const active = filter === tab.key;
            return (
              <button key={tab.key} type="button"
                onClick={() => setFilter(tab.key)}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[9px] font-bold tracking-widest transition-all"
                style={{
                  background:  active ? "hsl(320 80% 55% / 0.12)" : "transparent",
                  border:      `1px solid ${active ? "hsl(320 80% 55% / 0.4)" : "transparent"}`,
                  color:       active ? "hsl(320 80% 72%)" : "hsl(210 15% 42%)",
                }}>
                {tab.label}
                {count > 0 && (
                  <span className="text-[8px] px-1 py-0.5 rounded font-mono"
                    style={{ background: active ? "hsl(320 80% 55% / 0.2)" : "hsl(210 15% 14%)", color: active ? "hsl(320 80% 72%)" : "hsl(210 15% 40%)" }}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-3 mt-2 flex items-start gap-2 p-2.5 rounded-lg flex-shrink-0"
            style={{ background: "hsl(355 80% 50% / 0.1)", border: "1px solid hsl(355 80% 50% / 0.3)" }}>
            <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: "hsl(355 80% 65%)" }} />
            <p className="text-[10px]" style={{ color: "hsl(355 80% 72%)" }}>{error}</p>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {/* Create form */}
          <CreateForm apiBase={apiBase} onCreated={fetchActions} />

          {loading && actions.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-10">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: "hsl(320 80% 70%)" }} />
              <span className="text-xs tracking-wider" style={{ color: "hsl(210 15% 45%)" }}>Loading actions…</span>
            </div>
          )}

          {!loading && visible.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-10">
              <Inbox className="w-8 h-8 opacity-15" style={{ color: "hsl(320 80% 65%)" }} />
              <p className="text-xs" style={{ color: "hsl(210 15% 40%)" }}>
                {filter === "all" ? "No actions yet" : `No ${filter} actions`}
              </p>
            </div>
          )}

          {visible.map(action => (
            <ActionCard
              key={action.id}
              action={action}
              onApprove={id => mutate(id, "approve")}
              onReject={id  => mutate(id, "reject")}
              busy={busy}
            />
          ))}
        </div>
      </aside>
    </>
  );
}
