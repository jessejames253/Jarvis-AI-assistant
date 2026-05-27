/**
 * components/ImprovementPanel.tsx — Autonomous Improvement Loop v1 + Queue v1
 *
 * Two views:
 *   SUGGESTIONS — Claude-generated improvement ideas; dismiss or queue them
 *   QUEUE       — Staged candidates awaiting user approve/reject before work-order creation
 *
 * No autonomous execution — all actions require explicit user approval.
 */

import { useState, useEffect, useCallback } from "react";
import {
  X, Cpu, Loader2, XCircle, RefreshCw,
  ChevronDown, ChevronRight, AlertTriangle,
  TrendingUp, Zap, Sparkles, ListPlus,
  Database, Layout, MousePointerClick,
  ListX, ClipboardList, ShieldCheck,
  CheckCircle2, Ban, ArrowRight,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type AnalysisCategory =
  | "task_backlog" | "failed_execution" | "repeated_warnings"
  | "low_completion_agent" | "missing_validation" | "empty_data_store"
  | "route_without_panel" | "panel_without_actions";

type SuggestionSeverity = "critical" | "high" | "medium" | "low";
type SuggestionStatus   = "open" | "converted" | "dismissed";
type QueueStatus        = "queued" | "approved" | "rejected" | "converted" | "failed";

interface SuggestedWorkOrder {
  title:          string;
  objective:      string;
  inputs:         string[];
  expectedOutput: string;
  riskLevel:      "high" | "medium" | "low";
}

interface ImprovementSuggestion {
  id:                    string;
  category:              AnalysisCategory;
  severity:              SuggestionSeverity;
  title:                 string;
  reasoning:             string;
  estimatedImpact:       string;
  recommendedAgent:      string;
  suggestedWorkOrder:    SuggestedWorkOrder;
  autoExecutable:        boolean;
  detectedAt:            string;
  status:                SuggestionStatus;
  convertedWorkOrderId?: string;
}

interface AnalysisMeta {
  ranAt:       string;
  scanSummary: string;
  count:       number;
}

interface QueueItem {
  id:               string;
  suggestionId:     string;
  title:            string;
  recommendedAgent: string;
  riskLevel:        "high" | "medium" | "low";
  status:           QueueStatus;
  createdAt:        string;
}

interface ImprovementPanelProps {
  isOpen:  boolean;
  onClose: () => void;
  apiBase: string;
}

type PanelView = "suggestions" | "queue";

// ─── Style constants ──────────────────────────────────────────────────────────

const TEAL   = "hsl(175 75% 52%)";
const MUTED  = "hsl(210 15% 38%)";
const GREEN  = "hsl(150 70% 55%)";
const AMBER  = "hsl(38 100% 60%)";
const RED    = "hsl(355 80% 65%)";
const ORANGE = "hsl(25 95% 58%)";
const VIOLET = "hsl(262 75% 65%)";
const BLUE   = "hsl(196 80% 58%)";

// ─── Category metadata ────────────────────────────────────────────────────────

const CAT_META: Record<AnalysisCategory, { label: string; color: string; icon: React.ElementType }> = {
  task_backlog:          { label: "Task Backlog",       color: AMBER,  icon: ListX             },
  failed_execution:      { label: "Failed Execution",   color: RED,    icon: XCircle           },
  repeated_warnings:     { label: "Repeated Warnings",  color: ORANGE, icon: AlertTriangle     },
  low_completion_agent:  { label: "Low Completion",     color: AMBER,  icon: TrendingUp        },
  missing_validation:    { label: "Missing Validation", color: VIOLET, icon: ShieldCheck       },
  empty_data_store:      { label: "Empty Data Store",   color: BLUE,   icon: Database          },
  route_without_panel:   { label: "Route Sans Panel",   color: VIOLET, icon: Layout            },
  panel_without_actions: { label: "Panel Sans Actions", color: MUTED,  icon: MousePointerClick },
};

const SEV_META: Record<SuggestionSeverity, { label: string; color: string }> = {
  critical: { label: "CRITICAL", color: RED    },
  high:     { label: "HIGH",     color: ORANGE },
  medium:   { label: "MEDIUM",   color: AMBER  },
  low:      { label: "LOW",      color: GREEN  },
};

const QUEUE_STATUS_META: Record<QueueStatus, { label: string; color: string }> = {
  queued:    { label: "QUEUED",    color: TEAL   },
  approved:  { label: "APPROVED",  color: GREEN  },
  rejected:  { label: "REJECTED",  color: MUTED  },
  converted: { label: "CONVERTED", color: AMBER  },
  failed:    { label: "FAILED",    color: RED    },
};

const RISK_COLOR: Record<string, string> = { high: RED, medium: AMBER, low: GREEN };
const SEV_ORDER:  Record<SuggestionSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

// ─── Suggestion card ──────────────────────────────────────────────────────────

function SuggestionCard({
  s, onDismiss, dismissing,
}: {
  s:          ImprovementSuggestion;
  onDismiss:  (id: string) => void;
  dismissing: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const cat          = CAT_META[s.category] ?? CAT_META.task_backlog;
  const sev          = SEV_META[s.severity];
  const CatIcon      = cat.icon;
  const isDismissing = dismissing === s.id;
  const isDone       = s.status !== "open";

  return (
    <div className="rounded-xl overflow-hidden"
      style={{
        border:     `1px solid ${sev.color}28`,
        background: `${sev.color}04`,
        opacity:    isDone ? 0.55 : 1,
      }}>
      {/* Header */}
      <div className="flex items-start gap-2 px-3 pt-3 pb-1.5">
        <CatIcon className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: cat.color }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <span className="text-[6.5px] font-mono px-1 py-0.5 rounded"
              style={{ background: `${sev.color}18`, border: `1px solid ${sev.color}35`, color: sev.color }}>
              {sev.label}
            </span>
            <span className="text-[6.5px] font-mono px-1 py-0.5 rounded"
              style={{ background: `${cat.color}12`, border: `1px solid ${cat.color}25`, color: cat.color }}>
              {cat.label}
            </span>
            {s.autoExecutable && (
              <span className="flex items-center gap-0.5 text-[6.5px] font-mono px-1 py-0.5 rounded"
                style={{ background: `${GREEN}12`, border: `1px solid ${GREEN}30`, color: GREEN }}>
                <Zap className="w-2 h-2" /> safe auto
              </span>
            )}
            {isDone && (
              <span className="text-[6.5px] font-mono px-1 py-0.5 rounded"
                style={{
                  color:      s.status === "converted" ? GREEN : MUTED,
                  background: `${s.status === "converted" ? GREEN : MUTED}12`,
                }}>
                {s.status.toUpperCase()}
              </span>
            )}
          </div>
          <p className="text-[9px] font-semibold leading-snug" style={{ color: "hsl(196 25% 76%)" }}>
            {s.title}
          </p>
        </div>
      </div>

      {/* Expand toggle */}
      <button type="button" onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1.5 w-full text-left px-3 pb-1.5">
        {expanded
          ? <ChevronDown  className="w-2.5 h-2.5" style={{ color: MUTED }} />
          : <ChevronRight className="w-2.5 h-2.5" style={{ color: MUTED }} />}
        <span className="text-[7px]" style={{ color: MUTED }}>
          {expanded ? "collapse" : "details"}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <div>
            <p className="text-[6.5px] font-mono font-bold tracking-widest mb-0.5" style={{ color: MUTED }}>REASONING</p>
            <p className="text-[8px] leading-relaxed" style={{ color: "hsl(196 20% 62%)" }}>{s.reasoning}</p>
          </div>
          <div className="rounded px-2 py-1.5"
            style={{ background: `${TEAL}08`, border: `1px solid ${TEAL}20` }}>
            <div className="flex items-center gap-1 mb-0.5">
              <TrendingUp className="w-2.5 h-2.5 flex-shrink-0" style={{ color: TEAL }} />
              <p className="text-[6.5px] font-mono font-bold tracking-widest" style={{ color: TEAL }}>ESTIMATED IMPACT</p>
            </div>
            <p className="text-[7.5px]" style={{ color: "hsl(175 50% 65%)" }}>{s.estimatedImpact}</p>
          </div>
          <div className="rounded px-2 py-1.5"
            style={{ background: "hsl(220 20% 6%)", border: "1px solid hsl(210 15% 16%)" }}>
            <div className="flex items-center gap-1 mb-1">
              <ClipboardList className="w-2.5 h-2.5 flex-shrink-0" style={{ color: AMBER }} />
              <p className="text-[6.5px] font-mono font-bold tracking-widest" style={{ color: AMBER }}>SUGGESTED WORK ORDER</p>
            </div>
            <p className="text-[8px] font-semibold mb-0.5" style={{ color: "hsl(43 100% 68%)" }}>
              {s.suggestedWorkOrder.title}
            </p>
            <p className="text-[7px] mb-1" style={{ color: MUTED }}>{s.suggestedWorkOrder.objective}</p>
            {s.suggestedWorkOrder.inputs.map((inp, i) => (
              <p key={i} className="text-[7px]" style={{ color: MUTED }}>· {inp}</p>
            ))}
            <div className="flex items-center gap-2 flex-wrap mt-1">
              <span className="text-[7px]" style={{ color: "hsl(196 25% 55%)" }}>
                → {s.suggestedWorkOrder.expectedOutput}
              </span>
              <span className="text-[6px] font-mono px-1 rounded"
                style={{
                  background: `${RISK_COLOR[s.suggestedWorkOrder.riskLevel] ?? MUTED}12`,
                  color:       RISK_COLOR[s.suggestedWorkOrder.riskLevel] ?? MUTED,
                }}>
                {s.suggestedWorkOrder.riskLevel} risk
              </span>
            </div>
            <p className="text-[7px] mt-1" style={{ color: MUTED }}>
              Agent: <span style={{ color: "hsl(196 60% 58%)" }}>{s.recommendedAgent}</span>
            </p>
          </div>
        </div>
      )}

      {/* Dismiss button — open items only */}
      {!isDone && (
        <div className="flex items-center gap-1.5 px-3 pb-3">
          <button type="button" onClick={() => onDismiss(s.id)} disabled={isDismissing}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border font-bold text-[8px] tracking-widest transition-all active:scale-95 disabled:opacity-40"
            style={{ borderColor: "hsl(210 15% 24%)", background: "transparent", color: MUTED }}>
            {isDismissing
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <X className="w-3 h-3" />} DISMISS
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Queue card ───────────────────────────────────────────────────────────────

function QueueCard({
  item, onApprove, onReject, onConvert, actionPending,
}: {
  item:          QueueItem;
  onApprove:     (id: string) => void;
  onReject:      (id: string) => void;
  onConvert:     (id: string) => void;
  actionPending: string | null;
}) {
  const sm       = QUEUE_STATUS_META[item.status];
  const isPending = actionPending === item.id;
  const isActive  = item.status === "queued";
  const isApproved = item.status === "approved";
  const isDone    = item.status === "converted" || item.status === "rejected" || item.status === "failed";

  return (
    <div className="rounded-xl overflow-hidden transition-all"
      style={{
        border:     `1px solid ${sm.color}30`,
        background: `${sm.color}05`,
        opacity:    isDone ? 0.6 : 1,
      }}>
      {/* Header */}
      <div className="px-3 pt-3 pb-2">
        {/* Status + risk badges */}
        <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
          <span className="text-[6.5px] font-mono px-1.5 py-0.5 rounded"
            style={{ background: `${sm.color}18`, border: `1px solid ${sm.color}35`, color: sm.color }}>
            {sm.label}
          </span>
          <span className="text-[6.5px] font-mono px-1 py-0.5 rounded"
            style={{
              background: `${RISK_COLOR[item.riskLevel] ?? MUTED}12`,
              color:       RISK_COLOR[item.riskLevel] ?? MUTED,
            }}>
            {item.riskLevel} risk
          </span>
        </div>
        {/* Title */}
        <p className="text-[9px] font-semibold leading-snug mb-1" style={{ color: "hsl(196 25% 76%)" }}>
          {item.title}
        </p>
        {/* Agent */}
        <p className="text-[7px]" style={{ color: MUTED }}>
          Agent: <span style={{ color: "hsl(196 60% 58%)" }}>{item.recommendedAgent}</span>
          <span className="ml-2" style={{ color: "hsl(210 15% 28%)" }}>
            {new Date(item.createdAt).toLocaleString()}
          </span>
        </p>
      </div>

      {/* Actions */}
      {isActive && (
        <div className="flex items-center gap-1.5 px-3 pb-3">
          <button type="button" onClick={() => onApprove(item.id)} disabled={isPending}
            className="flex items-center gap-1 flex-1 justify-center py-1.5 rounded-lg font-bold text-[8px] tracking-widest transition-all active:scale-95 disabled:opacity-40"
            style={{ background: `${GREEN}15`, border: `1px solid ${GREEN}45`, color: GREEN }}>
            {isPending
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <CheckCircle2 className="w-3 h-3" />} APPROVE
          </button>
          <button type="button" onClick={() => onReject(item.id)} disabled={isPending}
            className="flex items-center gap-1 flex-1 justify-center py-1.5 rounded-lg font-bold text-[8px] tracking-widest transition-all active:scale-95 disabled:opacity-40"
            style={{ background: `${RED}10`, border: `1px solid ${RED}35`, color: RED }}>
            <Ban className="w-3 h-3" /> REJECT
          </button>
        </div>
      )}

      {isApproved && (
        <div className="px-3 pb-3">
          <button type="button" onClick={() => onConvert(item.id)} disabled={isPending}
            className="flex items-center gap-1 w-full justify-center py-1.5 rounded-lg font-bold text-[8px] tracking-widest transition-all active:scale-95 disabled:opacity-40"
            style={{ background: `${AMBER}15`, border: `1px solid ${AMBER}45`, color: AMBER }}>
            {isPending
              ? <><Loader2 className="w-3 h-3 animate-spin" /> CONVERTING…</>
              : <><ClipboardList className="w-3 h-3" /><ArrowRight className="w-3 h-3" /> CREATE WORK ORDER</>}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Stat pill ────────────────────────────────────────────────────────────────

function StatPill({ count, label, color }: { count: number; label: string; color: string }) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-1 px-2 py-1 rounded-lg"
      style={{ background: `${color}10`, border: `1px solid ${color}25` }}>
      <span className="text-[9px] font-mono font-bold" style={{ color }}>{count}</span>
      <span className="text-[7px] font-mono" style={{ color: MUTED }}>{label}</span>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function ImprovementPanel({ isOpen, onClose, apiBase }: ImprovementPanelProps) {
  // ── Suggestions state ────────────────────────────────────────────────────
  const [suggestions,  setSuggestions]  = useState<ImprovementSuggestion[]>([]);
  const [meta,         setMeta]         = useState<AnalysisMeta | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [analyzing,    setAnalyzing]    = useState(false);
  const [scanSummary,  setScanSummary]  = useState<string | null>(null);
  const [dismissing,   setDismissing]   = useState<string | null>(null);
  const [sugFilter,    setSugFilter]    = useState<SuggestionStatus | "all">("all");

  // ── Queue state ──────────────────────────────────────────────────────────
  const [queueItems,    setQueueItems]   = useState<QueueItem[]>([]);
  const [queueLoading,  setQueueLoading] = useState(false);
  const [queueBuilding, setQueueBuilding] = useState(false);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [queueFilter,   setQueueFilter]  = useState<QueueStatus | "all">("all");

  // ── Shared state ─────────────────────────────────────────────────────────
  const [view,  setView]  = useState<PanelView>("suggestions");
  const [error, setError] = useState<string | null>(null);

  // ── Suggestions: fetch ────────────────────────────────────────────────────
  const fetchSuggestions = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`${apiBase}api/autonomy/suggestions`);
      const data = await res.json() as {
        ok: boolean; suggestions?: ImprovementSuggestion[]; meta?: AnalysisMeta; error?: string;
      };
      if (!data.ok) throw new Error(data.error ?? "Failed to load suggestions");
      setSuggestions(data.suggestions ?? []);
      setMeta(data.meta ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally { setLoading(false); }
  }, [apiBase]);

  // ── Queue: fetch ─────────────────────────────────────────────────────────
  const fetchQueue = useCallback(async () => {
    setQueueLoading(true); setError(null);
    try {
      const res  = await fetch(`${apiBase}api/autonomy/queue`);
      const data = await res.json() as { ok: boolean; items?: QueueItem[]; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Failed to load queue");
      setQueueItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally { setQueueLoading(false); }
  }, [apiBase]);

  // Load on open
  useEffect(() => {
    if (!isOpen) return;
    void fetchSuggestions();
    void fetchQueue();
  }, [isOpen, fetchSuggestions, fetchQueue]);

  // ── Analysis ─────────────────────────────────────────────────────────────
  const runAnalysis = useCallback(async () => {
    setAnalyzing(true); setError(null); setScanSummary(null);
    try {
      const res  = await fetch(`${apiBase}api/autonomy/analyze`, { method: "POST" });
      const data = await res.json() as {
        ok: boolean; suggestions?: ImprovementSuggestion[]; scanSummary?: string; error?: string;
      };
      if (!data.ok) throw new Error(data.error ?? "Analysis failed");
      setSuggestions(data.suggestions ?? []);
      setScanSummary(data.scanSummary ?? null);
      await fetchSuggestions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally { setAnalyzing(false); }
  }, [apiBase, fetchSuggestions]);

  // ── Dismiss suggestion ────────────────────────────────────────────────────
  const dismissSuggestion = useCallback(async (id: string) => {
    setDismissing(id); setError(null);
    try {
      const res  = await fetch(`${apiBase}api/autonomy/suggestions/${id}/dismiss`, { method: "POST" });
      const data = await res.json() as { ok: boolean; suggestion?: ImprovementSuggestion; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Dismiss failed");
      if (data.suggestion) setSuggestions(prev => prev.map(s => s.id === id ? data.suggestion! : s));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally { setDismissing(null); }
  }, [apiBase]);

  // ── Build queue from open suggestions ─────────────────────────────────────
  const buildQueue = useCallback(async () => {
    setQueueBuilding(true); setError(null);
    try {
      const res  = await fetch(`${apiBase}api/autonomy/queue/from-suggestions`, { method: "POST" });
      const data = await res.json() as {
        ok: boolean; allItems?: QueueItem[]; newlyAdded?: number; message?: string; error?: string;
      };
      if (!data.ok) throw new Error(data.error ?? "Queue build failed");
      setQueueItems(data.allItems ?? []);
      if (data.newlyAdded === 0 && data.message) setError(data.message);
      else setView("queue");  // auto-switch to queue tab after building
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally { setQueueBuilding(false); }
  }, [apiBase]);

  // ── Queue: approve ────────────────────────────────────────────────────────
  const approveItem = useCallback(async (id: string) => {
    setActionPending(id); setError(null);
    try {
      const res  = await fetch(`${apiBase}api/autonomy/queue/${id}/approve`, { method: "PATCH" });
      const data = await res.json() as { ok: boolean; item?: QueueItem; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Approve failed");
      if (data.item) setQueueItems(prev => prev.map(q => q.id === id ? data.item! : q));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally { setActionPending(null); }
  }, [apiBase]);

  // ── Queue: reject ─────────────────────────────────────────────────────────
  const rejectItem = useCallback(async (id: string) => {
    setActionPending(id); setError(null);
    try {
      const res  = await fetch(`${apiBase}api/autonomy/queue/${id}/reject`, { method: "PATCH" });
      const data = await res.json() as { ok: boolean; item?: QueueItem; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Reject failed");
      if (data.item) setQueueItems(prev => prev.map(q => q.id === id ? data.item! : q));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally { setActionPending(null); }
  }, [apiBase]);

  // ── Queue: convert → work order ───────────────────────────────────────────
  const convertItem = useCallback(async (id: string) => {
    setActionPending(id); setError(null);
    try {
      const res  = await fetch(`${apiBase}api/autonomy/queue/${id}/convert-to-work-order`, { method: "POST" });
      const data = await res.json() as { ok: boolean; item?: QueueItem; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Conversion failed");
      if (data.item) setQueueItems(prev => prev.map(q => q.id === id ? data.item! : q));
      // Also refresh suggestions so converted ones update
      await fetchSuggestions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally { setActionPending(null); }
  }, [apiBase, fetchSuggestions]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const sugOpen      = suggestions.filter(s => s.status === "open").length;
  const sugConverted = suggestions.filter(s => s.status === "converted").length;
  const sugDismissed = suggestions.filter(s => s.status === "dismissed").length;
  const autoCount    = suggestions.filter(s => s.status === "open" && s.autoExecutable).length;

  const qQueued    = queueItems.filter(q => q.status === "queued").length;
  const qApproved  = queueItems.filter(q => q.status === "approved").length;

  const visibleSuggestions = suggestions
    .filter(s => sugFilter === "all" || s.status === sugFilter)
    .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

  const visibleQueue = queueItems
    .filter(q => queueFilter === "all" || q.status === queueFilter)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const isRefreshing = view === "suggestions" ? loading || analyzing : queueLoading;

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-30 sm:hidden"
          style={{ background: "hsl(220 30% 4% / 0.6)" }}
          onClick={onClose} aria-hidden="true" />
      )}

      <aside data-testid="improvement-panel"
        className="fixed top-0 right-0 h-full z-40 flex flex-col transition-transform duration-300 ease-in-out"
        style={{
          width:      "min(100vw, 480px)",
          transform:  isOpen ? "translateX(0)" : "translateX(100%)",
          background: "hsl(222 28% 7%)",
          borderLeft: "1px solid hsl(210 15% 15%)",
          boxShadow:  isOpen ? "-4px 0 32px hsl(0 0% 0% / 0.5)" : "none",
        }}
        aria-label="Improvement analysis panel">

        {/* ─ Header ──────────────────────────────────────────────────────── */}
        <header className="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b"
          style={{ borderColor: "hsl(210 15% 14%)" }}>
          <div className="flex items-center gap-2 flex-wrap">
            <Cpu className="w-4 h-4 flex-shrink-0" style={{ color: TEAL }} />
            <h2 className="text-sm font-bold tracking-widest" style={{ color: TEAL }}>IMPROVE</h2>
            {sugOpen > 0 && (
              <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full"
                style={{ background: `${TEAL}18`, border: `1px solid ${TEAL}40`, color: TEAL }}>
                {sugOpen} open
              </span>
            )}
            {qQueued + qApproved > 0 && (
              <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full"
                style={{ background: `${AMBER}12`, border: `1px solid ${AMBER}35`, color: AMBER }}>
                {qQueued + qApproved} in queue
              </span>
            )}
            {autoCount > 0 && (
              <span className="flex items-center gap-0.5 text-[8px] font-mono px-1.5 py-0.5 rounded-full"
                style={{ background: `${GREEN}12`, border: `1px solid ${GREEN}35`, color: GREEN }}>
                <Zap className="w-2.5 h-2.5" />{autoCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button type="button"
              onClick={() => { void fetchSuggestions(); void fetchQueue(); }}
              disabled={isRefreshing}
              className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95"
              style={{ background: "transparent", borderColor: "hsl(210 15% 28%)" }} title="Refresh">
              <RefreshCw className={`w-3 h-3 ${isRefreshing ? "animate-spin" : ""}`}
                style={{ color: "hsl(210 20% 55%)" }} />
            </button>
            <button type="button" onClick={onClose} aria-label="Close improvement panel"
              className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95"
              style={{ background: "transparent", borderColor: "hsl(210 15% 28%)" }}>
              <X className="w-3.5 h-3.5" style={{ color: "hsl(210 20% 55%)" }} />
            </button>
          </div>
        </header>

        {/* ─ View tabs ───────────────────────────────────────────────────── */}
        <div className="flex border-b flex-shrink-0" style={{ borderColor: "hsl(210 15% 12%)" }}>
          {(["suggestions", "queue"] as const).map(v => (
            <button key={v} type="button" onClick={() => setView(v)}
              className="flex-1 py-2 text-[9px] font-mono font-bold tracking-widest transition-all"
              style={{
                color:           view === v ? TEAL : MUTED,
                borderBottom:    `2px solid ${view === v ? TEAL : "transparent"}`,
                background:      view === v ? `${TEAL}06` : "transparent",
              }}>
              {v === "suggestions" ? `SUGGESTIONS${sugOpen > 0 ? ` (${sugOpen})` : ""}` : `QUEUE${qQueued + qApproved > 0 ? ` (${qQueued + qApproved})` : ""}`}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">

          {/* ═══════════════ SUGGESTIONS VIEW ════════════════════════════ */}
          {view === "suggestions" && (
            <>
              {/* Actions bar */}
              <div className="px-4 py-3 border-b space-y-2" style={{ borderColor: "hsl(210 15% 12%)" }}>
                <button type="button" onClick={runAnalysis} disabled={analyzing || loading}
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-bold text-[11px] tracking-widest transition-all active:scale-95 disabled:opacity-40"
                  style={{ background: `${TEAL}18`, border: `1px solid ${TEAL}45`, color: TEAL }}>
                  {analyzing
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> ANALYZING SYSTEM…</>
                    : <><Sparkles className="w-4 h-4" /> RUN SELF-IMPROVEMENT ANALYSIS</>}
                </button>

                {sugOpen > 0 && (
                  <button type="button" onClick={buildQueue} disabled={queueBuilding || analyzing}
                    className="flex items-center justify-center gap-2 w-full py-2 rounded-xl font-bold text-[10px] tracking-widest transition-all active:scale-95 disabled:opacity-40"
                    style={{ background: `${AMBER}12`, border: `1px solid ${AMBER}35`, color: AMBER }}>
                    {queueBuilding
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> BUILDING QUEUE…</>
                      : <><ListPlus className="w-3.5 h-3.5" /> BUILD QUEUE FROM {sugOpen} OPEN SUGGESTION{sugOpen > 1 ? "S" : ""}</>}
                  </button>
                )}

                <p className="text-[7.5px] text-center" style={{ color: MUTED }}>
                  Scans work orders, executions, data stores, and source coverage — read-only.
                </p>
                {scanSummary && (
                  <p className="text-[7px] text-center font-mono" style={{ color: TEAL }}>
                    Scan: {scanSummary}
                  </p>
                )}
                {meta?.ranAt && !scanSummary && (
                  <p className="text-[7px] text-center font-mono" style={{ color: MUTED }}>
                    Last analyzed: {new Date(meta.ranAt).toLocaleString()}
                  </p>
                )}
              </div>

              {/* Error */}
              {error && (
                <div className="mx-4 mt-3 flex items-start gap-2 p-2.5 rounded-lg"
                  style={{ background: "hsl(355 80% 50% / 0.1)", border: "1px solid hsl(355 80% 50% / 0.3)" }}>
                  <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: RED }} />
                  <p className="text-[10px]" style={{ color: "hsl(355 80% 72%)" }}>{error}</p>
                </div>
              )}

              {/* Stats */}
              {suggestions.length > 0 && (
                <div className="flex items-center gap-2 px-4 pt-3 flex-wrap">
                  <StatPill count={sugOpen}      label="open"      color={TEAL}  />
                  <StatPill count={sugConverted} label="converted" color={GREEN} />
                  <StatPill count={sugDismissed} label="dismissed" color={MUTED} />
                </div>
              )}

              {/* Filter tabs */}
              {suggestions.length > 0 && (
                <div className="flex items-center gap-1 px-4 pt-2">
                  {(["all", "open", "converted", "dismissed"] as const).map(f => (
                    <button key={f} type="button" onClick={() => setSugFilter(f)}
                      className="px-2 py-1 rounded text-[7.5px] font-mono font-bold tracking-widest transition-all"
                      style={{
                        background:  sugFilter === f ? `${TEAL}18` : "transparent",
                        border:      `1px solid ${sugFilter === f ? TEAL + "45" : "hsl(210 15% 22%)"}`,
                        color:       sugFilter === f ? TEAL : MUTED,
                      }}>
                      {f.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}

              {/* Loading */}
              {(loading || analyzing) && (
                <div className="flex items-center gap-2 py-10 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: TEAL }} />
                  <span className="text-[10px]" style={{ color: MUTED }}>
                    {analyzing ? "Scanning system & generating suggestions…" : "Loading…"}
                  </span>
                </div>
              )}

              {/* Empty */}
              {!loading && !analyzing && suggestions.length === 0 && (
                <div className="flex flex-col items-center gap-3 py-14 text-center px-6">
                  <Cpu className="w-8 h-8 opacity-10" style={{ color: TEAL }} />
                  <p className="text-[11px]" style={{ color: MUTED }}>
                    No suggestions yet. Click{" "}
                    <strong style={{ color: TEAL }}>RUN SELF-IMPROVEMENT ANALYSIS</strong>.
                  </p>
                </div>
              )}

              {/* Cards */}
              {!loading && !analyzing && visibleSuggestions.length > 0 && (
                <div className="px-3 pt-3 pb-8 space-y-2">
                  {visibleSuggestions.map(s => (
                    <SuggestionCard key={s.id} s={s}
                      onDismiss={dismissSuggestion}
                      dismissing={dismissing}
                    />
                  ))}
                </div>
              )}

              {!loading && !analyzing && suggestions.length > 0 && visibleSuggestions.length === 0 && (
                <div className="py-10 text-center px-6">
                  <p className="text-[10px]" style={{ color: MUTED }}>No {sugFilter} suggestions.</p>
                </div>
              )}
            </>
          )}

          {/* ═══════════════ QUEUE VIEW ══════════════════════════════════ */}
          {view === "queue" && (
            <>
              {/* Actions bar */}
              <div className="px-4 py-3 border-b space-y-2" style={{ borderColor: "hsl(210 15% 12%)" }}>
                <button type="button" onClick={buildQueue} disabled={queueBuilding || sugOpen === 0}
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-bold text-[11px] tracking-widest transition-all active:scale-95 disabled:opacity-40"
                  style={{ background: `${AMBER}15`, border: `1px solid ${AMBER}45`, color: AMBER }}>
                  {queueBuilding
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> BUILDING…</>
                    : <><ListPlus className="w-4 h-4" /> BUILD QUEUE FROM OPEN SUGGESTIONS</>}
                </button>
                <p className="text-[7.5px] text-center" style={{ color: MUTED }}>
                  Stages open suggestions as approval candidates. No actions are taken until you approve and convert.
                </p>
              </div>

              {/* Error */}
              {error && (
                <div className="mx-4 mt-3 flex items-start gap-2 p-2.5 rounded-lg"
                  style={{ background: "hsl(355 80% 50% / 0.1)", border: "1px solid hsl(355 80% 50% / 0.3)" }}>
                  <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: RED }} />
                  <p className="text-[10px]" style={{ color: "hsl(355 80% 72%)" }}>{error}</p>
                </div>
              )}

              {/* Queue stats */}
              {queueItems.length > 0 && (
                <div className="flex items-center gap-2 px-4 pt-3 flex-wrap">
                  <StatPill count={queueItems.filter(q => q.status === "queued").length}    label="queued"    color={TEAL}   />
                  <StatPill count={queueItems.filter(q => q.status === "approved").length}  label="approved"  color={GREEN}  />
                  <StatPill count={queueItems.filter(q => q.status === "rejected").length}  label="rejected"  color={MUTED}  />
                  <StatPill count={queueItems.filter(q => q.status === "converted").length} label="converted" color={AMBER}  />
                  <StatPill count={queueItems.filter(q => q.status === "failed").length}    label="failed"    color={RED}    />
                </div>
              )}

              {/* Queue filter */}
              {queueItems.length > 0 && (
                <div className="flex items-center gap-1 px-4 pt-2 flex-wrap">
                  {(["all", "queued", "approved", "rejected", "converted", "failed"] as const).map(f => (
                    <button key={f} type="button" onClick={() => setQueueFilter(f)}
                      className="px-2 py-1 rounded text-[7px] font-mono font-bold tracking-widest transition-all"
                      style={{
                        background: queueFilter === f ? `${AMBER}15` : "transparent",
                        border:     `1px solid ${queueFilter === f ? AMBER + "45" : "hsl(210 15% 22%)"}`,
                        color:      queueFilter === f ? AMBER : MUTED,
                      }}>
                      {f.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}

              {/* Loading */}
              {queueLoading && (
                <div className="flex items-center gap-2 py-10 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: AMBER }} />
                  <span className="text-[10px]" style={{ color: MUTED }}>Loading queue…</span>
                </div>
              )}

              {/* Empty */}
              {!queueLoading && queueItems.length === 0 && (
                <div className="flex flex-col items-center gap-3 py-14 text-center px-6">
                  <ListPlus className="w-8 h-8 opacity-10" style={{ color: AMBER }} />
                  <p className="text-[11px]" style={{ color: MUTED }}>
                    Queue is empty. Run analysis to generate suggestions, then{" "}
                    <strong style={{ color: AMBER }}>BUILD QUEUE</strong> to stage them.
                  </p>
                </div>
              )}

              {/* Queue cards */}
              {!queueLoading && visibleQueue.length > 0 && (
                <div className="px-3 pt-3 pb-8 space-y-2">
                  {visibleQueue.map(q => (
                    <QueueCard key={q.id} item={q}
                      onApprove={approveItem}
                      onReject={rejectItem}
                      onConvert={convertItem}
                      actionPending={actionPending}
                    />
                  ))}
                </div>
              )}

              {!queueLoading && queueItems.length > 0 && visibleQueue.length === 0 && (
                <div className="py-10 text-center px-6">
                  <p className="text-[10px]" style={{ color: MUTED }}>No {queueFilter} items.</p>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
