/**
 * components/DiagnosticsPanel.tsx — Build/system diagnostics viewer
 *
 * Fetches GET /api/system/diagnostics and displays each issue with:
 *   - severity badge (ERROR / WARNING / INFO)
 *   - confidence badge (HIGH / MED / LOW)
 *   - issue type, likely cause, suggested fix
 * Shows a green "All systems healthy" state when no issues are found.
 * Read-only — no auto-fix actions.
 */

import { useState, useEffect, useCallback } from "react";
import { X, RefreshCw, Activity, AlertTriangle, XCircle, Info, CheckCircle2, Loader2 } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Severity   = "error" | "warning" | "info";
type Confidence = "high" | "medium" | "low";
type CheckResult = "pass" | "fail" | "warn" | "skip";

interface DiagnosticIssue {
  type:         string;
  severity:     Severity;
  likelyCause:  string;
  suggestedFix: string;
  confidence:   Confidence;
  detail?:      string;
}

interface RuntimeInfo {
  nodeVersion:    string;
  pnpmVersion:    string;
  platform:       string;
  arch:           string;
  uptimeSeconds:  number;
}

interface DiagnosticsReport {
  ok:          boolean;
  checkedAt:   string;
  issueCount:  number;
  errorCount:  number;
  warnCount:   number;
  issues:      DiagnosticIssue[];
  checks:      Record<string, CheckResult>;
  runtimeInfo: RuntimeInfo;
}

interface DiagnosticsPanelProps {
  isOpen:  boolean;
  onClose: () => void;
  apiBase: string;
}

// ─── Style maps ───────────────────────────────────────────────────────────────

const SEV: Record<Severity, { bg: string; border: string; color: string; label: string; Icon: React.ElementType }> = {
  error:   { bg: "hsl(355 80% 55% / 0.15)", border: "hsl(355 80% 55% / 0.4)", color: "hsl(355 90% 72%)", label: "ERROR",   Icon: XCircle },
  warning: { bg: "hsl(38 100% 55% / 0.15)",  border: "hsl(38 100% 55% / 0.4)",  color: "hsl(38 100% 70%)",  label: "WARN",    Icon: AlertTriangle },
  info:    { bg: "hsl(194 100% 45% / 0.12)", border: "hsl(194 100% 55% / 0.35)", color: "hsl(194 100% 70%)", label: "INFO",    Icon: Info },
};

const CONF: Record<Confidence, { color: string; label: string }> = {
  high:   { color: "hsl(150 70% 60%)",  label: "HIGH" },
  medium: { color: "hsl(38 100% 65%)",  label: "MED" },
  low:    { color: "hsl(210 20% 55%)",  label: "LOW" },
};

const CHECK_COLOR: Record<CheckResult, string> = {
  pass: "hsl(150 70% 55%)",
  fail: "hsl(355 80% 65%)",
  warn: "hsl(38 100% 65%)",
  skip: "hsl(210 15% 45%)",
};

// ─── Issue card ───────────────────────────────────────────────────────────────

