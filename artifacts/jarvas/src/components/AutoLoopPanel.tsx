/**
 * components/AutoLoopPanel.tsx — Autonomous Dev Loop v1 (SAFE MODE) panel
 *
 * Provides:
 *   - AUTO MODE toggle (OFF by default, safety warning displayed)
 *   - Orchestration dashboard: queued / running / completed / failed / rollback available
 *   - Live activity stream (polls every 4 s)
 *   - Safety lockout banner with manual reset
 *
 * AUTO MODE limitations enforced by the backend:
 *   - Max 3 actions queued
 *   - Low-risk approved actions only
 *   - No package/dependency changes
 *   - No shell execution
 *   - No file deletes
 *   - Auto-checkpoint before every execution
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  X, RefreshCw, Bot, Power, PowerOff, AlertTriangle,
  CheckCircle2, XCircle, Clock, Loader2, Zap,
  Shield, Lock, Unlock, Activity, ChevronDown, ChevronRight,
  RotateCcw, Inbox, Play,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AutoLoopState {
  enabled:          boolean;
  lockedOut:        boolean;
  lockoutReason?:   string;
  consecutiveFails: number;
  processing:       boolean;
  retries:          Record<string, number>;
  executionIds:     string[];
  lastProcessedAt?: string;
  updatedAt:        string;
}

interface QueuedAction {
  id:          string;
  title:       string;
  description: string;
  riskLevel:   string;
  proposedBy:  string;
}

interface LoopStats {
  queued:            number;
  running:           number;
  completed:         number;
  failed:            number;
  rollbackAvailable: number;
}

type ActivityType = "info" | "success" | "warning" | "error" | "lockout";

interface ActivityEvent {
  id:           string;
  timestamp:    string;
  type:         ActivityType;
  message:      string;
  actionId?:    string;
  executionId?: string;
}

interface AutoLoopPanelProps {
  isOpen:  boolean;
  onClose: () => void;
  apiBase: string;
}

// ─── Style helpers ────────────────────────────────────────────────────────────

const ACTIVITY_STYLE: Record<ActivityType, { color: string; Icon: React.ElementType }> = {
  info:    { color: "hsl(196 60% 58%)",  Icon: Activity    },
  success: { color: "hsl(150 70% 58%)",  Icon: CheckCircle2 },
  warning: { color: "hsl(38 100% 62%)",  Icon: AlertTriangle },
  error:   { color: "hsl(355 80% 65%)",  Icon: XCircle      },
  lockout: { color: "hsl(310 90% 65%)",  Icon: Lock         },
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ─── Stats cell ───────────────────────────────────────────────────────────────

function StatCell({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl p-2.5 text-center"
      style={{ background: `${color}10`, border: `1px solid ${color}28` }}>
      <p className="text-lg font-bold font-mono" style={{ color }}>{value}</p>
      <p className="text-[9px] font-mono tracking-widest mt-0.5" style={{ color: `${color}90` }}>
        {label}
      </p>
    </div>
  );
}

// ─── Activity event row ───────────────────────────────────────────────────────

function ActivityRow({ event }: { event: ActivityEvent }) {
  const { color, Icon } = ACTIVITY_STYLE[event.type] ?? ACTIVITY_STYLE.info;
  return (
    <div className="flex items-start gap-2 py-1.5 border-b last:border-0"
      style={{ borderColor: "hsl(210 15% 12%)" }}>
      <Icon className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color }} />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] leading-snug" style={{ color: "hsl(196 25% 62%)" }}>
          {event.message}
        </p>
        <p className="text-[9px] font-mono mt-0.5" style={{ color: "hsl(210 15% 30%)" }}>
          {fmtTime(event.timestamp)}
        </p>
      </div>
    </div>
  );
}

// ─── Queue card ───────────────────────────────────────────────────────────────

function QueueCard({ action, retries }: { action: QueuedAction; retries: number }) {
  return (
    <div className="flex items-start gap-2 py-2 px-3 rounded-xl mb-1.5"
      style={{ background: "hsl(220 20% 6.5%)", border: "1px solid hsl(210 15% 16%)" }}>
      <Clock className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: "hsl(38 100% 60%)" }} />
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold truncate" style={{ color: "hsl(196 40% 80%)" }}>
          {action.title}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[9px] font-mono" style={{ color: "hsl(210 15% 40%)" }}>
            {action.proposedBy}
          </span>
          {retries > 0 && (
            <span className="text-[9px] font-mono px-1 rounded"
              style={{ background: "hsl(38 100% 55% / 0.12)", color: "hsl(38 100% 60%)" }}>
              retry {retries}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Safety warning accordion ─────────────────────────────────────────────────

function SafetyWarning() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl overflow-hidden mb-3"
      style={{ border: "1px solid hsl(38 100% 55% / 0.35)", background: "hsl(38 100% 55% / 0.06)" }}>
      <button type="button" className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
        onClick={() => setOpen(v => !v)}>
        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(38 100% 62%)" }} />
        <span className="text-[11px] font-bold flex-1" style={{ color: "hsl(38 100% 68%)" }}>
          AUTO MODE SAFETY NOTICE
        </span>
        {open ? <ChevronDown className="w-3 h-3" style={{ color: "hsl(38 100% 60%)" }} />
               : <ChevronRight className="w-3 h-3" style={{ color: "hsl(38 100% 60%)" }} />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-1.5 border-t" style={{ borderColor: "hsl(38 100% 55% / 0.2)" }}>
          {[
            "Only APPROVED, LOW-risk actions are ever executed automatically.",
            "Every execution auto-creates a safety checkpoint first.",
            "File deletion, package changes, shell commands, and deploys are permanently blocked.",
            "Safety lockout engages after 3 consecutive failures — requires manual reset.",
            "Auto processing only runs while this panel is open.",
            "Max 3 actions queued at once. No execution runs without prior dry-run approval.",
          ].map((line, i) => (
            <p key={i} className="text-[10px] flex gap-2" style={{ color: "hsl(38 90% 62%)" }}>
              <span style={{ color: "hsl(38 100% 55%)" }}>·</span>{line}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const POLL_MS = 4000;

export default function AutoLoopPanel({ isOpen, onClose, apiBase }: AutoLoopPanelProps) {
  const [state,    setState_]   = useState<AutoLoopState | null>(null);
  const [queue,    setQueue]    = useState<QueuedAction[]>([]);
  const [stats,    setStats]    = useState<LoopStats>({ queued: 0, running: 0, completed: 0, failed: 0, rollbackAvailable: 0 });
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [toggling, setToggling] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [actOpen,  setActOpen]  = useState(true);
  const [qOpen,    setQOpen]    = useState(true);
  const tickRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Data fetchers ───────────────────────────────────────────────────────────

  const fetchState = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [stRes, acRes] = await Promise.all([
        fetch(`${apiBase}api/auto-loop/state`),
        fetch(`${apiBase}api/auto-loop/activity`),
      ]);
      const stData = await stRes.json() as {
        ok: boolean; state?: AutoLoopState; queue?: QueuedAction[];
        stats?: LoopStats; error?: string;
      };
      const acData = await acRes.json() as { ok: boolean; activity?: ActivityEvent[]; error?: string };

      if (!stData.ok) throw new Error(stData.error ?? "Failed to load state");
      setState_(stData.state ?? null);
      setQueue(stData.queue ?? []);
      setStats(stData.stats ?? { queued: 0, running: 0, completed: 0, failed: 0, rollbackAvailable: 0 });
      if (acData.ok) setActivity(acData.activity ?? []);
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : "Network error");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [apiBase]);

  const triggerTick = useCallback(async () => {
    try {
      await fetch(`${apiBase}api/auto-loop/tick`, { method: "POST" });
      await fetchState(true);
    } catch { /* silent */ }
  }, [apiBase, fetchState]);

  // ── Polling + auto-tick ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) {
      if (tickRef.current) clearInterval(tickRef.current);
      return;
    }
    fetchState();
    tickRef.current = setInterval(async () => {
      await fetchState(true);
      // Also trigger a processing tick if enabled and not locked
      if (state?.enabled && !state?.lockedOut && !state?.processing) {
        await triggerTick();
      }
    }, POLL_MS);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [isOpen, fetchState, triggerTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ─────────────────────────────────────────────────────────────────

  const toggle = useCallback(async () => {
    if (!state) return;
    setToggling(true); setError(null);
    try {
      const verb = state.enabled ? "disable" : "enable";
      const res  = await fetch(`${apiBase}api/auto-loop/${verb}`, { method: "POST" });
      const data = await res.json() as { ok: boolean; state?: AutoLoopState; error?: string };
      if (!data.ok) throw new Error(data.error ?? `Failed to ${verb}`);
      setState_(data.state ?? null);
      await fetchState(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setToggling(false);
    }
  }, [state, apiBase, fetchState]);

  const resetLockout = useCallback(async () => {
    setResetting(true); setError(null);
    try {
      const res  = await fetch(`${apiBase}api/auto-loop/reset-lockout`, { method: "POST" });
      const data = await res.json() as { ok: boolean; state?: AutoLoopState; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Failed to reset lockout");
      setState_(data.state ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setResetting(false);
    }
  }, [apiBase]);

  // ── Derived UI state ────────────────────────────────────────────────────────

  const enabled   = state?.enabled   ?? false;
  const lockedOut = state?.lockedOut ?? false;
  const processing = state?.processing ?? false;

  const statusColor =
    lockedOut ? "hsl(310 90% 65%)" :
    enabled   ? "hsl(150 70% 60%)" :
                "hsl(210 15% 40%)";
  const statusLabel =
    lockedOut  ? "LOCKED OUT" :
    processing ? "PROCESSING" :
    enabled    ? "ACTIVE"     :
                 "INACTIVE";

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-30 sm:hidden"
          style={{ background: "hsl(220 30% 4% / 0.6)" }}
          onClick={onClose} aria-hidden="true" />
      )}

      <aside
        data-testid="auto-loop-panel"
        className="fixed top-0 right-0 h-full z-40 flex flex-col transition-transform duration-300 ease-in-out"
        style={{
          width:      "min(100vw, 440px)",
          transform:  isOpen ? "translateX(0)" : "translateX(100%)",
          background: "hsl(222 28% 7%)",
          borderLeft: "1px solid hsl(210 15% 15%)",
          boxShadow:  isOpen ? "-4px 0 32px hsl(0 0% 0% / 0.5)" : "none",
        }}
        aria-label="Auto loop panel"
      >
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b"
          style={{ borderColor: "hsl(210 15% 14%)" }}>
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4" style={{ color: statusColor }} />
            <h2 className="text-sm font-bold tracking-widest" style={{ color: statusColor }}>
              AUTO LOOP
            </h2>
            <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full flex items-center gap-1"
              style={{ background: `${statusColor}18`, border: `1px solid ${statusColor}40`, color: statusColor }}>
              {processing && <Loader2 className="w-2 h-2 animate-spin" />}
              {statusLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => fetchState()} disabled={loading}
              title="Refresh" aria-label="Refresh auto loop state"
              className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95 disabled:opacity-40"
              style={{ background: "hsl(210 15% 12%)", borderColor: "hsl(210 15% 22%)" }}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
                style={{ color: "hsl(210 20% 55%)" }} />
            </button>
            <button type="button" onClick={onClose} aria-label="Close auto loop panel"
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
            <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: "hsl(355 80% 65%)" }} />
            <p className="text-[10px]" style={{ color: "hsl(355 80% 72%)" }}>{error}</p>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          {/* Safety warning */}
          <SafetyWarning />

          {/* Lockout banner */}
          {lockedOut && (
            <div className="rounded-xl p-3"
              style={{ background: "hsl(310 90% 55% / 0.08)", border: "1px solid hsl(310 90% 55% / 0.35)" }}>
              <div className="flex items-start gap-2 mb-2">
                <Lock className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "hsl(310 90% 65%)" }} />
                <div>
                  <p className="text-[11px] font-bold" style={{ color: "hsl(310 90% 72%)" }}>SAFETY LOCKOUT ACTIVE</p>
                  <p className="text-[10px] mt-0.5" style={{ color: "hsl(310 70% 62%)" }}>
                    {state?.lockoutReason ?? "Repeated failures detected."}
                  </p>
                </div>
              </div>
              <button type="button" onClick={resetLockout} disabled={resetting}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40"
                style={{ background: "hsl(310 90% 55% / 0.12)", border: "1px solid hsl(310 90% 55% / 0.4)", color: "hsl(310 90% 72%)" }}>
                {resetting ? <><Loader2 className="w-3 h-3 animate-spin" /> RESETTING…</> : <><Unlock className="w-3 h-3" /> RESET LOCKOUT</>}
              </button>
            </div>
          )}

          {/* AUTO MODE toggle */}
          <div className="rounded-xl p-3"
            style={{
              border: `1px solid ${enabled ? "hsl(150 70% 45% / 0.4)" : "hsl(210 15% 22%)"}`,
              background: enabled ? "hsl(150 70% 50% / 0.06)" : "hsl(220 20% 6.5%)",
            }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold" style={{ color: enabled ? "hsl(150 70% 68%)" : "hsl(210 20% 55%)" }}>
                  AUTO MODE
                </p>
                <p className="text-[9px] mt-0.5" style={{ color: "hsl(210 15% 38%)" }}>
                  {enabled
                    ? "Jarvis will automatically execute eligible actions while this panel is open."
                    : "OFF — Jarvis will not execute any actions automatically."}
                </p>
              </div>
              <button type="button"
                onClick={toggle}
                disabled={toggling || lockedOut}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40 flex-shrink-0"
                style={{
                  background:  enabled ? "hsl(150 70% 45% / 0.15)" : "hsl(355 80% 55% / 0.08)",
                  border:      `1px solid ${enabled ? "hsl(150 70% 45% / 0.5)" : "hsl(210 15% 28%)"}`,
                  color:       enabled ? "hsl(150 70% 68%)" : "hsl(210 20% 55%)",
                }}>
                {toggling ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : enabled ? <><Power className="w-3.5 h-3.5" /> ON</>
                             : <><PowerOff className="w-3.5 h-3.5" /> OFF</>}
              </button>
            </div>

            {/* Manual tick button */}
            {enabled && !lockedOut && (
              <button type="button"
                onClick={triggerTick}
                disabled={processing}
                className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[9px] font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40"
                style={{ background: "hsl(150 70% 50% / 0.08)", border: "1px solid hsl(150 70% 50% / 0.2)", color: "hsl(150 70% 55%)" }}>
                {processing ? <><Loader2 className="w-3 h-3 animate-spin" /> PROCESSING…</>
                            : <><Play className="w-3 h-3" /> RUN NOW</>}
              </button>
            )}
          </div>

          {/* Stats grid */}
          <div>
            <p className="text-[9px] font-mono tracking-widest mb-2 px-1" style={{ color: "hsl(210 15% 35%)" }}>
              EXECUTION STATS
            </p>
            <div className="grid grid-cols-3 gap-1.5 mb-1">
              <StatCell label="QUEUED"    value={stats.queued}    color="hsl(38 100% 62%)" />
              <StatCell label="RUNNING"   value={stats.running}   color="hsl(194 100% 60%)" />
              <StatCell label="COMPLETED" value={stats.completed} color="hsl(150 70% 60%)" />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <StatCell label="FAILED"    value={stats.failed}            color="hsl(355 80% 65%)" />
              <StatCell label="ROLLBACK ✓" value={stats.rollbackAvailable} color="hsl(264 80% 70%)" />
            </div>
            {(state?.consecutiveFails ?? 0) > 0 && (
              <p className="text-[9px] font-mono px-1 mt-1.5"
                style={{ color: (state?.consecutiveFails ?? 0) >= 2 ? "hsl(355 80% 65%)" : "hsl(38 100% 60%)" }}>
                ⚠ {state?.consecutiveFails} consecutive failure{state?.consecutiveFails !== 1 ? "s" : ""}
                {" "}(lockout at 3)
              </p>
            )}
          </div>

          {/* Queue */}
          <div>
            <button type="button"
              className="flex items-center gap-1 w-full text-left mb-1.5"
              onClick={() => setQOpen(v => !v)}>
              {qOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <p className="text-[9px] font-mono tracking-widest" style={{ color: "hsl(210 15% 35%)" }}>
                QUEUE ({queue.length} / 3)
              </p>
            </button>
            {qOpen && (
              queue.length === 0 ? (
                <div className="flex items-center gap-2 py-3 px-3 rounded-xl"
                  style={{ background: "hsl(220 20% 6.5%)", border: "1px solid hsl(210 15% 14%)" }}>
                  <Inbox className="w-4 h-4 opacity-20" style={{ color: "hsl(38 100% 55%)" }} />
                  <p className="text-[10px]" style={{ color: "hsl(210 15% 38%)" }}>
                    No eligible actions — approve low-risk actions in the ACTIONS panel.
                  </p>
                </div>
              ) : (
                queue.map(a => (
                  <QueueCard key={a.id} action={a} retries={state?.retries?.[a.id] ?? 0} />
                ))
              )
            )}
          </div>

          {/* Activity stream */}
          <div>
            <button type="button"
              className="flex items-center gap-1 w-full text-left mb-1.5"
              onClick={() => setActOpen(v => !v)}>
              {actOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <p className="text-[9px] font-mono tracking-widest" style={{ color: "hsl(210 15% 35%)" }}>
                LIVE ACTIVITY ({activity.length})
              </p>
            </button>
            {actOpen && (
              <div className="rounded-xl overflow-hidden"
                style={{ border: "1px solid hsl(210 15% 14%)", background: "hsl(220 20% 5.5%)" }}>
                {activity.length === 0 ? (
                  <div className="flex items-center gap-2 py-4 px-3">
                    <Zap className="w-4 h-4 opacity-15" style={{ color: "hsl(150 70% 55%)" }} />
                    <p className="text-[10px]" style={{ color: "hsl(210 15% 35%)" }}>
                      No activity yet. Enable AUTO MODE to start.
                    </p>
                  </div>
                ) : (
                  <div className="px-3 py-1 max-h-72 overflow-y-auto">
                    {activity.slice(0, 30).map(ev => (
                      <ActivityRow key={ev.id} event={ev} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Last processed */}
          {state?.lastProcessedAt && (
            <p className="text-[9px] font-mono text-center pb-1"
              style={{ color: "hsl(210 15% 28%)" }}>
              last processed {fmtTime(state.lastProcessedAt)}
              {" · "}polls every {POLL_MS / 1000}s while open
            </p>
          )}
        </div>
      </aside>
    </>
  );
}
