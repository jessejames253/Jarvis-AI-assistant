/**
 * components/CheckpointsPanel.tsx — Checkpoint Rollback & Recovery panel
 *
 * Shows a timeline of project checkpoints and lets users:
 *   - Create a new checkpoint (POST /api/checkpoints/create)
 *   - Preview a restore dry-run (POST /api/checkpoints/:id/restore-preview)
 *
 * All restore operations shown here are DRY-RUN ONLY.
 * No files are modified — the preview shows what WOULD happen.
 */

import { useState, useEffect, useCallback } from "react";
import {
  X, RefreshCw, History, Plus, RotateCcw,
  CheckCircle2, AlertTriangle, XCircle, Info,
  ChevronDown, ChevronRight, Loader2, Inbox, GitBranch,
  Shield, Zap,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type CheckpointStatus = "active" | "restored" | "archived";
type OverallRisk      = "low" | "medium" | "high" | "critical";
type FileRisk         = "low" | "medium" | "high" | "critical";
type ChangeType       = "modified" | "added" | "deleted" | "unknown";

interface Checkpoint {
  id:           string;
  timestamp:    string;
  description:  string;
  commitHash?:  string;
  branch?:      string;
  changedFiles: string[];
  status:       CheckpointStatus;
}

interface AffectedFile {
  path:       string;
  risk:       FileRisk;
  reason:     string;
  existsNow:  boolean;
  changeType: ChangeType;
}

interface DependencyImpact {
  affected: boolean;
  files:    string[];
  note:     string;
}

interface ConflictEntry {
  path: string;
  note: string;
}

interface RestorePreview {
  checkpointId:     string;
  commitHash?:      string;
  filesAffected:    AffectedFile[];
  estimatedRisk:    OverallRisk;
  dependencyImpact: DependencyImpact;
  conflicts:        ConflictEntry[];
  summary:          string;
  warnings:         string[];
  generatedAt:      string;
}

interface CheckpointsPanelProps {
  isOpen:  boolean;
  onClose: () => void;
  apiBase: string;
}

// ─── Style helpers ────────────────────────────────────────────────────────────

const RISK_STYLE: Record<OverallRisk, { color: string; bg: string; border: string; label: string; Icon: React.ElementType }> = {
  low:      { color: "hsl(150 70% 60%)",  bg: "hsl(150 70% 55% / 0.10)", border: "hsl(150 70% 55% / 0.30)", label: "LOW",      Icon: CheckCircle2 },
  medium:   { color: "hsl(38 100% 65%)",  bg: "hsl(38 100% 55% / 0.10)", border: "hsl(38 100% 55% / 0.30)", label: "MEDIUM",   Icon: AlertTriangle },
  high:     { color: "hsl(355 80% 68%)",  bg: "hsl(355 80% 55% / 0.10)", border: "hsl(355 80% 55% / 0.30)", label: "HIGH",     Icon: XCircle },
  critical: { color: "hsl(310 90% 68%)",  bg: "hsl(310 90% 55% / 0.12)", border: "hsl(310 90% 55% / 0.35)", label: "CRITICAL", Icon: Zap },
};

const STATUS_STYLE: Record<CheckpointStatus, { color: string; label: string }> = {
  active:   { color: "hsl(150 70% 58%)", label: "ACTIVE"   },
  restored: { color: "hsl(264 80% 70%)", label: "RESTORED" },
  archived: { color: "hsl(210 15% 42%)", label: "ARCHIVED" },
};

const CHANGE_ICON: Record<ChangeType, string> = {
  modified: "~",
  added:    "+",
  deleted:  "–",
  unknown:  "?",
};

const CHANGE_COLOR: Record<ChangeType, string> = {
  modified: "hsl(38 100% 60%)",
  added:    "hsl(150 70% 55%)",
  deleted:  "hsl(355 80% 65%)",
  unknown:  "hsl(210 15% 42%)",
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function hashShort(h?: string): string {
  return h ? h.slice(0, 7) : "—";
}

// ─── Restore Preview Result ───────────────────────────────────────────────────

function PreviewResult({ preview }: { preview: RestorePreview }) {
  const [filesOpen,    setFilesOpen]    = useState(true);
  const [conflictsOpen, setConflictsOpen] = useState(true);
  const risk = RISK_STYLE[preview.estimatedRisk] ?? RISK_STYLE.medium;
  const { Icon: RiskIcon } = risk;

  return (
    <div className="mt-2 rounded-xl overflow-hidden"
      style={{ border: `1px solid ${risk.border}`, background: risk.bg }}>
      <div className="px-3 pt-3 pb-2">
        {/* Risk badge + summary */}
        <div className="flex items-start gap-2 mb-2">
          <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold flex items-center gap-1 flex-shrink-0 mt-0.5"
            style={{ background: `${risk.color}20`, border: `1px solid ${risk.color}50`, color: risk.color }}>
            <RiskIcon className="w-2.5 h-2.5" />
            {risk.label} RISK
          </span>
          <p className="text-[10px] leading-snug" style={{ color: "hsl(210 15% 60%)" }}>
            {preview.summary}
          </p>
        </div>

        {/* Warnings */}
        {preview.warnings.map((w, i) => (
          <div key={i} className="flex items-start gap-1.5 mb-1">
            <Info className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: "hsl(38 100% 60%)" }} />
            <p className="text-[10px]" style={{ color: "hsl(38 80% 62%)" }}>{w}</p>
          </div>
        ))}

        {/* Dependency impact */}
        <div className="mt-2 flex items-start gap-1.5">
          <Shield className={`w-3 h-3 flex-shrink-0 mt-0.5 ${preview.dependencyImpact.affected ? "text-red-400" : ""}`}
            style={{ color: preview.dependencyImpact.affected ? "hsl(355 80% 65%)" : "hsl(150 70% 55%)" }} />
          <p className="text-[10px] leading-snug" style={{ color: "hsl(210 15% 55%)" }}>
            {preview.dependencyImpact.note}
          </p>
        </div>
      </div>

      {/* Conflicts */}
      {preview.conflicts.length > 0 && (
        <div className="border-t" style={{ borderColor: `${risk.border}` }}>
          <button type="button" className="flex items-center gap-1 px-3 py-2 w-full text-left"
            onClick={() => setConflictsOpen(v => !v)}>
            {conflictsOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <span className="text-[9px] font-mono tracking-widest" style={{ color: "hsl(355 80% 65%)" }}>
              {preview.conflicts.length} CONFLICT(S)
            </span>
          </button>
          {conflictsOpen && preview.conflicts.map((c, i) => (
            <div key={i} className="flex gap-2 px-4 pb-1">
              <XCircle className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: "hsl(355 80% 65%)" }} />
              <div>
                <p className="text-[10px] font-mono" style={{ color: "hsl(355 70% 68%)" }}>{c.path}</p>
                <p className="text-[9px]" style={{ color: "hsl(210 15% 45%)" }}>{c.note}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Files affected */}
      <div className="border-t" style={{ borderColor: `${risk.border}` }}>
        <button type="button" className="flex items-center gap-1 px-3 py-2 w-full text-left"
          onClick={() => setFilesOpen(v => !v)}>
          {filesOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <span className="text-[9px] font-mono tracking-widest" style={{ color: "hsl(210 15% 45%)" }}>
            FILES AFFECTED ({preview.filesAffected.length})
          </span>
        </button>
        {filesOpen && (
          <div className="pb-2 max-h-52 overflow-y-auto">
            {preview.filesAffected.length === 0 ? (
              <p className="px-4 text-[10px]" style={{ color: "hsl(210 15% 38%)" }}>No files would change.</p>
            ) : preview.filesAffected.map((f, i) => (
              <div key={i} className="flex items-start gap-2 px-4 pb-0.5">
                <span className="text-[9px] font-mono w-3 text-center flex-shrink-0 mt-0.5 font-bold"
                  style={{ color: CHANGE_COLOR[f.changeType] }}>
                  {CHANGE_ICON[f.changeType]}
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-mono truncate" style={{ color: "hsl(196 30% 65%)" }}>{f.path}</p>
                  <p className="text-[9px]" style={{ color: "hsl(210 15% 40%)" }}>{f.reason}</p>
                </div>
                <span className="text-[8px] font-mono flex-shrink-0 mt-0.5 px-1 rounded"
                  style={{ background: `${RISK_STYLE[f.risk].color}18`, color: RISK_STYLE[f.risk].color }}>
                  {f.risk.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="px-3 pb-2 text-[9px] font-mono" style={{ color: "hsl(210 15% 30%)" }}>
        preview generated at {fmtTime(preview.generatedAt)} · dry-run only, no files changed
      </p>
    </div>
  );
}

// ─── Checkpoint card ──────────────────────────────────────────────────────────

function CheckpointCard({
  checkpoint,
  isLatest,
  onPreview,
  busy,
}: {
  checkpoint: Checkpoint;
  isLatest:   boolean;
  onPreview:  (id: string) => void;
  busy:       boolean;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview,     setPreview]     = useState<RestorePreview | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const status = STATUS_STYLE[checkpoint.status] ?? STATUS_STYLE.active;

  const handlePreview = useCallback(async () => {
    if (preview) { setPreviewOpen(v => !v); return; }
    setLoading(true); setError(null); setPreviewOpen(true);
    try {
      await onPreview(checkpoint.id);
    } finally {
      setLoading(false);
    }
  }, [checkpoint.id, onPreview, preview]);

  // Allow parent to inject preview data
  const _   = busy; // keep ref

  return (
    <div className="relative flex gap-3">
      {/* Timeline rail */}
      <div className="flex flex-col items-center flex-shrink-0 w-4">
        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-2"
          style={{ background: status.color, boxShadow: isLatest ? `0 0 6px ${status.color}` : "none" }} />
        <div className="flex-1 w-px mt-1" style={{ background: "hsl(210 15% 18%)" }} />
      </div>

      {/* Card body */}
      <div className="flex-1 min-w-0 pb-3">
        <div className="rounded-xl overflow-hidden"
          style={{ border: "1px solid hsl(210 15% 16%)", background: "hsl(220 20% 6.5%)" }}>
          <div className="px-3 pt-2.5 pb-2">
            {/* Status + time */}
            <div className="flex items-center justify-between mb-1">
              <span className="text-[8px] font-mono font-bold tracking-widest"
                style={{ color: status.color }}>
                {status.label}{isLatest ? " · LATEST" : ""}
              </span>
              <span className="text-[9px] font-mono" style={{ color: "hsl(210 15% 35%)" }}>
                {fmtTime(checkpoint.timestamp)}
              </span>
            </div>
            {/* Description */}
            <p className="text-xs font-semibold leading-snug" style={{ color: "hsl(196 40% 82%)" }}>
              {checkpoint.description}
            </p>
            {/* Meta row */}
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              {checkpoint.commitHash && (
                <span className="flex items-center gap-1 text-[9px] font-mono"
                  style={{ color: "hsl(194 100% 55%)" }}>
                  <GitBranch className="w-2.5 h-2.5" />
                  {hashShort(checkpoint.commitHash)}
                  {checkpoint.branch && ` (${checkpoint.branch})`}
                </span>
              )}
              <span className="text-[9px] font-mono" style={{ color: "hsl(210 15% 38%)" }}>
                {checkpoint.changedFiles.length} changed file{checkpoint.changedFiles.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {/* Preview button */}
          <div className="px-3 pb-2.5">
            <button type="button"
              onClick={handlePreview}
              disabled={loading}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40"
              style={{ background: "hsl(264 80% 55% / 0.1)", border: "1px solid hsl(264 80% 55% / 0.3)", color: "hsl(264 80% 72%)" }}>
              {loading
                ? <><Loader2 className="w-3 h-3 animate-spin" /> ANALYSING…</>
                : <><RotateCcw className="w-3 h-3" /> {preview ? (previewOpen ? "HIDE PREVIEW" : "SHOW PREVIEW") : "RESTORE PREVIEW"}</>
              }
            </button>
            {error && (
              <p className="mt-1 text-[10px]" style={{ color: "hsl(355 80% 65%)" }}>{error}</p>
            )}
          </div>

          {/* Inline preview result */}
          {previewOpen && preview && (
            <div className="px-3 pb-3">
              <PreviewResult preview={preview} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Create form ──────────────────────────────────────────────────────────────

function CreateForm({ apiBase, onCreated }: { apiBase: string; onCreated: (cp: Checkpoint) => void }) {
  const [open,    setOpen]    = useState(false);
  const [desc,    setDesc]    = useState("");
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState<string | null>(null);

  const submit = async () => {
    if (!desc.trim()) { setErr("Description is required."); return; }
    setSaving(true); setErr(null);
    try {
      const res  = await fetch(`${apiBase}api/checkpoints/create`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ description: desc.trim() }),
      });
      const data = await res.json() as { ok: boolean; checkpoint?: Checkpoint; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Failed to create checkpoint");
      setDesc(""); setOpen(false);
      if (data.checkpoint) onCreated(data.checkpoint);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl overflow-hidden mb-3"
      style={{ border: "1px solid hsl(210 15% 18%)", background: "hsl(220 20% 6.5%)" }}>
      <button type="button"
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
        onClick={() => setOpen(v => !v)}>
        <Plus className="w-3.5 h-3.5" style={{ color: "hsl(150 70% 58%)" }} />
        <span className="text-xs font-semibold tracking-wide" style={{ color: "hsl(150 70% 68%)" }}>
          Create checkpoint
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 border-t space-y-2" style={{ borderColor: "hsl(210 15% 14%)" }}>
          {err && <p className="text-[10px] pt-2" style={{ color: "hsl(355 80% 65%)" }}>{err}</p>}
          <div className="pt-2">
            <label className="text-[9px] font-mono tracking-widest block mb-1" style={{ color: "hsl(210 15% 42%)" }}>
              DESCRIPTION
            </label>
            <input
              value={desc} onChange={e => setDesc(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submit()}
              placeholder="e.g. Before adding auth middleware"
              className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none"
              style={{ background: "hsl(220 25% 9%)", border: "1px solid hsl(210 15% 20%)", color: "hsl(196 40% 80%)" }}
              autoFocus
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)}
              className="flex-1 py-1.5 rounded-lg text-[10px] font-bold tracking-widest transition-all active:scale-95"
              style={{ background: "transparent", border: "1px solid hsl(210 15% 22%)", color: "hsl(210 15% 48%)" }}>
              CANCEL
            </button>
            <button type="button" onClick={submit} disabled={saving}
              className="flex-1 py-1.5 rounded-lg text-[10px] font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40"
              style={{ background: "hsl(150 70% 45% / 0.15)", border: "1px solid hsl(150 70% 45% / 0.4)", color: "hsl(150 70% 65%)" }}>
              {saving ? "SAVING…" : "CREATE"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Stateful card wrapper (handles preview fetch) ────────────────────────────

function StatefulCard({
  checkpoint,
  isLatest,
  apiBase,
}: {
  checkpoint: Checkpoint;
  isLatest:   boolean;
  apiBase:    string;
}) {
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const handlePreview = useCallback(async (id: string) => {
    if (preview) { setOpen(v => !v); return; }
    setLoading(true); setError(null); setOpen(true);
    try {
      const res  = await fetch(`${apiBase}api/checkpoints/${encodeURIComponent(id)}/restore-preview`, { method: "POST" });
      const data = await res.json() as { ok: boolean; preview?: RestorePreview; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Preview failed");
      setPreview(data.preview ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }, [apiBase, preview]);

  return (
    <div className="relative flex gap-3">
      {/* Timeline rail */}
      <div className="flex flex-col items-center flex-shrink-0 w-4">
        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-2"
          style={{
            background:  STATUS_STYLE[checkpoint.status]?.color ?? "hsl(210 15% 40%)",
            boxShadow:   isLatest ? `0 0 6px ${STATUS_STYLE[checkpoint.status]?.color}` : "none",
          }} />
        <div className="flex-1 w-px mt-1" style={{ background: "hsl(210 15% 18%)" }} />
      </div>

      {/* Card body */}
      <div className="flex-1 min-w-0 pb-3">
        <div className="rounded-xl overflow-hidden"
          style={{ border: "1px solid hsl(210 15% 16%)", background: "hsl(220 20% 6.5%)" }}>
          <div className="px-3 pt-2.5 pb-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[8px] font-mono font-bold tracking-widest"
                style={{ color: STATUS_STYLE[checkpoint.status]?.color ?? "hsl(210 15% 42%)" }}>
                {STATUS_STYLE[checkpoint.status]?.label ?? checkpoint.status.toUpperCase()}{isLatest ? " · LATEST" : ""}
              </span>
              <span className="text-[9px] font-mono" style={{ color: "hsl(210 15% 35%)" }}>
                {fmtTime(checkpoint.timestamp)}
              </span>
            </div>
            <p className="text-xs font-semibold leading-snug" style={{ color: "hsl(196 40% 82%)" }}>
              {checkpoint.description}
            </p>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              {checkpoint.commitHash && (
                <span className="flex items-center gap-1 text-[9px] font-mono"
                  style={{ color: "hsl(194 100% 55%)" }}>
                  <GitBranch className="w-2.5 h-2.5" />
                  {hashShort(checkpoint.commitHash)}
                  {checkpoint.branch ? ` (${checkpoint.branch})` : ""}
                </span>
              )}
              <span className="text-[9px] font-mono" style={{ color: "hsl(210 15% 38%)" }}>
                {checkpoint.changedFiles.length} file{checkpoint.changedFiles.length !== 1 ? "s" : ""} in scope
              </span>
            </div>
          </div>

          {/* Preview button */}
          <div className="px-3 pb-2.5">
            <button type="button"
              onClick={() => handlePreview(checkpoint.id)}
              disabled={loading}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40"
              style={{ background: "hsl(264 80% 55% / 0.1)", border: "1px solid hsl(264 80% 55% / 0.3)", color: "hsl(264 80% 72%)" }}>
              {loading
                ? <><Loader2 className="w-3 h-3 animate-spin" /> ANALYSING…</>
                : <><RotateCcw className="w-3 h-3" />
                    {preview ? (open ? "HIDE PREVIEW" : "SHOW PREVIEW") : "RESTORE PREVIEW"}
                  </>
              }
            </button>
            {error && (
              <p className="mt-1 text-[10px]" style={{ color: "hsl(355 80% 65%)" }}>{error}</p>
            )}
          </div>

          {open && preview && (
            <div className="px-3 pb-3">
              <PreviewResult preview={preview} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CheckpointsPanel({ isOpen, onClose, apiBase }: CheckpointsPanelProps) {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  const fetchCheckpoints = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`${apiBase}api/checkpoints`);
      const data = await res.json() as { ok: boolean; checkpoints?: Checkpoint[]; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Failed to load checkpoints");
      setCheckpoints(data.checkpoints ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => { if (isOpen) fetchCheckpoints(); }, [isOpen, fetchCheckpoints]);

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-30 sm:hidden"
          style={{ background: "hsl(220 30% 4% / 0.6)" }}
          onClick={onClose} aria-hidden="true" />
      )}

      <aside
        data-testid="checkpoints-panel"
        className="fixed top-0 right-0 h-full z-40 flex flex-col transition-transform duration-300 ease-in-out"
        style={{
          width:      "min(100vw, 440px)",
          transform:  isOpen ? "translateX(0)" : "translateX(100%)",
          background: "hsl(222 28% 7%)",
          borderLeft: "1px solid hsl(210 15% 15%)",
          boxShadow:  isOpen ? "-4px 0 32px hsl(0 0% 0% / 0.5)" : "none",
        }}
        aria-label="Checkpoints panel"
      >
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b"
          style={{ borderColor: "hsl(210 15% 14%)" }}>
          <div className="flex items-center gap-2">
            <History className="w-4 h-4" style={{ color: "hsl(150 70% 60%)" }} />
            <h2 className="text-sm font-bold tracking-widest" style={{ color: "hsl(150 70% 72%)" }}>
              CHECKPOINTS
            </h2>
            {checkpoints.length > 0 && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full font-mono"
                style={{ background: "hsl(150 70% 55% / 0.12)", border: "1px solid hsl(150 70% 55% / 0.3)", color: "hsl(150 70% 60%)" }}>
                {checkpoints.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={fetchCheckpoints} disabled={loading}
              title="Refresh" aria-label="Refresh checkpoints"
              className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95 disabled:opacity-40"
              style={{ background: "hsl(150 70% 55% / 0.08)", borderColor: "hsl(150 70% 55% / 0.3)" }}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
                style={{ color: "hsl(150 70% 60%)" }} />
            </button>
            <button type="button" onClick={onClose} aria-label="Close checkpoints panel"
              className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95"
              style={{ background: "transparent", borderColor: "hsl(210 15% 28%)" }}>
              <X className="w-3.5 h-3.5" style={{ color: "hsl(210 20% 55%)" }} />
            </button>
          </div>
        </header>

        {/* Dry-run notice */}
        <div className="flex items-center gap-2 px-4 py-2 border-b flex-shrink-0"
          style={{ borderColor: "hsl(210 15% 12%)", background: "hsl(264 80% 55% / 0.05)" }}>
          <Shield className="w-3 h-3 flex-shrink-0" style={{ color: "hsl(264 80% 65%)" }} />
          <p className="text-[9px] font-mono" style={{ color: "hsl(264 80% 60%)" }}>
            Restore previews are DRY-RUN ONLY — no files are modified.
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {/* Create form */}
          <CreateForm
            apiBase={apiBase}
            onCreated={cp => setCheckpoints(prev => [cp, ...prev])}
          />

          {loading && checkpoints.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: "hsl(150 70% 60%)" }} />
              <span className="text-xs tracking-wider" style={{ color: "hsl(210 15% 45%)" }}>Loading checkpoints…</span>
            </div>
          )}

          {!loading && checkpoints.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <Inbox className="w-10 h-10 opacity-15" style={{ color: "hsl(150 70% 55%)" }} />
              <div className="text-center">
                <p className="text-sm font-semibold" style={{ color: "hsl(210 15% 45%)" }}>No checkpoints yet</p>
                <p className="text-[10px] mt-1" style={{ color: "hsl(210 15% 35%)" }}>
                  Create one above to capture the current project state.
                </p>
              </div>
            </div>
          )}

          {/* Timeline */}
          {checkpoints.length > 0 && (
            <div>
              {checkpoints.map((cp, i) => (
                <StatefulCard
                  key={cp.id}
                  checkpoint={cp}
                  isLatest={i === 0}
                  apiBase={apiBase}
                />
              ))}
              {/* End of timeline */}
              <div className="flex items-center gap-2 pl-5 pt-1">
                <div className="w-2 h-2 rounded-full" style={{ background: "hsl(210 15% 22%)" }} />
                <span className="text-[9px] font-mono" style={{ color: "hsl(210 15% 30%)" }}>
                  beginning of history
                </span>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