function IssueCard({ issue, idx }: { issue: DiagnosticIssue; idx: number }) {
  const [open, setOpen] = useState(idx === 0);
  const s = SEV[issue.severity] ?? SEV.info;
  const c = CONF[issue.confidence] ?? CONF.low;
  const { Icon } = s;

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${s.border}`, background: s.bg }}>
      <button
        type="button"
        className="w-full flex items-start gap-2 px-3 py-2.5 text-left"
        onClick={() => setOpen(v => !v)}
      >
        <Icon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: s.color }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold"
              style={{ background: `${s.color}22`, border: `1px solid ${s.color}55`, color: s.color }}>
              {s.label}
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded font-mono"
              style={{ background: "hsl(210 15% 12%)", border: "1px solid hsl(210 15% 22%)", color: c.color }}>
              {c.label} confidence
            </span>
            <span className="text-[10px] font-mono opacity-60 truncate" style={{ color: s.color }}>
              {issue.type}
            </span>
          </div>
          <p className="text-xs mt-1 leading-snug font-medium" style={{ color: "hsl(196 40% 80%)" }}>
            {issue.likelyCause}
          </p>
        </div>
        <span className="text-[10px] flex-shrink-0 mt-0.5" style={{ color: "hsl(210 15% 40%)" }}>
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 border-t" style={{ borderColor: `${s.border}` }}>
          <p className="text-[10px] font-semibold mt-2 mb-0.5 tracking-wider" style={{ color: "hsl(194 100% 60%)" }}>
            SUGGESTED FIX
          </p>
          <p className="text-xs leading-snug" style={{ color: "hsl(196 30% 68%)" }}>
            {issue.suggestedFix}
          </p>
          {issue.detail && (
            <>
              <p className="text-[10px] font-semibold mt-2 mb-0.5 tracking-wider" style={{ color: "hsl(210 15% 45%)" }}>
                DETAIL
              </p>
              <pre className="text-[9px] leading-relaxed whitespace-pre-wrap break-all font-mono"
                style={{ color: "hsl(210 15% 55%)" }}>
                {issue.detail}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DiagnosticsPanel({ isOpen, onClose, apiBase }: DiagnosticsPanelProps) {
  const [report,   setReport]   = useState<DiagnosticsReport | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`${apiBase}api/system/diagnostics`);
      const data = await res.json() as DiagnosticsReport;
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => { if (isOpen) fetch_(); }, [isOpen, fetch_]);

  const sorted = report
    ? [...report.issues].sort((a, b) => {
        const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
        return (order[a.severity] ?? 2) - (order[b.severity] ?? 2);
      })
    : [];

  const checkEntries = report ? Object.entries(report.checks) : [];
  const passCount    = checkEntries.filter(([, v]) => v === "pass").length;

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-30 sm:hidden"
          style={{ background: "hsl(220 30% 4% / 0.6)" }}
          onClick={onClose} aria-hidden="true" />
      )}

      <aside
        data-testid="diagnostics-panel"
        className="fixed top-0 right-0 h-full z-40 flex flex-col transition-transform duration-300 ease-in-out"
        style={{
          width:     "min(100vw, 420px)",
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
          background: "hsl(222 28% 7%)",
          borderLeft: "1px solid hsl(210 15% 15%)",
          boxShadow:  isOpen ? "-4px 0 32px hsl(0 0% 0% / 0.5)" : "none",
        }}
        aria-label="Diagnostics panel"
      >
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b"
          style={{ borderColor: "hsl(210 15% 14%)" }}>
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4" style={{ color: "hsl(264 80% 72%)" }} />
            <h2 className="text-sm font-bold tracking-widest" style={{ color: "hsl(264 80% 80%)" }}>
              DIAGNOSTICS
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={fetch_} disabled={loading}
              title="Refresh" aria-label="Refresh diagnostics"
              className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95 disabled:opacity-40"
              style={{ background: "hsl(264 80% 55% / 0.08)", borderColor: "hsl(264 80% 55% / 0.3)" }}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
                style={{ color: "hsl(264 80% 72%)" }} />
            </button>
            <button type="button" onClick={onClose} aria-label="Close diagnostics"
              className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95"
              style={{ background: "transparent", borderColor: "hsl(210 15% 28%)" }}>
              <X className="w-3.5 h-3.5" style={{ color: "hsl(210 20% 55%)" }} />
            </button>
          </div>
        </header>

        {/* Summary bar */}
        {report && (
          <div className="flex items-center gap-3 px-4 py-2 border-b flex-shrink-0"
            style={{ borderColor: "hsl(210 15% 12%)" }}>
            <div className="flex flex-col items-center">
              <span className="text-base font-bold font-mono" style={{ color: report.errorCount > 0 ? "hsl(355 90% 70%)" : "hsl(150 70% 60%)" }}>
                {report.errorCount}
              </span>
              <span className="text-[9px] tracking-widest" style={{ color: "hsl(210 15% 40%)" }}>ERRORS</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-base font-bold font-mono" style={{ color: report.warnCount > 0 ? "hsl(38 100% 65%)" : "hsl(150 70% 60%)" }}>
                {report.warnCount}
              </span>
              <span className="text-[9px] tracking-widest" style={{ color: "hsl(210 15% 40%)" }}>WARNS</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-base font-bold font-mono" style={{ color: "hsl(194 100% 65%)" }}>
                {passCount}/{checkEntries.length}
              </span>
              <span className="text-[9px] tracking-widest" style={{ color: "hsl(210 15% 40%)" }}>CHECKS</span>
            </div>
            <span className="ml-auto text-[9px] font-mono" style={{ color: "hsl(210 15% 35%)" }}>
              {new Date(report.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {loading && !report && (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: "hsl(264 80% 72%)" }} />
              <span className="text-xs tracking-wider" style={{ color: "hsl(210 15% 45%)" }}>Running checks…</span>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg"
              style={{ background: "hsl(355 80% 50% / 0.1)", border: "1px solid hsl(355 80% 50% / 0.3)" }}>
              <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "hsl(355 80% 65%)" }} />
              <div>
                <p className="text-xs font-semibold" style={{ color: "hsl(355 80% 72%)" }}>Failed to load</p>
                <p className="text-[10px] mt-0.5" style={{ color: "hsl(355 60% 60%)" }}>{error}</p>
              </div>
            </div>
          )}

          {report && sorted.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-10">
              <CheckCircle2 className="w-8 h-8" style={{ color: "hsl(150 70% 55%)" }} />
              <p className="text-sm font-semibold" style={{ color: "hsl(150 70% 65%)" }}>All systems healthy</p>
              <p className="text-[10px]" style={{ color: "hsl(210 15% 40%)" }}>
                {checkEntries.length} checks passed
              </p>
            </div>
          )}

          {sorted.map((issue, idx) => (
            <IssueCard key={`${issue.type}-${idx}`} issue={issue} idx={idx} />
          ))}

          {/* Check grid */}
          {report && checkEntries.length > 0 && (
            <div className="mt-3">
              <p className="text-[9px] font-mono tracking-widest mb-2" style={{ color: "hsl(210 15% 38%)" }}>CHECK RESULTS</p>
              <div className="grid grid-cols-2 gap-1">
                {checkEntries.map(([name, result]) => (
                  <div key={name} className="flex items-center gap-1.5 px-2 py-1 rounded"
                    style={{ background: "hsl(220 20% 7%)", border: "1px solid hsl(210 15% 13%)" }}>
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: CHECK_COLOR[result] ?? "hsl(210 15% 45%)" }} />
                    <span className="text-[9px] font-mono truncate" style={{ color: "hsl(210 15% 50%)" }}>
                      {name.replace(/_/g, " ")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Runtime info */}
          {report?.runtimeInfo && (
            <div className="mt-3 px-3 py-2 rounded-lg" style={{ background: "hsl(220 20% 6%)", border: "1px solid hsl(210 15% 12%)" }}>
              <p className="text-[9px] font-mono tracking-widest mb-1.5" style={{ color: "hsl(210 15% 38%)" }}>RUNTIME</p>
              {[
                ["Node",     report.runtimeInfo.nodeVersion],
                ["pnpm",     report.runtimeInfo.pnpmVersion],
                ["Platform", `${report.runtimeInfo.platform}/${report.runtimeInfo.arch}`],
                ["Uptime",   `${report.runtimeInfo.uptimeSeconds}s`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span className="text-[9px] font-mono" style={{ color: "hsl(210 15% 38%)" }}>{k}</span>
                  <span className="text-[9px] font-mono" style={{ color: "hsl(196 40% 60%)" }}>{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
