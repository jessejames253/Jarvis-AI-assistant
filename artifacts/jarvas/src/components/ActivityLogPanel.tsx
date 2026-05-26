/**
 * components/ActivityLogPanel.tsx — Activity log viewer
 *
 * Fetches GET /api/system/logs and renders each log file's lines.
 * Shows a clear empty state when .jarvas-data/logs/ has no log files.
 * Read-only — no delete or clear actions.
 */

import { useState, useEffect, useCallback } from "react";
import { X, RefreshCw, ScrollText, ChevronDown, ChevronRight, Loader2, FileText, Inbox } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LogFile {
  name:         string;
  sizeBytes:    number;
  lastModified: string;
  lines:        string[];
}

interface LogsResponse {
  ok:    boolean;
  files: LogFile[];
  error?: string;
}

interface ActivityLogPanelProps {
  isOpen:  boolean;
  onClose: () => void;
  apiBase: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtBytes(b: number): string {
  if (b < 1024)       return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function lineColor(line: string): string {
  if (/\b(error|err|fatal|exception|fail)\b/i.test(line)) return "hsl(355 80% 68%)";
  if (/\b(warn|warning)\b/i.test(line))                   return "hsl(38 100% 65%)";
  if (/\b(info|success|ok)\b/i.test(line))                return "hsl(194 100% 65%)";
  return "hsl(210 15% 55%)";
}

// ─── Log file section ─────────────────────────────────────────────────────────

function LogFileSection({ file }: { file: LogFile }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-lg overflow-hidden"
      style={{ border: "1px solid hsl(210 15% 16%)", background: "hsl(220 20% 6.5%)" }}>
      {/* File header */}
      <button type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded(v => !v)}>
        {expanded
          ? <ChevronDown  className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(196 50% 55%)" }} />
          : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(196 50% 55%)" }} />
        }
        <FileText className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(194 100% 60%)" }} />
        <span className="flex-1 text-xs font-mono truncate" style={{ color: "hsl(196 50% 70%)" }}>
          {file.name}
        </span>
        <span className="text-[9px] font-mono flex-shrink-0" style={{ color: "hsl(210 15% 38%)" }}>
          {fmtBytes(file.sizeBytes)} · {file.lines.length} lines
        </span>
      </button>

      {/* Lines */}
      {expanded && (
        <div className="border-t" style={{ borderColor: "hsl(210 15% 13%)" }}>
          {file.lines.length === 0 ? (
            <p className="px-3 py-2 text-[10px] italic" style={{ color: "hsl(210 15% 38%)" }}>
              File is empty.
            </p>
          ) : (
            <div className="px-3 py-2 max-h-56 overflow-y-auto font-mono text-[10px] space-y-0.5">
              {file.lines.map((line, i) => (
                <p key={i} className="leading-relaxed whitespace-pre-wrap break-all"
                  style={{ color: lineColor(line) }}>
                  {line || "\u00a0"}
                </p>
              ))}
            </div>
          )}
          <div className="px-3 py-1 border-t text-right" style={{ borderColor: "hsl(210 15% 12%)" }}>
            <span className="text-[9px] font-mono" style={{ color: "hsl(210 15% 32%)" }}>
              Modified {new Date(file.lastModified).toLocaleString()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ActivityLogPanel({ isOpen, onClose, apiBase }: ActivityLogPanelProps) {
  const [files,   setFiles]   = useState<LogFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`${apiBase}api/system/logs`);
      const data = await res.json() as LogsResponse;
      if (!data.ok) throw new Error(data.error ?? "Failed to load logs");
      setFiles(data.files ?? []);
      setLastFetch(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => { if (isOpen) fetchLogs(); }, [isOpen, fetchLogs]);

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-30 sm:hidden"
          style={{ background: "hsl(220 30% 4% / 0.6)" }}
          onClick={onClose} aria-hidden="true" />
      )}

      <aside
        data-testid="activity-log-panel"
        className="fixed top-0 right-0 h-full z-40 flex flex-col transition-transform duration-300 ease-in-out"
        style={{
          width:     "min(100vw, 420px)",
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
          background: "hsl(222 28% 7%)",
          borderLeft: "1px solid hsl(210 15% 15%)",
          boxShadow:  isOpen ? "-4px 0 32px hsl(0 0% 0% / 0.5)" : "none",
        }}
        aria-label="Activity log panel"
      >
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b"
          style={{ borderColor: "hsl(210 15% 14%)" }}>
          <div className="flex items-center gap-2">
            <ScrollText className="w-4 h-4" style={{ color: "hsl(196 100% 60%)" }} />
            <h2 className="text-sm font-bold tracking-widest" style={{ color: "hsl(196 100% 75%)" }}>
              ACTIVITY LOGS
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={fetchLogs} disabled={loading}
              title="Refresh" aria-label="Refresh logs"
              className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95 disabled:opacity-40"
              style={{ background: "hsl(196 100% 50% / 0.08)", borderColor: "hsl(196 100% 50% / 0.3)" }}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
                style={{ color: "hsl(196 100% 65%)" }} />
            </button>
            <button type="button" onClick={onClose} aria-label="Close log panel"
              className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95"
              style={{ background: "transparent", borderColor: "hsl(210 15% 28%)" }}>
              <X className="w-3.5 h-3.5" style={{ color: "hsl(210 20% 55%)" }} />
            </button>
          </div>
        </header>

        {/* Stats bar */}
        {files.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-2 border-b flex-shrink-0"
            style={{ borderColor: "hsl(210 15% 12%)" }}>
            <span className="text-xs" style={{ color: "hsl(196 40% 60%)" }}>
              {files.length} file{files.length !== 1 ? "s" : ""}
            </span>
            {lastFetch && (
              <span className="ml-auto text-[9px] font-mono" style={{ color: "hsl(210 15% 35%)" }}>
                {lastFetch.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {loading && files.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: "hsl(196 100% 60%)" }} />
              <span className="text-xs tracking-wider" style={{ color: "hsl(210 15% 45%)" }}>Reading logs…</span>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg"
              style={{ background: "hsl(355 80% 50% / 0.1)", border: "1px solid hsl(355 80% 50% / 0.3)" }}>
              <ScrollText className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "hsl(355 80% 65%)" }} />
              <div>
                <p className="text-xs font-semibold" style={{ color: "hsl(355 80% 72%)" }}>Failed to load logs</p>
                <p className="text-[10px] mt-0.5" style={{ color: "hsl(355 60% 60%)" }}>{error}</p>
              </div>
            </div>
          )}

          {!loading && !error && files.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-14">
              <Inbox className="w-10 h-10 opacity-15" style={{ color: "hsl(196 100% 60%)" }} />
              <div className="text-center">
                <p className="text-sm font-semibold" style={{ color: "hsl(210 15% 45%)" }}>
                  No log files found
                </p>
                <p className="text-[10px] mt-1 leading-relaxed" style={{ color: "hsl(210 15% 35%)" }}>
                  Log files will appear here when written to<br />
                  <span className="font-mono">.jarvas-data/logs/</span>
                </p>
              </div>
            </div>
          )}

          {files.map(file => (
            <LogFileSection key={file.name} file={file} />
          ))}
        </div>
      </aside>
    </>
  );
}
