/**
 * components/PriorityPanel.tsx — Jarvis Task Prioritizer v1
 *
 * Shows:
 *   - Top-5 AI-ranked task recommendations with reasoning + score breakdown
 *   - Full ranked task list (all non-done tasks sorted by priority score)
 *   - Per-task factor breakdown (6 factors as mini progress bars)
 *   - Dependency / blocked indicators
 *   - Manual Recalculate button; auto-refreshes every 12 s
 */

import { useState, useEffect, useCallback } from "react";
import {
  X, RefreshCw, TrendingUp, Loader2, XCircle,
  ChevronDown, ChevronRight, Zap, AlertTriangle,
  CheckCircle2, Clock, BarChart2, Shield,
  Inbox, Star, ArrowRight, Lock,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Priority   = "low" | "medium" | "high";
type TaskStatus = "pending" | "in-progress" | "done" | "cancelled";

interface MasterTask {
  id:       string;
  title:    string;
  priority: Priority;
  status:   TaskStatus;
}

interface ScoreFactors {
  urgency:      number;
  dependencies: number;
  riskLevel:    number;
  impact:       number;
  difficulty:   number;
  blocked:      number;
}

interface PriorityScore {
  taskId:       string;
  total:        number;
  factors:      ScoreFactors;
  reasoning:    string;
  calculatedAt: string;
}

interface PlanInfo {
  planTitle:  string;
  phaseTitle: string;
  phaseOrder: number;
  effort:     string;
}

interface TaskRecommendation {
  rank:               number;
  task:               MasterTask;
  score:              PriorityScore;
  planInfo?:          PlanInfo;
  estimatedExecOrder: number;
}

interface RankedTask {
  task:     MasterTask;
  score?:   PriorityScore;
  planInfo?: PlanInfo;
}

interface PriorityPanelProps {
  isOpen:  boolean;
  onClose: () => void;
  apiBase: string;
}

// ─── Style constants ──────────────────────────────────────────────────────────

const TEAL    = "hsl(175 70% 58%)";
const MUTED   = "hsl(210 15% 38%)";
const GREEN   = "hsl(150 70% 58%)";
const AMBER   = "hsl(38 100% 60%)";
const RED     = "hsl(355 80% 65%)";
const PURPLE  = "hsl(264 80% 68%)";
const BLUE    = "hsl(196 80% 58%)";

const PRIORITY_COLOR: Record<Priority, string> = { high: RED, medium: AMBER, low: GREEN };

const FACTOR_META: Array<{ key: keyof ScoreFactors; label: string; color: string; icon: React.ElementType }> = [
  { key: "urgency",      label: "Urgency",      color: RED,    icon: Zap         },
  { key: "impact",       label: "Impact",        color: TEAL,   icon: TrendingUp  },
  { key: "blocked",      label: "Unblocked",     color: GREEN,  icon: CheckCircle2 },
  { key: "dependencies", label: "Unblocks",      color: PURPLE, icon: ArrowRight  },
  { key: "difficulty",   label: "Ease",          color: BLUE,   icon: BarChart2   },
  { key: "riskLevel",    label: "Low Risk",      color: AMBER,  icon: Shield      },
];

// ─── Score ring (mini donut) ──────────────────────────────────────────────────

function ScoreRing({ score, size = 44 }: { score: number; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = score >= 70 ? GREEN : score >= 45 ? AMBER : RED;
  return (
    <svg width={size} height={size} className="flex-shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="hsl(210 15% 12%)" strokeWidth={5} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={5}
        strokeDasharray={`${fill} ${circ - fill}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle"
        fontSize={size <= 44 ? 11 : 13} fontWeight="bold" fill={color}>
        {score}
      </text>
    </svg>
  );
}

// ─── Factor bar row ───────────────────────────────────────────────────────────

function FactorBar({ meta, value }: { meta: typeof FACTOR_META[number]; value: number }) {
  const { label, color, icon: Icon } = meta;
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="w-2.5 h-2.5 flex-shrink-0" style={{ color }} />
      <span className="text-[9px] font-mono w-14 flex-shrink-0" style={{ color: MUTED }}>{label}</span>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(210 15% 12%)" }}>
        <div className="h-full rounded-full transition-all duration-500"
          style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="text-[9px] font-mono w-6 text-right flex-shrink-0" style={{ color }}>{value}</span>
    </div>
  );
}

// ─── Recommendation card ──────────────────────────────────────────────────────

function RecommendationCard({ rec }: { rec: TaskRecommendation }) {
  const [open, setOpen] = useState(false);
  const rankColor = rec.rank === 1 ? AMBER : rec.rank === 2 ? MUTED : "hsl(210 15% 30%)";

  return (
    <div className="rounded-xl mb-2 overflow-hidden"
      style={{
        border:     `1px solid ${open ? `${TEAL}35` : "hsl(210 15% 14%)"}`,
        background: rec.rank === 1 ? `${TEAL}07` : "hsl(220 20% 6%)",
      }}>
      {/* Header */}
      <button type="button" className="flex items-center gap-2 w-full text-left px-3 py-2.5"
        onClick={() => setOpen(v => !v)}>
        {/* Rank badge */}
        <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold"
          style={{ background: `${rankColor}20`, border: `1px solid ${rankColor}50`, color: rankColor }}>
          {rec.rank === 1 ? <Star className="w-3 h-3" /> : rec.rank}
        </div>

        {/* Score ring */}
        <ScoreRing score={rec.score.total} size={40} />

        {/* Title + reasoning */}
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold leading-snug truncate" style={{ color: "hsl(196 35% 82%)" }}>
            {rec.task.title}
          </p>
          <p className="text-[9px] leading-snug mt-0.5 line-clamp-2" style={{ color: MUTED }}>
            {rec.score.reasoning}
          </p>
        </div>

        {/* Expand chevron */}
        {open
          ? <ChevronDown  className="w-3 h-3 flex-shrink-0" style={{ color: MUTED }} />
          : <ChevronRight className="w-3 h-3 flex-shrink-0" style={{ color: MUTED }} />}
      </button>

      {/* Expanded breakdown */}
      {open && (
        <div className="px-3 pb-3 border-t space-y-2" style={{ borderColor: "hsl(210 15% 10%)" }}>
          {/* Badges */}
          <div className="flex items-center gap-2 flex-wrap pt-2">
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full"
              style={{ background: `${PRIORITY_COLOR[rec.task.priority]}18`, border: `1px solid ${PRIORITY_COLOR[rec.task.priority]}40`, color: PRIORITY_COLOR[rec.task.priority] }}>
              {rec.task.priority.toUpperCase()}
            </span>
            {rec.planInfo && (
              <>
                <span className="text-[9px] font-mono" style={{ color: PURPLE }}>
                  Ph.{rec.planInfo.phaseOrder} · {rec.planInfo.phaseTitle}
                </span>
                <span className="text-[9px] font-mono" style={{ color: MUTED }}>
                  {rec.planInfo.effort} effort
                </span>
              </>
            )}
            {rec.score.factors.blocked <= 20 && (
              <span className="text-[9px] flex items-center gap-1 font-mono"
                style={{ color: AMBER }}>
                <Lock className="w-2.5 h-2.5" /> blocked
              </span>
            )}
          </div>

          {/* Factor bars */}
          <div className="space-y-1">
            {FACTOR_META.map(m => (
              <FactorBar key={m.key} meta={m} value={rec.score.factors[m.key]} />
            ))}
          </div>

          {/* Execution order note */}
          <p className="text-[9px] font-mono" style={{ color: MUTED }}>
            Estimated execution order: #{rec.estimatedExecOrder}
            {" · "}Scored at {new Date(rec.score.calculatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Ranked task row (compact list) ──────────────────────────────────────────

function RankedRow({ item, index }: { item: RankedTask; index: number }) {
  const [open, setOpen] = useState(false);
  const score    = item.score?.total ?? null;
  const barColor = score === null ? MUTED : score >= 70 ? GREEN : score >= 45 ? AMBER : RED;
  const isBlocked = (item.score?.factors.blocked ?? 100) <= 20;

  return (
    <div className="border-b last:border-0" style={{ borderColor: "hsl(210 15% 10%)" }}>
      <button type="button" className="flex items-center gap-2 w-full text-left py-2"
        onClick={() => setOpen(v => !v)}>
        <span className="w-5 text-right text-[9px] font-mono flex-shrink-0" style={{ color: MUTED }}>
          #{index + 1}
        </span>

        {/* Score pill */}
        <span className="w-8 text-[10px] font-bold font-mono text-center flex-shrink-0"
          style={{ color: barColor }}>
          {score ?? "—"}
        </span>

        {/* Score bar */}
        <div className="w-12 h-1.5 rounded-full overflow-hidden flex-shrink-0" style={{ background: "hsl(210 15% 11%)" }}>
          {score !== null && (
            <div className="h-full rounded-full" style={{ width: `${score}%`, background: barColor }} />
          )}
        </div>

        {/* Task title */}
        <p className="flex-1 text-[11px] truncate text-left" style={{ color: "hsl(196 25% 72%)" }}>
          {item.task.title}
        </p>

        {/* Indicators */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {isBlocked && <Lock className="w-2.5 h-2.5" style={{ color: AMBER }} />}
          <span className="text-[9px] font-mono"
            style={{ color: PRIORITY_COLOR[item.task.priority] }}>
            {item.task.priority[0].toUpperCase()}
          </span>
          {item.task.status === "in-progress" && (
            <Clock className="w-2.5 h-2.5" style={{ color: BLUE }} />
          )}
          {open ? <ChevronDown className="w-2.5 h-2.5" style={{ color: MUTED }} />
                : <ChevronRight className="w-2.5 h-2.5" style={{ color: MUTED }} />}
        </div>
      </button>

      {/* Expanded factor breakdown */}
      {open && item.score && (
        <div className="pb-2 pl-7 pr-1 space-y-1">
          {FACTOR_META.map(m => (
            <FactorBar key={m.key} meta={m} value={item.score!.factors[m.key]} />
          ))}
          {item.planInfo && (
            <p className="text-[9px] font-mono pt-1" style={{ color: MUTED }}>
              {item.planInfo.planTitle} · Phase {item.planInfo.phaseOrder}: {item.planInfo.phaseTitle} · {item.planInfo.effort} effort
            </p>
          )}
          <p className="text-[9px] italic" style={{ color: MUTED }}>
            {item.score.reasoning}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

const POLL_MS = 12_000;

export default function PriorityPanel({ isOpen, onClose, apiBase }: PriorityPanelProps) {
  const [recs,         setRecs]         = useState<TaskRecommendation[]>([]);
  const [ranked,       setRanked]       = useState<RankedTask[]>([]);
  const [totalPending, setTotalPending] = useState(0);
  const [totalScored,  setTotalScored]  = useState(0);
  const [lastCalc,     setLastCalc]     = useState<string | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [recalcing,    setRecalcing]    = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [showAll,      setShowAll]      = useState(false);

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [recRes, rankRes] = await Promise.all([
        fetch(`${apiBase}api/priority/recommendations`),
        fetch(`${apiBase}api/priority/ranked`),
      ]);
      const recData  = await recRes.json()  as { ok: boolean; recommendations?: TaskRecommendation[]; totalPending?: number; totalScored?: number; lastCalculated?: string | null; error?: string };
      const rankData = await rankRes.json() as { ok: boolean; ranked?: RankedTask[]; error?: string };

      if (!recData.ok) throw new Error(recData.error ?? "Failed to load recommendations");
      setRecs(recData.recommendations ?? []);
      setTotalPending(recData.totalPending ?? 0);
      setTotalScored(recData.totalScored ?? 0);
      setLastCalc(recData.lastCalculated ?? null);
      if (rankData.ok) setRanked(rankData.ranked ?? []);
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : "Network error");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [apiBase]);

  // Initial load + polling
  useEffect(() => {
    if (!isOpen) return;
    fetchAll();
    const id = setInterval(() => fetchAll(true), POLL_MS);
    return () => clearInterval(id);
  }, [isOpen, fetchAll]);

  const recalculate = useCallback(async () => {
    setRecalcing(true); setError(null);
    try {
      const res  = await fetch(`${apiBase}api/priority/recalculate`, { method: "POST" });
      const data = await res.json() as { ok: boolean; scored?: number; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Recalculation failed");
      await fetchAll(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setRecalcing(false);
    }
  }, [apiBase, fetchAll]);

  const hasScores = totalScored > 0;
  const displayedRanked = showAll ? ranked : ranked.slice(0, 15);

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-30 sm:hidden"
          style={{ background: "hsl(220 30% 4% / 0.6)" }}
          onClick={onClose} aria-hidden="true" />
      )}

      <aside
        data-testid="priority-panel"
        className="fixed top-0 right-0 h-full z-40 flex flex-col transition-transform duration-300 ease-in-out"
        style={{
          width:      "min(100vw, 480px)",
          transform:  isOpen ? "translateX(0)" : "translateX(100%)",
          background: "hsl(222 28% 7%)",
          borderLeft: "1px solid hsl(210 15% 15%)",
          boxShadow:  isOpen ? "-4px 0 32px hsl(0 0% 0% / 0.5)" : "none",
        }}
        aria-label="Priority panel"
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b"
          style={{ borderColor: "hsl(210 15% 14%)" }}>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4" style={{ color: TEAL }} />
            <h2 className="text-sm font-bold tracking-widest" style={{ color: TEAL }}>PRIORITY</h2>
            {hasScores && (
              <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full"
                style={{ background: `${TEAL}18`, border: `1px solid ${TEAL}40`, color: TEAL }}>
                {totalScored} scored
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={recalculate} disabled={recalcing || loading}
              title="Recalculate all priority scores"
              className="flex items-center gap-1 px-2 h-7 rounded-lg border text-[9px] font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40"
              style={{ background: `${TEAL}12`, borderColor: `${TEAL}35`, color: TEAL }}>
              {recalcing
                ? <><Loader2 className="w-3 h-3 animate-spin" /> SCORING…</>
                : <><RefreshCw className="w-3 h-3" /> RECALCULATE</>}
            </button>
            <button type="button" onClick={onClose} aria-label="Close priority panel"
              className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95"
              style={{ background: "transparent", borderColor: "hsl(210 15% 28%)" }}>
              <X className="w-3.5 h-3.5" style={{ color: "hsl(210 20% 55%)" }} />
            </button>
          </div>
        </header>

        {/* ── Error ──────────────────────────────────────────────────────── */}
        {error && (
          <div className="mx-3 mt-2 flex items-start gap-2 p-2.5 rounded-lg flex-shrink-0"
            style={{ background: "hsl(355 80% 50% / 0.1)", border: "1px solid hsl(355 80% 50% / 0.3)" }}>
            <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: RED }} />
            <p className="text-[10px]" style={{ color: "hsl(355 80% 72%)" }}>{error}</p>
          </div>
        )}

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">

          {/* Stats bar */}
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { label: "PENDING",  value: totalPending, color: TEAL  },
              { label: "SCORED",   value: totalScored,  color: BLUE  },
              { label: "TOP REC",  value: recs.length,  color: AMBER },
            ].map(s => (
              <div key={s.label} className="rounded-xl p-2 text-center"
                style={{ background: `${s.color}10`, border: `1px solid ${s.color}25` }}>
                <p className="text-sm font-bold font-mono" style={{ color: s.color }}>{s.value}</p>
                <p className="text-[8px] font-mono tracking-widest mt-0.5" style={{ color: `${s.color}90` }}>
                  {s.label}
                </p>
              </div>
            ))}
          </div>

          {/* Last calculated */}
          {lastCalc && (
            <p className="text-[9px] font-mono text-center -mt-2" style={{ color: MUTED }}>
              scored {new Date(lastCalc).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              {" · "}auto-refreshes every {POLL_MS / 1000}s
            </p>
          )}

          {loading && recs.length === 0 ? (
            <div className="flex items-center justify-center py-12 gap-2" style={{ color: MUTED }}>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-[11px]">Loading scores…</span>
            </div>
          ) : !hasScores ? (
            /* No scores yet — prompt to recalculate */
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <BarChart2 className="w-8 h-8 opacity-15" style={{ color: TEAL }} />
              <p className="text-[11px]" style={{ color: MUTED }}>
                No priority scores yet. Click <strong style={{ color: TEAL }}>RECALCULATE</strong> to score all active tasks.
              </p>
              <button type="button" onClick={recalculate} disabled={recalcing}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[11px] font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40"
                style={{ background: `${TEAL}14`, border: `1px solid ${TEAL}40`, color: TEAL }}>
                {recalcing
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> SCORING…</>
                  : <><Zap className="w-3.5 h-3.5" /> CALCULATE NOW</>}
              </button>
            </div>
          ) : (
            <>
              {/* ── Top 5 Recommendations ──────────────────────────────── */}
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <Star className="w-3 h-3" style={{ color: AMBER }} />
                  <p className="text-[9px] font-mono tracking-widest" style={{ color: MUTED }}>
                    TOP RECOMMENDATIONS
                  </p>
                </div>
                {recs.length === 0 ? (
                  <div className="flex items-center gap-2 py-4 px-3 rounded-xl"
                    style={{ background: "hsl(220 20% 6.5%)", border: "1px solid hsl(210 15% 14%)" }}>
                    <Inbox className="w-4 h-4 opacity-15" style={{ color: TEAL }} />
                    <p className="text-[10px]" style={{ color: MUTED }}>
                      No pending tasks to recommend. All tasks may be complete!
                    </p>
                  </div>
                ) : (
                  recs.map(rec => <RecommendationCard key={rec.task.id} rec={rec} />)
                )}
              </section>

              {/* ── All tasks ranked ───────────────────────────────────── */}
              {ranked.length > 0 && (
                <section>
                  <p className="text-[9px] font-mono tracking-widest mb-1" style={{ color: MUTED }}>
                    ALL TASKS RANKED ({ranked.length})
                  </p>
                  <div className="rounded-xl overflow-hidden"
                    style={{ border: "1px solid hsl(210 15% 14%)", background: "hsl(220 20% 5.5%)" }}>
                    <div className="px-3 py-1">
                      {displayedRanked.map((item, i) => (
                        <RankedRow key={item.task.id} item={item} index={i} />
                      ))}
                    </div>
                    {ranked.length > 15 && (
                      <button type="button"
                        onClick={() => setShowAll(v => !v)}
                        className="w-full py-2 text-[9px] font-mono border-t transition-all"
                        style={{ borderColor: "hsl(210 15% 12%)", color: MUTED }}>
                        {showAll ? `Show top 15 only` : `Show all ${ranked.length} tasks`}
                      </button>
                    )}
                  </div>
                </section>
              )}

              {/* ── Score factor legend ─────────────────────────────────── */}
              <section>
                <p className="text-[9px] font-mono tracking-widest mb-1.5" style={{ color: MUTED }}>
                  SCORE FACTOR WEIGHTS
                </p>
                <div className="grid grid-cols-2 gap-1">
                  {[
                    { label: "Urgency",       weight: "25%", color: RED    },
                    { label: "Impact",         weight: "25%", color: TEAL   },
                    { label: "Unblocked",      weight: "15%", color: GREEN  },
                    { label: "Unblocks others",weight: "15%", color: PURPLE },
                    { label: "Ease",           weight: "10%", color: BLUE   },
                    { label: "Low Risk",       weight: "10%", color: AMBER  },
                  ].map(f => (
                    <div key={f.label} className="flex items-center gap-1.5 py-0.5">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: f.color }} />
                      <span className="text-[9px] font-mono flex-1" style={{ color: MUTED }}>{f.label}</span>
                      <span className="text-[9px] font-mono font-bold" style={{ color: f.color }}>{f.weight}</span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
