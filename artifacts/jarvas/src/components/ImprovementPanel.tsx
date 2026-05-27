/**
 * components/ImprovementPanel.tsx — Autonomous Improvement Loop v1
 *
 * Scans the Jarvis system state and presents Claude-generated
 * improvement suggestions. Each suggestion can be:
 *   - Converted → a standalone work order (visible in ORDERS panel)
 *   - Dismissed → archived from the open queue
 *
 * Analysis is read-only — no code execution, no autonomous actions.
 */

import { useState, useEffect, useCallback } from "react";
import {
  X, Cpu, Loader2, XCircle, RefreshCw,
  ChevronDown, ChevronRight, AlertTriangle,
  TrendingUp, Zap, Sparkles,
  Database, Layout, MousePointerClick,
  ListX, ClipboardList, ShieldCheck,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type AnalysisCategory =
  | "task_backlog" | "failed_execution" | "repeated_warnings"
  | "low_completion_agent" | "missing_validation" | "empty_data_store"
  | "route_without_panel" | "panel_without_actions";

type SuggestionSeverity = "critical" | "high" | "medium" | "low";
type SuggestionStatus   = "open" | "converted" | "dismissed";

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

interface ImprovementPanelProps {
  isOpen:  boolean;
  onClose: () => void;
  apiBase: string;
}

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

const RISK_COLOR: Record<string, string> = {
  high: RED, medium: AMBER, low: GREEN,
};

const SEV_ORDER: Record<SuggestionSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

// ─── Suggestion card ──────────────────────────────────────────────────────────

function SuggestionCard({
  s, onConvert, onDismiss, converting, dismissing,
}: {
  s:          ImprovementSuggestion;
  onConvert:  (id: string) => void;
  onDismiss:  (id: string) => void;
  converting: string | null;
  dismissing: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const cat        = CAT_META[s.category] ?? CAT_META.task_backlog;
  const sev        = SEV_META[s.severity];
  const CatIcon    = cat.icon;
  const isConverting = converting === s.id;
  const isDismissing = dismissing  === s.id;
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
          {/* Badge row */}
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
                style={{ color: s.status === "converted" ? GREEN : MUTED,
                         background: `${s.status === "converted" ? GREEN : MUTED}12` }}>
                {s.status.toUpperCase()}
              </span>
            )}
          </div>
          {/* Title */}
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

      {/* Expanded body */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {/* Reasoning */}
          <div>
            <p className="text-[6.5px] font-mono font-bold tracking-widest mb-0.5" style={{ color: MUTED }}>REASONING</p>
            <p className="text-[8px] leading-relaxed" style={{ color: "hsl(196 20% 62%)" }}>{s.reasoning}</p>
          </div>

          {/* Impact */}
          <div className="rounded px-2 py-1.5"
            style={{ background: `${TEAL}08`, border: `1px solid ${TEAL}20` }}>
            <div className="flex items-center gap-1 mb-0.5">
              <TrendingUp className="w-2.5 h-2.5 flex-shrink-0" style={{ color: TEAL }} />
              <p className="text-[6.5px] font-mono font-bold tracking-widest" style={{ color: TEAL }}>ESTIMATED IMPACT</p>
            </div>
            <p className="text-[7.5px]" style={{ color: "hsl(175 50% 65%)" }}>{s.estimatedImpact}</p>
          </div>

          {/* Suggested work order */}
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
            {s.suggestedWorkOrder.inputs.length > 0 && (
              <div className="mb-1">
                {s.suggestedWorkOrder.inputs.map((inp, i) => (
                  <p key={i} className="text-[7px]" style={{ color: MUTED }}>· {inp}</p>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap mt-1">
              <span className="text-[7px]" style={{ color: "hsl(196 25% 55%)" }}>
                → {s.suggestedWorkOrder.expectedOutput}
              </span>
              <span className="text-[6px] font-mono px-1 rounded"
                style={{
                  background: `${RISK_COLOR[s.suggestedWorkOrder.riskLevel] ?? MUTED}12`,
                  color: RISK_COLOR[s.suggestedWorkOrder.riskLevel] ?? MUTED,
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

      {/* Action buttons */}
      {!isDone && (
        <div className="flex items-center gap-1.5 px-3 pb-3">
          <button type="button" onClick={() => onConvert(s.id)} disabled={isConverting || isDismissing}
            className="flex items-center gap-1 flex-1 justify-center py-1.5 rounded-lg font-bold text-[8px] tracking-widest transition-all active:scale-95 disabled:opacity-40"
            style={{ background: `${AMBER}15`, border: `1px solid ${AMBER}45`, color: AMBER }}>
            {isConverting
              ? <><Loader2 className="w-3 h-3 animate-spin" /> CONVERTING…</>
              : <><ClipboardList className="w-3 h-3" /> CONVERT TO ORDER</>}
          </button>
          <button type="button" onClick={() => onDismiss(s.id)} disabled={isDismissing || isConverting}
            className="w-8 h-8 flex items-center justify-center rounded-lg border transition-all active:scale-95 disabled:opacity-40"
            style={{ borderColor: "hsl(210 15% 24%)", background: "transparent" }}
            title="Dismiss suggestion">
            {isDismissing
              ? <Loader2 className="w-3 h-3 animate-spin" style={{ color: MUTED }} />
              : <X className="w-3 h-3" style={{ color: MUTED }} />}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Stats pill ───────────────────────────────────────────────────────────────

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
  const [suggestions, setSuggestions] = useState<ImprovementSuggestion[]>([]);
  const [meta,        setMeta]        = useState<AnalysisMeta | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [analyzing,   setAnalyzing]   = useState(false);
  const [scanSummary, setScanSummary] = useState<string | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [converting,  setConverting]  = useState<string | null>(null);
  const [dismissing,  setDismissing]  = useState<string | null>(null);
  const [filter,      setFilter]      = useState<SuggestionStatus | "all">("all");

  // ── Fetch saved suggestions ──────────────────────────────────────────────
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

  useEffect(() => { if (isOpen) void fetchSuggestions(); }, [isOpen, fetchSuggestions]);

  // ── Run analysis ─────────────────────────────────────────────────────────
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
      // refresh meta timestamp
      await fetchSuggestions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally { setAnalyzing(false); }
  }, [apiBase, fetchSuggestions]);

  // ── Convert suggestion → work order ─────────────────────────────────────
  const convertSuggestion = useCallback(async (id: string) => {
    setConverting(id); setError(null);
    try {
      const res  = await fetch(`${apiBase}api/autonomy/suggestions/${id}/convert`, { method: "POST" });
      const data = await res.json() as { ok: boolean; suggestion?: ImprovementSuggestion; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Conversion failed");
      if (data.suggestion) setSuggestions(prev => prev.map(s => s.id === id ? data.suggestion! : s));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally { setConverting(null); }
  }, [apiBase]);

  // ── Dismiss suggestion ───────────────────────────────────────────────────
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

  // ── Derived state ────────────────────────────────────────────────────────
  const open      = suggestions.filter(s => s.status === "open").length;
  const converted = suggestions.filter(s => s.status === "converted").length;
  const dismissed = suggestions.filter(s => s.status === "dismissed").length;
  const autoCount = suggestions.filter(s => s.status === "open" && s.autoExecutable).length;

  const visible = suggestions
    .filter(s => filter === "all" || s.status === filter)
    .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

  return (
    <>
      {/* Mobile backdrop */}
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

        {/* ─ Header ─────────────────────────────────────────────────────── */}
        <header className="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b"
          style={{ borderColor: "hsl(210 15% 14%)" }}>
          <div className="flex items-center gap-2 flex-wrap">
            <Cpu className="w-4 h-4 flex-shrink-0" style={{ color: TEAL }} />
            <h2 className="text-sm font-bold tracking-widest" style={{ color: TEAL }}>IMPROVE</h2>
            {open > 0 && (
              <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full"
                style={{ background: `${TEAL}18`, border: `1px solid ${TEAL}40`, color: TEAL }}>
                {open} open
              </span>
            )}
            {autoCount > 0 && (
              <span className="flex items-center gap-0.5 text-[8px] font-mono px-1.5 py-0.5 rounded-full"
                style={{ background: `${GREEN}12`, border: `1px solid ${GREEN}35`, color: GREEN }}>
                <Zap className="w-2.5 h-2.5" />{autoCount} auto
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button type="button" onClick={fetchSuggestions} disabled={loading || analyzing}
              className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95"
              style={{ background: "transparent", borderColor: "hsl(210 15% 28%)" }} title="Refresh suggestions">
              <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`}
                style={{ color: "hsl(210 20% 55%)" }} />
            </button>
            <button type="button" onClick={onClose} aria-label="Close improvement panel"
              className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95"
              style={{ background: "transparent", borderColor: "hsl(210 15% 28%)" }}>
              <X className="w-3.5 h-3.5" style={{ color: "hsl(210 20% 55%)" }} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* ─ Analyze action ─────────────────────────────────────────────── */}
          <div className="px-4 py-3 border-b space-y-2" style={{ borderColor: "hsl(210 15% 12%)" }}>
            <button type="button" onClick={runAnalysis} disabled={analyzing || loading}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-bold text-[11px] tracking-widest transition-all active:scale-95 disabled:opacity-40"
              style={{ background: `${TEAL}18`, border: `1px solid ${TEAL}45`, color: TEAL }}>
              {analyzing
                ? <><Loader2 className="w-4 h-4 animate-spin" /> ANALYZING SYSTEM…</>
                : <><Sparkles className="w-4 h-4" /> RUN SELF-IMPROVEMENT ANALYSIS</>}
            </button>
            <p className="text-[8px] text-center" style={{ color: MUTED }}>
              Scans work orders, executions, data stores, and source coverage — read-only.
            </p>
            {scanSummary && (
              <p className="text-[7.5px] text-center font-mono" style={{ color: TEAL }}>
                Scan: {scanSummary}
              </p>
            )}
            {meta?.ranAt && !scanSummary && (
              <p className="text-[7.5px] text-center font-mono" style={{ color: MUTED }}>
                Last analyzed: {new Date(meta.ranAt).toLocaleString()} · {meta.scanSummary}
              </p>
            )}
          </div>

          {/* ─ Error banner ───────────────────────────────────────────────── */}
          {error && (
            <div className="mx-4 mt-3 flex items-start gap-2 p-2.5 rounded-lg"
              style={{ background: "hsl(355 80% 50% / 0.1)", border: "1px solid hsl(355 80% 50% / 0.3)" }}>
              <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: RED }} />
              <p className="text-[10px]" style={{ color: "hsl(355 80% 72%)" }}>{error}</p>
            </div>
          )}

          {/* ─ Stats row ──────────────────────────────────────────────────── */}
          {suggestions.length > 0 && (
            <div className="flex items-center gap-2 px-4 pt-3 flex-wrap">
              <StatPill count={open}      label="open"      color={TEAL}  />
              <StatPill count={converted} label="converted" color={GREEN} />
              <StatPill count={dismissed} label="dismissed" color={MUTED} />
            </div>
          )}

          {/* ─ Filter tabs ────────────────────────────────────────────────── */}
          {suggestions.length > 0 && (
            <div className="flex items-center gap-1 px-4 pt-2">
              {(["all", "open", "converted", "dismissed"] as const).map(f => (
                <button key={f} type="button" onClick={() => setFilter(f)}
                  className="px-2 py-1 rounded text-[7.5px] font-mono font-bold tracking-widest transition-all"
                  style={{
                    background:  filter === f ? `${TEAL}18` : "transparent",
                    border:      `1px solid ${filter === f ? TEAL + "45" : "hsl(210 15% 22%)"}`,
                    color:       filter === f ? TEAL : MUTED,
                  }}>
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          )}

          {/* ─ Loading state ──────────────────────────────────────────────── */}
          {(loading || analyzing) && (
            <div className="flex items-center gap-2 py-10 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: TEAL }} />
              <span className="text-[10px]" style={{ color: MUTED }}>
                {analyzing ? "Scanning system & generating suggestions…" : "Loading…"}
              </span>
            </div>
          )}

          {/* ─ Empty state ────────────────────────────────────────────────── */}
          {!loading && !analyzing && suggestions.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-14 text-center px-6">
              <Cpu className="w-8 h-8 opacity-10" style={{ color: TEAL }} />
              <p className="text-[11px]" style={{ color: MUTED }}>
                No suggestions yet. Click{" "}
                <strong style={{ color: TEAL }}>RUN SELF-IMPROVEMENT ANALYSIS</strong>{" "}
                to scan the system.
              </p>
            </div>
          )}

          {/* ─ Suggestion cards ───────────────────────────────────────────── */}
          {!loading && !analyzing && visible.length > 0 && (
            <div className="px-3 pt-3 pb-8 space-y-2">
              {visible.map(s => (
                <SuggestionCard key={s.id} s={s}
                  onConvert={convertSuggestion}
                  onDismiss={dismissSuggestion}
                  converting={converting}
                  dismissing={dismissing}
                />
              ))}
            </div>
          )}

          {/* ─ No matches for filter ──────────────────────────────────────── */}
          {!loading && !analyzing && suggestions.length > 0 && visible.length === 0 && (
            <div className="py-10 text-center px-6">
              <p className="text-[10px]" style={{ color: MUTED }}>
                No {filter} suggestions.
              </p>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
