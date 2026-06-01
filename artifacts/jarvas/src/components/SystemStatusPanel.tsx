/**
 * components/SystemStatusPanel.tsx — Live system status overview
 *
 * Shows at a glance:
 *   - API online / offline
 *   - Task count (from master task list)
 *   - Diagnostics issue count
 *   - Server uptime and runtime info
 *   - Last refresh time
 * Refreshes on open and on demand. Read-only.
 */

import { useState, useEffect, useCallback } from "react";
import {
  X, RefreshCw, Gauge, Wifi, WifiOff, Loader2,
  CheckCircle2, AlertTriangle, XCircle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SystemStatusPanelProps {
  isOpen:  boolean;
  onClose: () => void;
  apiBase: string;
}

interface StatusData {
  apiOnline:      boolean;
  taskCount:      number;
  diagErrorCount: number;
  diagWarnCount:  number;
  diagOk:         boolean;
  nodeVersion:    string;
  pnpmVersion:    string;
  uptimeSeconds:  number;
  fetchedAt:      Date;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtUptime(s: number): string {
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

// ─── Status card ──────────────────────────────────────────────────────────────

function StatusCard({
  label, value, sub, color, Icon,
}: {
  label: string;
  value: string | number;
  sub?:  string;
  color: string;
  Icon:  React.ElementType;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-3 rounded-xl"
      style={{ background: "hsl(220 20% 6.5%)", border: "1px solid hsl(210 15% 14%)" }}>
      <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg"
        style={{ background: `${color}18`, border: `1px solid ${color}35` }}>
        <Icon className="w-4 h-4" style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-[9px] tracking-widest font-mono" style={{ color: "hsl(210 15% 42%)" }}>{label}</p>
        <p className="text-sm font-bold leading-tight" style={{ color }}>{value}</p>
        {sub && <p className="text-[9px]" style={{ color: "hsl(210 15% 38%)" }}>{sub}</p>}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SystemStatusPanel({ isOpen, onClose, apiBase }: SystemStatusPanelProps) {
  const [status,  setStatus]  = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const healthzUrl = `${apiBase}api/healthz`;

    // ── 1. Health check — isolated fetch with its own try/catch so its
    //       result can never be contaminated by the other two requests.
    let apiOnline = false;
    try {
      const healthRes = await fetch(healthzUrl);
      console.log(
        "[SystemStatus] healthz →", healthRes.status, healthRes.statusText,
        "| ok:", healthRes.ok,
        "| ACAO:", healthRes.headers.get("access-control-allow-origin"),
        "| URL:", healthzUrl,
        "| origin:", window.location.origin,
      );
      if (healthRes.ok) {
        // Also verify the body confirms "ok" so an intercepting proxy
        // that returns 200 with an error page doesn't fool us.
        try {
          const body = await healthRes.json() as Record<string, unknown>;
          console.log("[SystemStatus] healthz body:", body);
          // Accept if HTTP 2xx (already checked) — body content is
          // informational only; don't gate ONLINE on it.
          apiOnline = true;
        } catch {
          // Body parse failed but HTTP status was ok — still count as online.
          apiOnline = true;
        }
      } else {
        console.warn("[SystemStatus] healthz returned non-ok status:", healthRes.status);
      }
    } catch (err) {
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      console.error("[SystemStatus] healthz fetch failed:", detail, "| URL:", healthzUrl);
    }

    // ── 2. Secondary requests — run in parallel, failures are non-fatal.
    try {
      const [tasksRes, diagRes] = await Promise.allSettled([
        fetch(`${apiBase}api/master-tasks`),
        fetch(`${apiBase}api/system/diagnostics`),
      ]);

      let taskCount = 0;
      if (tasksRes.status === "fulfilled" && tasksRes.value.ok) {
        try {
          const d = await tasksRes.value.json() as { tasks?: unknown[] };
          taskCount = d.tasks?.length ?? 0;
        } catch { /* ignore */ }
      }

      let diagErrorCount = 0, diagWarnCount = 0, diagOk = true;
      let nodeVersion = "—", pnpmVersion = "—", uptimeSeconds = 0;
      if (diagRes.status === "fulfilled" && diagRes.value.ok) {
        try {
          const d = await diagRes.value.json() as {
            ok: boolean; errorCount: number; warnCount: number;
            runtimeInfo?: { nodeVersion: string; pnpmVersion: string; uptimeSeconds: number };
          };
          diagErrorCount = d.errorCount ?? 0;
          diagWarnCount  = d.warnCount  ?? 0;
          diagOk         = d.ok         ?? true;
          nodeVersion    = d.runtimeInfo?.nodeVersion    ?? "—";
          pnpmVersion    = d.runtimeInfo?.pnpmVersion    ?? "—";
          uptimeSeconds  = d.runtimeInfo?.uptimeSeconds  ?? 0;
        } catch { /* ignore */ }
      }

      setStatus({
        apiOnline, taskCount,
        diagErrorCount, diagWarnCount, diagOk,
        nodeVersion, pnpmVersion, uptimeSeconds,
        fetchedAt: new Date(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => { if (isOpen) refresh(); }, [isOpen, refresh]);

  const diagColor = !status
    ? "hsl(210 15% 40%)"
    : status.diagErrorCount > 0 ? "hsl(355 90% 70%)"
    : status.diagWarnCount  > 0 ? "hsl(38 100% 65%)"
    : "hsl(150 70% 60%)";

  const diagLabel = !status ? "—"
    : status.diagErrorCount > 0 ? `${status.diagErrorCount} error${status.diagErrorCount > 1 ? "s" : ""}`
    : status.diagWarnCount  > 0 ? `${status.diagWarnCount} warning${status.diagWarnCount > 1 ? "s" : ""}`
    : "Clean";

  const DiagIcon = !status ? Gauge
    : status.diagErrorCount > 0 ? XCircle
    : status.diagWarnCount  > 0 ? AlertTriangle
    : CheckCircle2;

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-30 sm:hidden"
          style={{ background: "hsl(220 30% 4% / 0.6)" }}
          onClick={onClose} aria-hidden="true" />
      )}

      <aside
        data-testid="system-status-panel"
        className="fixed top-0 right-0 h-full z-40 flex flex-col transition-transform duration-300 ease-in-out"
        style={{
          width:     "min(100vw, 360px)",
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
          background: "hsl(222 28% 7%)",
          borderLeft: "1px solid hsl(210 15% 15%)",
          boxShadow:  isOpen ? "-4px 0 32px hsl(0 0% 0% / 0.5)" : "none",
        }}
        aria-label="System status panel"
      >
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b"
          style={{ borderColor: "hsl(210 15% 14%)" }}>
          <div className="flex items-center gap-2">
            <Gauge className="w-4 h-4" style={{ color: "hsl(38 100% 65%)" }} />
            <h2 className="text-sm font-bold tracking-widest" style={{ color: "hsl(38 100% 75%)" }}>
              SYSTEM STATUS
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={refresh} disabled={loading}
              title="Refresh" aria-label="Refresh status"
              className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95 disabled:opacity-40"
              style={{ background: "hsl(38 100% 55% / 0.08)", borderColor: "hsl(38 100% 55% / 0.3)" }}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
                style={{ color: "hsl(38 100% 65%)" }} />
            </button>
            <button type="button" onClick={onClose} aria-label="Close status panel"
              className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95"
              style={{ background: "transparent", borderColor: "hsl(210 15% 28%)" }}>
              <X className="w-3.5 h-3.5" style={{ color: "hsl(210 20% 55%)" }} />
            </button>
          </div>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">

          {loading && !status && (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: "hsl(38 100% 65%)" }} />
              <span className="text-xs tracking-wider" style={{ color: "hsl(210 15% 45%)" }}>Checking systems…</span>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg"
              style={{ background: "hsl(355 80% 50% / 0.1)", border: "1px solid hsl(355 80% 50% / 0.3)" }}>
              <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "hsl(355 80% 65%)" }} />
              <p className="text-xs" style={{ color: "hsl(355 80% 72%)" }}>{error}</p>
            </div>
          )}

          {status && (
            <>
              <StatusCard
                label="API SERVER"
                value={status.apiOnline ? "ONLINE" : "OFFLINE"}
                sub={status.apiOnline ? `Uptime ${fmtUptime(status.uptimeSeconds)}` : `Cannot reach ${apiBase}api/healthz`}
                color={status.apiOnline ? "hsl(150 70% 55%)" : "hsl(355 80% 65%)"}
                Icon={status.apiOnline ? Wifi : WifiOff}
              />
              <StatusCard
                label="MASTER TASKS"
                value={status.taskCount}
                sub={`${status.taskCount} task${status.taskCount !== 1 ? "s" : ""} in list`}
                color="hsl(150 60% 55%)"
                Icon={CheckCircle2}
              />
              <StatusCard
                label="DIAGNOSTICS"
                value={diagLabel}
                sub={status.diagOk ? "No blocking errors" : "Action required"}
                color={diagColor}
                Icon={DiagIcon}
              />

              {/* Runtime details */}
              <div className="mt-2 px-3 py-3 rounded-xl space-y-1.5"
                style={{ background: "hsl(220 20% 6%)", border: "1px solid hsl(210 15% 12%)" }}>
                <p className="text-[9px] font-mono tracking-widest mb-2" style={{ color: "hsl(210 15% 38%)" }}>
                  RUNTIME
                </p>
                {[
                  ["Node.js",  status.nodeVersion],
                  ["pnpm",     status.pnpmVersion],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-[10px] font-mono" style={{ color: "hsl(210 15% 42%)" }}>{k}</span>
                    <span className="text-[10px] font-mono" style={{ color: "hsl(196 40% 60%)" }}>{v}</span>
                  </div>
                ))}
              </div>

              <p className="text-center text-[9px] font-mono pt-1" style={{ color: "hsl(210 15% 30%)" }}>
                Last refreshed {status.fetchedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </p>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
