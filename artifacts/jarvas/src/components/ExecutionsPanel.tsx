/**
 * components/ExecutionsPanel.tsx — Safe Execution Engine panel
 *
 * Shows:
 *   QUEUE tab  — queued + running executions
 *   HISTORY tab — completed + failed executions
 *
 * Executions are triggered from the ACTIONS panel.
 * This panel is read-only — it polls for updates and displays reports.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  X, RefreshCw, Cpu, CheckCircle2, XCircle, Clock,
  Loader2, Inbox, ChevronDown, ChevronRight, AlertTriangle,
  FileText, FolderPlus, FilePlus, FileEdit, BarChart2, Zap,
  Shield,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ExecutionStatus = "queued" | "running" | "completed" | "failed";
type ExecutionOpType =
  | "create_directory"
  | "create_file"
  | "append_log"
  | "update_task_status"
  | "generate_report"
  | "unsupported";

interface ExecutionRecord {
  id:             string;
  actionId:       string;
  actionTitle:    string;
  operationType:  ExecutionOpType;
  status:         ExecutionStatus;
  dryRun:         boolean;
  startedAt:      string;
  completedAt?:   string;
  checkpointId?:  string;
  affectedFiles:  string[];
  report:         string;
  error?:         string;
}

interface ExecutionsPanelProps {
  isOpen:  boolean;
  onClose: () => void;
  apiBase: string;
}

type PanelTab = "queue" | "history";

// ─── Style maps ───────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<ExecutionStatus, {
  color: string; bg: string; border: string; label: string;
  Icon: React.ElementType; pulse?: boolean;
}> = {
  queued:    { color: "hsl(38 100% 65%)",  bg: "hsl(38 100% 55% / 0.10)", border: "hsl(38 100% 55% / 0.30)", label: "QUEUED",    Icon: Clock },
  running:   { color: "hsl(194 100% 60%)", bg: "hsl(194 100% 55% / 0.10)", border: "hsl(194 100% 55% / 0.35)", label: "RUNNING",   Icon: Loader2, pulse: true },
  completed: { color: "hsl(150 70% 60%)",  bg: "hsl(150 70% 55% / 0.10)", border: "hsl(150 70% 55% / 0.30)", label: "COMPLETED", Icon: CheckCircle2 },
  failed:    { color: "hsl(355 80% 68%)",  bg: "hsl(355 80% 55% / 0.10)", border: "hsl(355 80% 55% / 0.30)", label: "FAILED",    Icon: XCircle },
};

const OP_STYLE: Record<ExecutionOpType, { label: string; Icon: React.ElementType; color: string }> = {
  create_directory:   { label: "CREATE DIR",    Icon: FolderPlus,  color: "hsl(264 80% 70%)" },
  create_file:        { label: "CREATE FILE",   Icon: FilePlus,    color: "hsl(194 100% 60%)" },
  append_log:         { label: "APPEND LOG",    Icon: FileEdit,    color: "hsl(150 70% 60%)" },
  update_task_status: { label: "UPDATE TASK",   Icon: FileText,    color: "hsl(38 100% 60%)" },
  generate_report:    { label: "GEN REPORT",    Icon: BarChart2,   color: "hsl(310 80% 70%)" },
  unsupported:        { label: "UNSUPPORTED",   Icon: AlertTriangle, color: "hsl(355 80% 65%)" },
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function durationMs(start: string, end?: string): string {
  const ms = new Date(end ?? new Date().toISOString()).getTime() - new Date(start).getTime();
  if (ms < 1000)  return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

// ─── Execution card ───────────────────────────────────────────────────────────

function ExecutionCard({ record }: { record: ExecutionRecord }) {
  const [reportOpen, setReportOpen] = useState(false);
  const [filesOpen,  setFilesOpen]  = useState(false);
  const s  = STATUS_STYLE[record.status] ?? STATUS_STYLE.failed;
  const op = OP_STYLE[record.operationType] ?? OP_STYLE.unsupported;
  const { Icon: SIcon } = s;
  const { Icon: OIcon } = op;

  return (
    <div className="rounded-xl overflow-hidden mb-2"
      style={{ border: `1px solid ${s.border}`, background: s.bg }}>
      {/* Header row */}
      <div className="flex items-start gap-2 px-3 pt-2.5 pb-1.5">
        <SIcon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${s.pulse ? "animate-spin" : ""}`}
          style={{ color: s.color }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            <span className="text-[8px] px-1.5 py-0.5 rounded font-mono font-bold"
              style={{ background: `${s.color}20`, border: `1px solid ${s.color}50`, color: s.color }}>
              {s.label}
            </span>
            <span className="text-[8px] px-1.5 py-0.5 rounded font-mono flex items-center gap-1"
              style={{ background: `${op.color}18`, border: `1px solid ${op.color}40`, color: op.color }}>
              <OIcon className="w-2 h-2" />{op.label}
            </span>
            {record.dryRun && (
              <span className="text-[8px] px-1.5 py-0.5 rounded font-mono"
                style={{ background: "hsl(264 80% 55% / 0.12)", border: "1px solid hsl(264 80% 55% / 0.35)", color: "hsl(264 80% 72%)" }}>
                DRY-RUN
              </span>
            )}
          </div>
          <p className="text-[11px] font-semibold leading-snug" style={{ color: "hsl(196 40% 82%)" }}>
            {record.actionTitle}
          </p>
        </div>
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-3 px-3 pb-1.5 flex-wrap">
        <span className="text-[9px] font-mono" style={{ color: "hsl(210 15% 40%)" }}>
          {fmtTime(record.startedAt)}
        </span>
        {record.completedAt && (
          <span className="text-[9px] font-mono" style={{ color: "hsl(210 15% 35%)" }}>
            {durationMs(record.startedAt, record.completedAt)}
          </span>
        )}
        {record.checkpointId && (
          <span className="flex items-center gap-1 text-[9px] font-mono"
            style={{ color: "hsl(150 60% 50%)" }}>
            <Shield className="w-2.5 h-2.5" />ckpt {record.checkpointId.slice(0, 8)}
          </span>
        )}
        <span className="text-[9px] font-mono" style={{ color: "hsl(210 15% 30%)" }}>
          #{record.id.slice(0, 8)}
        </span>
      </div>

      {/* Error */}
      {record.error && (
        <div className="mx-3 mb-2 flex items-start gap-1.5 p-2 rounded-lg"
          style={{ background: "hsl(355 80% 50% / 0.08)", border: "1px solid hsl(355 80% 50% / 0.25)" }}>
          <XCircle className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: "hsl(355 80% 65%)" }} />
          <p className="text-[10px]" style={{ color: "hsl(355 80% 72%)" }}>{record.error}</p>
        </div>
      )}

      {/* Affected files (collapsible) */}
      {record.affectedFiles.length > 0 && (
        <div>
          <button type="button" className="flex items-center gap-1 px-3 py-1 w-full text-left"
            onClick={() => setFilesOpen(v => !v)}>
            {filesOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <span className="text-[9px] font-mono tracking-widest" style={{ color: "hsl(210 15% 40%)" }}>
              FILES ({record.affectedFiles.length})
            </span>
          </button>
          {filesOpen && record.affectedFiles.map((f, i) => (
            <p key={i} className="px-5 pb-0.5 text-[9px] font-mono truncate"
              style={{ color: "hsl(194 100% 55%)" }}>
              {f}
            </p>
          ))}
        </div>
      )}

      {/* Execution report (collapsible) */}
      {record.report && (
        <div className="border-t" style={{ borderColor: `${s.border}` }}>
          <button type="button" className="flex items-center gap-1 px-3 py-1.5 w-full text-left"
            onClick={() => setReportOpen(v => !v)}>
            {reportOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <span className="text-[9px] font-mono tracking-widest" style={{ color: "hsl(210 15% 40%)" }}>
              EXECUTION REPORT
            </span>
          </button>
          {reportOpen && (
            <pre className="px-4 pb-3 text-[9px] font-mono leading-relaxed whitespace-pre-wrap break-all"
              style={{ color: "hsl(210 15% 52%)" }}>
              {record.report}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

function StatsBar({ records }: { records: ExecutionRecord[] }) {
  const counts = records.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const pills: { key: ExecutionStatus; label: string }[] = [
    { key: "running",   label: "Running"   },
    { key: "queued",    label: "Queued"    },
    { key: "completed", label: "Completed" },
    { key: "failed",    label: "Failed"    },
  ];

  return (
    <div className="flex items-center gap-2 flex-wrap px-1 py-1.5 mb-2">
      {pills.filter(p => counts[p.key]).map(p => {
        const s = STATUS_STYLE[p.key];
        return (
          <span key={p.key} className="text-[9px] px-1.5 py-0.5 rounded font-mono flex items-center gap-1"
            style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.color }}>
            {counts[p.key]} {p.label}
          </span>
        );
      })}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const POLL_MS = 4000;

export default function ExecutionsPanel({ isOpen, onClose, apiBase }: ExecutionsPanelProps) {
  const [records,  setRecords]  = useState<ExecutionRecord[]>([]);
  const [tab,      setTab]      = useState<PanelTab>("queue");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRecords = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`${apiBase}api/executions`);
      const data = await res.json() as { ok: boolean; executions?: ExecutionRecord[]; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Failed to load executions");
      setRecords(data.executions ?? []);
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : "Network error");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [apiBase]);

  // Poll while panel is open (refresh every 4 s to pick up running executions)
  useEffect(() => {
    if (!isOpen) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    fetchRecords();
    pollRef.current = setInterval(() => fetchRecords(true), POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [isOpen, fetchRecords]);

  const queue   = records.filter(r => r.status === "queued" || r.status === "running");
  const history = records.filter(r => r.status === "completed" || r.status === "failed");
  const visible = tab === "queue" ? queue : history;

  const tabs: { key: PanelTab; label: string; count: number }[] = [
    { key: "queue",   label: "QUEUE",   count: queue.length   },
    { key: "history", label: "HISTORY", count: history.length },
  ];

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-30 sm:hidden"
          style={{ background: "hsl(220 30% 4% / 0.6)" }}
          onClick={onClose} aria-hidden="true" />
      )}

      <aside
        data-testid="executions-panel"
        className="fixed top-0 right-0 h-full z-40 flex flex-col transition-transform duration-300 ease-in-out"
        style={{
          width:      "min(100vw, 440px)",
          transform:  isOpen ? "translateX(0)" : "translateX(100%)",
          background: "hsl(222 28% 7%)",
          borderLeft: "1px solid hsl(210 15% 15%)",
          boxShadow:  isOpen ? "-4px 0 32px hsl(0 0% 0% / 0.5)" : "none",
        }}
        aria-label="Executions panel"
      >
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b"
          style={{ borderColor: "hsl(210 15% 14%)" }}>
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4" style={{ color: "hsl(38 100% 65%)" }} />
            <h2 className="text-sm font-bold tracking-widest" style={{ color: "hsl(38 100% 72%)" }}>
              EXECUTIONS
            </h2>
            {records.length > 0 && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full font-mono"
                style={{ background: "hsl(38 100% 55% / 0.12)", border: "1px solid hsl(38 100% 55% / 0.3)", color: "hsl(38 100% 65%)" }}>
                {records.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => fetchRecords()} disabled={loading}
              title="Refresh" aria-label="Refresh executions"
              className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95 disabled:opacity-40"
              style={{ background: "hsl(38 100% 55% / 0.08)", borderColor: "hsl(38 100% 55% / 0.3)" }}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
                style={{ color: "hsl(38 100% 65%)" }} />
            </button>
            <button type="button" onClick={onClose} aria-label="Close executions panel"
              className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95"
              style={{ background: "transparent", borderColor: "hsl(210 15% 28%)" }}>
              <X className="w-3.5 h-3.5" style={{ color: "hsl(210 20% 55%)" }} />
            </button>
          </div>
        </header>

        {/* Safety notice */}
        <div className="flex items-center gap-2 px-4 py-2 border-b flex-shrink-0"
          style={{ borderColor: "hsl(210 15% 12%)", background: "hsl(150 70% 55% / 0.04)" }}>
          <Shield className="w-3 h-3 flex-shrink-0" style={{ color: "hsl(150 70% 58%)" }} />
          <p className="text-[9px] font-mono" style={{ color: "hsl(150 70% 50%)" }}>
            Low-risk approved actions only · Writes to .jarvas-data/ only · Auto-checkpoint on execute
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-3 mt-2 flex items-start gap-2 p-2.5 rounded-lg flex-shrink-0"
            style={{ background: "hsl(355 80% 50% / 0.1)", border: "1px solid hsl(355 80% 50% / 0.3)" }}>
            <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: "hsl(355 80% 65%)" }} />
            <p className="text-[10px]" style={{ color: "hsl(355 80% 72%)" }}>{error}</p>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 px-3 pt-3 flex-shrink-0">
          {tabs.map(t => (
            <button key={t.key} type="button"
              onClick={() => setTab(t.key)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-widest transition-all"
              style={{
                background:  tab === t.key ? "hsl(38 100% 55% / 0.12)" : "transparent",
                border:      `1px solid ${tab === t.key ? "hsl(38 100% 55% / 0.4)" : "hsl(210 15% 22%)"}`,
                color:       tab === t.key ? "hsl(38 100% 68%)" : "hsl(210 15% 45%)",
              }}>
              {t.label}
              {t.count > 0 && (
                <span className="text-[8px] px-1 py-0.5 rounded-full min-w-[16px] text-center leading-none"
                  style={{ background: tab === t.key ? "hsl(38 100% 55% / 0.25)" : "hsl(210 15% 18%)", color: "inherit" }}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {loading && records.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: "hsl(38 100% 65%)" }} />
              <span className="text-xs tracking-wider" style={{ color: "hsl(210 15% 45%)" }}>Loading executions…</span>
            </div>
          )}

          {!loading && records.length > 0 && <StatsBar records={records} />}

          {!loading && visible.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <Inbox className="w-10 h-10 opacity-15" style={{ color: "hsl(38 100% 55%)" }} />
              <div className="text-center">
                <p className="text-sm font-semibold" style={{ color: "hsl(210 15% 45%)" }}>
                  {tab === "queue" ? "No active executions" : "No execution history"}
                </p>
                <p className="text-[10px] mt-1" style={{ color: "hsl(210 15% 35%)" }}>
                  {tab === "queue"
                    ? "Approve a low-risk action and click EXECUTE to queue it."
                    : "Completed and failed executions will appear here."}
                </p>
              </div>
            </div>
          )}

          {visible.map(r => <ExecutionCard key={r.id} record={r} />)}

          {tab === "history" && history.length > 0 && (
            <p className="text-center text-[9px] font-mono mt-2 pb-1"
              style={{ color: "hsl(210 15% 28%)" }}>
              {history.length} record{history.length !== 1 ? "s" : ""} · auto-refreshes every {POLL_MS / 1000}s
            </p>
          )}
        </div>
      </aside>
    </>
  );
}
