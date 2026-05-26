/**
 * components/DevAgentPanel.tsx — Dev Agent overlay panel.
 *
 * Tabs: Chat | Files | Memory | Snapshots
 *
 * Features:
 * - Backend task creation/restore (POST /api/dev/tasks, persists across restarts)
 * - SSE reconnect button when connection drops unexpectedly
 * - Apply patches → auto-validation → git commit + snapshot restore buttons
 * - Project memory tab (view / add / delete)
 * - Full localStorage fallback for messages
 * - File browser with quick-access dirs and file viewer
 */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  X, Code2, FileSearch, FileEdit, CheckCircle, XCircle,
  AlertTriangle, Trash2, RotateCcw, ClipboardCopy, Check,
  FolderOpen, Folder, FileText, ChevronRight, GitCommit,
  WifiOff, RefreshCw, BookOpen, Plus, Database,
  Server, GitBranch, Layers, Archive, Play, HardDrive, Zap, Network,
} from "lucide-react";
import DiffViewer from "./DiffViewer";
import MultiAgentPanel from "./MultiAgentPanel";
import MarkdownContent from "./MarkdownContent";

const BASE          = import.meta.env.BASE_URL;
const STREAM_URL    = `${BASE}api/dev/stream`;
const APPLY_URL     = `${BASE}api/dev/apply`;
const ROLLBACK_URL  = `${BASE}api/dev/rollback`;
const FILES_URL     = `${BASE}api/dev/files`;
const FILE_URL      = `${BASE}api/dev/file`;
const TASKS_URL     = `${BASE}api/dev/tasks`;
const GIT_URL       = `${BASE}api/dev/git`;
const MEMORY_URL    = `${BASE}api/dev/project-memory`;
const SNAP_URL      = `${BASE}api/dev/snapshots`;
const PATCHES_URL      = `${BASE}api/dev/patches`;
const HEALTH_URL       = `${BASE}api/healthz`;
const DEV_HEALTH_URL   = `${BASE}api/dev/health`;
const IMPROVEMENTS_URL = `${BASE}api/dev/improvements`;
const AUTOFIX_URL        = `${BASE}api/dev/autofix`;
const AUTOFIX_HIST_URL   = `${BASE}api/dev/autofix/history`;
const AUTOFIX_LATEST_URL = `${BASE}api/dev/autofix/latest`;
const DEV_CONTEXT_URL  = `${BASE}api/dev/context`;
const SNAP_RESTORE_URL = `${BASE}api/dev/snapshots`;

const LS_MESSAGES   = "jarvas_dev_messages";
const LS_TASK_ID    = "jarvas_dev_current_task";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PatchMetadata {
  riskLevel?: "low" | "medium" | "high";
  uiImpact?: string;
  logicImpact?: string;
  safeToTest?: boolean;
}

interface PatchData extends PatchMetadata {
  patchId: string;
  file: string;
  description: string;
  oldContent: string;
  newContent: string;
  linesAdded?: number;
  snapshotId?: string;
}

type DevEventType =
  | "agent_text" | "file_op" | "tool_start" | "tool_done" | "tool_error"
  | "patch_proposed" | "patch_applied" | "patch_rejected"
  | "check_started" | "check_passed" | "check_failed"
  | "validation_started" | "validation_done"
  | "status" | "manual_patch" | "restore_notice" | "error" | "done";

interface DevMessage {
  id: string;
  type: DevEventType;
  text?: string;
  patch?: PatchData;
  op?: string;
  path?: string;
  pattern?: string;
  check?: string;
  project?: string;
  output?: string;
  error?: string;
  applying?: boolean;
  rollingBack?: boolean;
  committing?: boolean;
  taskId?: string;
  validationPassed?: boolean;
  validationSummary?: string;
  stage?: string;
  stageDetail?: string;
}

interface MemoryEntry {
  id: string;
  category: string;
  title: string;
  content: string;
  createdAt: number;
}

interface TaskSuggestion {
  label: string;
  prompt: string;
  priority: "high" | "medium" | "low";
}

interface DevContextData {
  health:       { score: number; label: string; feErrors: number; beErrors: number };
  patches:      { count: number; files: string[] };
  improvements: { total: number; autoFixable: number; categories: string[] };
  tasks:        { open: number; recent: Array<{ id: string; title: string; status: string }> };
  git:          { branch: string; dirty: boolean; changes: number };
  rollbacks:    Array<{ title: string; reason: string; at: number }>;
  errors:       Array<{ taskTitle: string; error: string; at: number }>;
  snapshotAt:   number;
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

function saveMessages(msgs: DevMessage[]): void {
  try {
    const filtered = msgs
      .filter(m => m.type !== "restore_notice")
      .map(m => ({ ...m, applying: false, rollingBack: false, committing: false }));
    const json = JSON.stringify(filtered);
    localStorage.setItem(LS_MESSAGES, json.length > 400_000 ? JSON.stringify(filtered.slice(-60)) : json);
  } catch { /* quota */ }
}

function loadMessages(): DevMessage[] {
  try {
    const raw = localStorage.getItem(LS_MESSAGES);
    return raw ? (JSON.parse(raw) as DevMessage[]) : [];
  } catch { return []; }
}

/** Re-hydrate patch cards from the backend after a reload.
 *  Finds patch_proposed messages that are missing their `.patch` data
 *  and fills them in from the /api/dev/patches response. */
async function rehydratePatches(
  msgs: DevMessage[],
  setMessages: React.Dispatch<React.SetStateAction<DevMessage[]>>,
): Promise<void> {
  const needsHydration = msgs.some(m => m.type === "patch_proposed" && !m.patch && m.patch === undefined);
  if (!needsHydration) return;
  try {
    const res = await fetch(PATCHES_URL);
    if (!res.ok) return;
    const data = await res.json() as { ok: boolean; patches?: Array<{
      patchId: string; file: string; description: string;
      oldContent: string; newContent: string; createdAt: number;
      riskLevel?: "low" | "medium" | "high"; uiImpact?: string;
      logicImpact?: string; safeToTest?: boolean;
    }> };
    if (!data.ok || !data.patches?.length) return;
    const byId = new Map(data.patches.map(p => [p.patchId, p]));
    setMessages(prev => {
      const updated = prev.map(m => {
        if (m.type !== "patch_proposed" || m.patch) return m;
        // Try to find by patchId stored on message, or match by position
        const patchId = (m as DevMessage & { patchId?: string }).patchId;
        const backend = patchId ? byId.get(patchId) : undefined;
        if (!backend) return m;
        return {
          ...m,
          patch: {
            patchId: backend.patchId,
            file: backend.file,
            description: backend.description,
            oldContent: backend.oldContent,
            newContent: backend.newContent,
            linesAdded: backend.newContent.split("\n").length - backend.oldContent.split("\n").length,
            riskLevel: backend.riskLevel,
            uiImpact: backend.uiImpact,
            logicImpact: backend.logicImpact,
            safeToTest: backend.safeToTest,
          } satisfies PatchData,
        };
      });
      saveMessages(updated);
      return updated;
    });
  } catch { /* non-fatal */ }
}

function clearMessages(): void {
  localStorage.removeItem(LS_MESSAGES);
  localStorage.removeItem(LS_TASK_ID);
}

function getSavedTaskId(): string | null { return localStorage.getItem(LS_TASK_ID); }
function saveTaskId(id: string | null): void {
  if (id) localStorage.setItem(LS_TASK_ID, id);
  else localStorage.removeItem(LS_TASK_ID);
}

// ─── Small cards ─────────────────────────────────────────────────────────────

function FileOpCard({ msg }: { msg: DevMessage }) {
  const label = msg.op === "read" ? "Read" : msg.op === "search" ? `Search: ${msg.pattern}` : "List";
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs" style={{ background: "hsl(210 15% 8%)", border: "1px solid hsl(210 15% 15%)" }}>
      <FileSearch className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(194 100% 55%)" }} />
      <span style={{ color: "hsl(196 30% 55%)" }}>{label}</span>
      <span className="font-mono truncate" style={{ color: "hsl(196 50% 65%)" }}>{msg.path}</span>
    </div>
  );
}

function CheckCard({ msg }: { msg: DevMessage }) {
  const isPassed  = msg.type === "check_passed";
  const isRunning = msg.type === "check_started";
  const isVal     = msg.type === "validation_started" || msg.type === "validation_done";
  const color = isPassed ? "hsl(142 71% 55%)" : isRunning ? "hsl(194 100% 60%)" : "hsl(355 80% 62%)";
  const label = isVal
    ? (isRunning ? "Validation running…" : (msg.validationPassed ? "Validation passed" : "Validation failed"))
    : isRunning ? `Running ${msg.check}…` : isPassed ? `${msg.check} passed` : `${msg.check} failed`;
  return (
    <div className="rounded-lg text-xs overflow-hidden" style={{ border: `1px solid ${color}30`, background: `${color}0a` }}>
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span style={{ color }}>
          {isPassed || (msg.type === "validation_done" && msg.validationPassed)
            ? <CheckCircle className="w-3.5 h-3.5" />
            : isRunning || msg.type === "validation_started"
              ? <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin inline-block" />
              : <XCircle className="w-3.5 h-3.5" />}
        </span>
        <span style={{ color }}>{label}</span>
        {msg.project && <span className="ml-auto font-mono opacity-60" style={{ color }}>@{msg.project}</span>}
      </div>
      {msg.output && !isPassed && (
        <pre className="px-3 pb-2 text-xs overflow-x-auto max-h-32 scrollbar-thin whitespace-pre-wrap" style={{ color: "hsl(196 20% 45%)" }}>
          {msg.output.slice(0, 600)}
        </pre>
      )}
    </div>
  );
}

function ManualPatchCard({ msg }: { msg: DevMessage }) {
  const [copied, setCopied] = useState(false);
  const patch = msg.patch;
  if (!patch) return null;
  const copy = () => {
    navigator.clipboard.writeText(patch.newContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="rounded-lg overflow-hidden text-xs" style={{ background: "hsl(38 80% 30% / 0.1)", border: "1px solid hsl(38 80% 50% / 0.3)" }}>
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "hsl(38 80% 50% / 0.2)" }}>
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(38 100% 62%)" }} />
          <span className="font-semibold" style={{ color: "hsl(38 100% 72%)" }}>Manual Patch Required</span>
        </div>
        <button type="button" onClick={copy}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all active:scale-95"
          style={{ background: "hsl(38 80% 50% / 0.15)", border: "1px solid hsl(38 80% 50% / 0.35)", color: copied ? "hsl(142 71% 60%)" : "hsl(38 100% 72%)" }}>
          {copied ? <Check className="w-3 h-3" /> : <ClipboardCopy className="w-3 h-3" />}
          {copied ? "Copied!" : "Copy file"}
        </button>
      </div>
      <div className="px-3 py-2 flex flex-col gap-1.5">
        <p style={{ color: "hsl(38 80% 60%)" }}>
          <span className="opacity-60">File: </span>
          <span className="font-mono">{patch.file}</span>
        </p>
        {patch.description && <p style={{ color: "hsl(38 60% 55%)" }}>{patch.description}</p>}
        <details>
          <summary className="cursor-pointer select-none" style={{ color: "hsl(38 80% 55%)" }}>
            View new content ({patch.newContent.split("\n").length} lines)
          </summary>
          <pre className="mt-2 p-2 rounded overflow-x-auto max-h-64 scrollbar-thin text-[11px] whitespace-pre-wrap break-all" style={{ background: "hsl(220 20% 6%)", color: "hsl(196 40% 65%)" }}>
            {patch.newContent}
          </pre>
        </details>
      </div>
    </div>
  );
}

// ─── File Browser ─────────────────────────────────────────────────────────────

function FileBrowser({ onInsertPath }: { onInsertPath: (p: string) => void }) {
  const [dir, setDir]       = useState("artifacts/jarvas/src");
  const [files, setFiles]   = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewFile, setViewFile] = useState<{ path: string; content: string; lines: number } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const loadDir = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const res  = await fetch(`${FILES_URL}?dir=${encodeURIComponent(d)}&depth=2`);
      const data = await res.json() as { ok: boolean; files?: string[] };
      if (data.ok && data.files) setFiles(data.files);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadDir(dir); }, [dir, loadDir]);

  const openFile = async (filePath: string) => {
    setLoading(true);
    try {
      const res  = await fetch(`${FILE_URL}?path=${encodeURIComponent(filePath)}`);
      const data = await res.json() as { ok: boolean; content?: string; lines?: number };
      if (data.ok && data.content) setViewFile({ path: filePath, content: data.content, lines: data.lines ?? 0 });
    } catch { /* ignore */ }
    setLoading(false);
  };

  const QUICK_DIRS = [
    { label: "Frontend src", dir: "artifacts/jarvas/src" },
    { label: "Components",   dir: "artifacts/jarvas/src/components" },
    { label: "API routes",   dir: "artifacts/api-server/src/routes" },
    { label: "API lib",      dir: "artifacts/api-server/src/lib" },
  ];

  if (viewFile) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-2 border-b flex-shrink-0" style={{ borderColor: "hsl(210 15% 13%)" }}>
          <button type="button" onClick={() => setViewFile(null)} className="text-xs opacity-60 hover:opacity-100" style={{ color: "hsl(194 100% 55%)" }}>← Back</button>
          <span className="font-mono text-xs truncate flex-1" style={{ color: "hsl(196 50% 65%)" }}>{viewFile.path}</span>
          <span className="text-xs opacity-50" style={{ color: "hsl(196 30% 50%)" }}>{viewFile.lines} lines</span>
          <button type="button" onClick={() => onInsertPath(viewFile.path)}
            className="text-xs px-2 py-0.5 rounded-md"
            style={{ background: "hsl(194 100% 50% / 0.12)", border: "1px solid hsl(194 100% 50% / 0.3)", color: "hsl(194 100% 65%)" }}>
            Use in prompt
          </button>
        </div>
        <pre className="flex-1 overflow-auto p-3 text-xs font-mono whitespace-pre scrollbar-thin" style={{ color: "hsl(196 40% 65%)" }}>
          {viewFile.content}
        </pre>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b flex-shrink-0" style={{ borderColor: "hsl(210 15% 13%)" }}>
        {QUICK_DIRS.map(q => (
          <button key={q.dir} type="button" onClick={() => { setDir(q.dir); setExpanded(new Set()); }}
            className="text-[10px] px-2 py-0.5 rounded-md transition-all"
            style={{
              background: dir === q.dir ? "hsl(194 100% 50% / 0.12)" : "hsl(210 15% 10%)",
              border: `1px solid ${dir === q.dir ? "hsl(194 100% 50% / 0.4)" : "hsl(210 15% 18%)"}`,
              color: dir === q.dir ? "hsl(194 100% 65%)" : "hsl(196 40% 55%)",
            }}>
            {q.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin px-2 py-2">
        {loading && <div className="text-xs px-2 opacity-50" style={{ color: "hsl(194 100% 55%)" }}>Loading…</div>}
        {files.map(f => {
          const isDir  = f.endsWith("/");
          const depth  = f.split("/").length - (isDir ? 2 : 1);
          const name   = f.split("/").filter(Boolean).pop() ?? f;
          const isOpen = expanded.has(f);
          return (
            <button key={f} type="button"
              onClick={() => {
                if (isDir) { const n = new Set(expanded); isOpen ? n.delete(f) : n.add(f); setExpanded(n); }
                else openFile(f);
              }}
              className="flex items-center gap-1.5 w-full text-left px-2 py-0.5 rounded hover:bg-white/5 transition-colors text-xs"
              style={{ paddingLeft: `${8 + depth * 12}px`, color: isDir ? "hsl(194 100% 60%)" : "hsl(196 40% 60%)" }}>
              {isDir
                ? (isOpen ? <FolderOpen className="w-3 h-3 flex-shrink-0" /> : <Folder className="w-3 h-3 flex-shrink-0" />)
                : <FileText className="w-3 h-3 flex-shrink-0" style={{ color: "hsl(196 30% 45%)" }} />}
              <span className="truncate font-mono">{name}{isDir ? "/" : ""}</span>
              {isDir && <ChevronRight className="w-3 h-3 ml-auto flex-shrink-0 transition-transform" style={{ transform: isOpen ? "rotate(90deg)" : "none", opacity: 0.4 }} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Memory Tab ───────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  "architecture":   "hsl(264 80% 72%)",
  "coding-rules":   "hsl(38 100% 62%)",
  "ui-conventions": "hsl(194 100% 60%)",
  "known-bugs":     "hsl(355 80% 62%)",
  "file-map":       "hsl(142 71% 55%)",
  "deployment":     "hsl(196 50% 60%)",
  "general":        "hsl(210 15% 55%)",
};

function MemoryTab() {
  const [entries, setEntries]   = useState<MemoryEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [adding, setAdding]     = useState(false);
  const [form, setForm]         = useState({ category: "general", title: "", content: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(MEMORY_URL);
      const data = await res.json() as { ok: boolean; entries?: MemoryEntry[] };
      if (data.ok) setEntries(data.entries ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!form.content.trim()) return;
    try {
      const res = await fetch(MEMORY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json() as { ok: boolean; entry?: MemoryEntry };
      if (data.ok && data.entry) {
        setEntries(prev => [...prev, data.entry!]);
        setForm({ category: "general", title: "", content: "" });
        setAdding(false);
      }
    } catch { /* ignore */ }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`${MEMORY_URL}/${id}`, { method: "DELETE" });
      setEntries(prev => prev.filter(e => e.id !== id));
    } catch { /* ignore */ }
  };

  // Group by category
  const grouped = entries.reduce<Record<string, MemoryEntry[]>>((acc, e) => {
    (acc[e.category] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b flex-shrink-0" style={{ borderColor: "hsl(210 15% 13%)" }}>
        <span className="text-xs font-semibold" style={{ color: "hsl(264 80% 72%)" }}>Project Memory</span>
        <button type="button" onClick={() => setAdding(!adding)}
          className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-md transition-all"
          style={{ background: "hsl(264 80% 60% / 0.12)", border: "1px solid hsl(264 80% 60% / 0.3)", color: "hsl(264 80% 72%)" }}>
          <Plus className="w-3 h-3" />Add note
        </button>
      </div>

      {adding && (
        <div className="px-3 py-3 border-b flex-shrink-0" style={{ borderColor: "hsl(210 15% 13%)", background: "hsl(264 40% 8% / 0.5)" }}>
          <div className="flex flex-col gap-2">
            <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
              className="w-full text-xs px-2 py-1.5 rounded-lg outline-none"
              style={{ background: "hsl(210 20% 10%)", border: "1px solid hsl(210 15% 22%)", color: "hsl(196 40% 65%)" }}>
              {Object.keys(CATEGORY_COLORS).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
              placeholder="Title (optional)"
              className="w-full text-xs px-2 py-1.5 rounded-lg outline-none placeholder:opacity-40"
              style={{ background: "hsl(210 20% 10%)", border: "1px solid hsl(210 15% 22%)", color: "hsl(196 40% 65%)" }} />
            <textarea value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))}
              placeholder="Note content…"
              rows={3}
              className="w-full text-xs px-2 py-1.5 rounded-lg outline-none resize-none placeholder:opacity-40"
              style={{ background: "hsl(210 20% 10%)", border: "1px solid hsl(210 15% 22%)", color: "hsl(196 40% 65%)" }} />
            <div className="flex gap-2">
              <button type="button" onClick={handleAdd}
                className="text-xs px-3 py-1 rounded-lg"
                style={{ background: "hsl(264 60% 50% / 0.2)", border: "1px solid hsl(264 60% 55% / 0.4)", color: "hsl(264 80% 75%)" }}>
                Save
              </button>
              <button type="button" onClick={() => setAdding(false)}
                className="text-xs px-3 py-1 rounded-lg opacity-60 hover:opacity-100"
                style={{ color: "hsl(196 30% 55%)" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-3 flex flex-col gap-4">
        {loading && <div className="text-xs opacity-50 text-center py-4" style={{ color: "hsl(196 30% 55%)" }}>Loading memory…</div>}
        {!loading && entries.length === 0 && (
          <div className="text-xs opacity-50 text-center py-4" style={{ color: "hsl(196 30% 55%)" }}>No memory entries yet. Add notes to help the agent understand your project.</div>
        )}
        {Object.entries(grouped).map(([cat, items]) => (
          <div key={cat}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: CATEGORY_COLORS[cat] ?? "hsl(196 40% 55%)" }}>{cat}</span>
              <div className="flex-1 border-t" style={{ borderColor: "hsl(210 15% 14%)" }} />
            </div>
            <div className="flex flex-col gap-1.5">
              {items.map(e => (
                <div key={e.id} className="flex items-start gap-2 px-2.5 py-2 rounded-lg group"
                  style={{ background: "hsl(210 15% 8%)", border: "1px solid hsl(210 15% 14%)" }}>
                  <Database className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: CATEGORY_COLORS[cat] ?? "hsl(196 40% 55%)" }} />
                  <div className="flex-1 min-w-0">
                    {e.title && <p className="text-[10px] font-semibold mb-0.5 truncate" style={{ color: CATEGORY_COLORS[cat] ?? "hsl(196 40% 65%)" }}>{e.title}</p>}
                    <p className="text-xs leading-relaxed" style={{ color: "hsl(196 30% 55%)" }}>{e.content}</p>
                  </div>
                  <button type="button" onClick={() => handleDelete(e.id)}
                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity flex-shrink-0 mt-0.5"
                    style={{ color: "hsl(355 70% 55%)" }}>
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Status Bar ───────────────────────────────────────────────────────────────

interface HealthData {
  score: number;
  label: "healthy" | "degraded" | "failing";
  typescript: {
    frontend: { ok: boolean; errorCount: number; errors: string[] };
    backend:  { ok: boolean; errorCount: number; errors: string[] };
  };
  lastChecked: number;
  cached: boolean;
}

interface StatusData {
  apiOnline: boolean;
  patchCount: number;
  gitBranch: string;
  gitDirty: boolean;
  taskStatus: string | null;
  tmpWarning: boolean;
  health: HealthData | null;
}

function StatusBar({
  onSwitchTab,
  taskStatus,
}: {
  onSwitchTab: (t: PanelTab) => void;
  taskStatus: string | null;
}) {
  const [status, setStatus] = useState<StatusData>({
    apiOnline: false, patchCount: 0, gitBranch: "main",
    gitDirty: false, taskStatus, tmpWarning: true, health: null,
  });
  const [showFlyout, setShowFlyout] = useState(false);
  const flyoutRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [apiOk, patches, git, devHealth] = await Promise.all([
        fetch(HEALTH_URL).then(r => r.ok).catch(() => false),
        fetch(PATCHES_URL).then(r => r.json() as Promise<{ ok: boolean; patches?: unknown[] }>).catch(() => ({ ok: false, patches: [] })),
        fetch(`${GIT_URL}/status`).then(r => r.json() as Promise<{ branch?: string; changes?: Array<{ status: string; file: string }> | number }>).catch(() => ({} as { branch?: string; changes?: Array<{ status: string; file: string }> | number })),
        fetch(DEV_HEALTH_URL).then(r => r.json() as Promise<HealthData & { ok: boolean }>).catch(() => null),
      ]);
      setStatus({
        apiOnline: apiOk === true,
        patchCount: (patches.patches ?? []).length,
        gitBranch: git.branch ?? "main",
        gitDirty: (Array.isArray(git.changes) ? git.changes.length : (git.changes ?? 0)) > 0,
        taskStatus,
        tmpWarning: true,
        health: devHealth?.ok ? devHealth : null,
      });
    } catch { /* ignore */ }
  }, [taskStatus]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => { setStatus(s => ({ ...s, taskStatus })); }, [taskStatus]);

  // Close flyout on outside click
  useEffect(() => {
    if (!showFlyout) return;
    const handler = (e: MouseEvent) => {
      if (flyoutRef.current && !flyoutRef.current.contains(e.target as Node)) {
        setShowFlyout(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showFlyout]);

  const dot = (on: boolean) => (
    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 inline-block"
      style={{ background: on ? "hsl(142 71% 55%)" : "hsl(355 80% 55%)" }} />
  );

  const h = status.health;
  const healthColor =
    !h              ? "hsl(196 30% 45%)"
    : h.label === "healthy"  ? "hsl(142 71% 55%)"
    : h.label === "degraded" ? "hsl(38 100% 62%)"
    : "hsl(355 80% 62%)";

  const totalErrors = h
    ? h.typescript.frontend.errorCount + h.typescript.backend.errorCount
    : 0;

  return (
    <div className="relative flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5 border-b flex-shrink-0 text-[10px]"
      style={{ borderColor: "hsl(210 15% 12%)", background: "hsl(220 20% 5.5%)" }}>

      {/* API */}
      <span className="flex items-center gap-1.5" style={{ color: status.apiOnline ? "hsl(142 71% 55%)" : "hsl(355 80% 62%)" }}>
        {dot(status.apiOnline)}
        <Server className="w-2.5 h-2.5" />
        {status.apiOnline ? "API online" : "API offline"}
      </span>

      {/* Health badge — opens flyout */}
      <button type="button"
        onClick={() => setShowFlyout(v => !v)}
        className="flex items-center gap-1.5 transition-opacity hover:opacity-100 opacity-90"
        style={{ color: healthColor }}>
        <Zap className="w-2.5 h-2.5" />
        {h ? `${h.score} ${h.label}` : "health …"}
        {totalErrors > 0 && (
          <span className="px-1 py-0.5 rounded text-[9px] font-mono"
            style={{ background: `${healthColor}20`, border: `1px solid ${healthColor}40` }}>
            {totalErrors} err
          </span>
        )}
      </button>

      {/* Patches */}
      <button type="button" onClick={() => onSwitchTab("patches")}
        className="flex items-center gap-1.5 transition-opacity hover:opacity-100 opacity-80"
        style={{ color: status.patchCount > 0 ? "hsl(38 100% 62%)" : "hsl(196 30% 50%)" }}>
        <Layers className="w-2.5 h-2.5" />
        {status.patchCount} patch{status.patchCount !== 1 ? "es" : ""} pending
      </button>

      {/* Git */}
      <span className="flex items-center gap-1.5" style={{ color: status.gitDirty ? "hsl(38 80% 62%)" : "hsl(196 30% 50%)" }}>
        <GitBranch className="w-2.5 h-2.5" />
        {status.gitBranch}
        {status.gitDirty ? " ·dirty" : " ·clean"}
      </span>

      {/* Task */}
      {taskStatus && (
        <span className="flex items-center gap-1.5"
          style={{ color: taskStatus === "waiting_approval" ? "hsl(264 80% 72%)" : taskStatus === "running" ? "hsl(38 100% 62%)" : "hsl(196 30% 50%)" }}>
          <Archive className="w-2.5 h-2.5" />
          {taskStatus}
        </span>
      )}

      {/* /tmp warning */}
      <span className="flex items-center gap-1 ml-auto opacity-50 hidden sm:flex" style={{ color: "hsl(38 60% 55%)" }}>
        <HardDrive className="w-2.5 h-2.5" />
        data in /tmp (ephemeral)
      </span>

      {/* ── Health flyout ── */}
      {showFlyout && (
        <div ref={flyoutRef}
          className="absolute bottom-full left-0 mb-1 z-10 rounded-xl overflow-hidden shadow-2xl"
          style={{
            width: "min(480px, 95vw)",
            background: "hsl(220 20% 6%)",
            border: "1px solid hsl(210 15% 16%)",
            boxShadow: "0 0 40px hsl(194 100% 40% / 0.06), 0 16px 40px hsl(220 25% 2% / 0.7)",
          }}>

          {/* Flyout header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b"
            style={{ borderColor: "hsl(210 15% 13%)" }}>
            <div className="flex items-center gap-2">
              <Zap className="w-3.5 h-3.5" style={{ color: healthColor }} />
              <span className="text-xs font-semibold" style={{ color: healthColor }}>
                Build Health
                {h && <span className="ml-2 font-mono">{h.score}/100 — {h.label}</span>}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {h && (
                <span className="text-[9px] opacity-40" style={{ color: "hsl(196 30% 55%)" }}>
                  {h.cached ? "cached" : "fresh"} · {new Date(h.lastChecked).toLocaleTimeString()}
                </span>
              )}
              <button type="button"
                onClick={e => { e.stopPropagation(); void refresh(); setShowFlyout(false); }}
                className="p-1 rounded opacity-50 hover:opacity-100 transition-opacity"
                style={{ color: "hsl(196 30% 55%)" }}>
                <RefreshCw className="w-3 h-3" />
              </button>
              <button type="button" onClick={() => setShowFlyout(false)}
                className="p-1 rounded opacity-50 hover:opacity-100 transition-opacity"
                style={{ color: "hsl(196 30% 55%)" }}>
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>

          {!h && (
            <div className="px-4 py-3 text-xs opacity-50" style={{ color: "hsl(196 30% 55%)" }}>
              Loading health data… (first check takes ~10s)
            </div>
          )}

          {h && (
            <div className="px-4 py-3 flex flex-col gap-3">
              {/* Score bar */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(210 15% 14%)" }}>
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${h.score}%`, background: healthColor }} />
                </div>
                <span className="text-xs font-mono font-semibold w-8 text-right" style={{ color: healthColor }}>
                  {h.score}
                </span>
              </div>

              {/* Frontend check */}
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  {h.typescript.frontend.ok
                    ? <CheckCircle className="w-3 h-3" style={{ color: "hsl(142 71% 55%)" }} />
                    : <AlertTriangle className="w-3 h-3" style={{ color: "hsl(38 100% 62%)" }} />}
                  <span className="text-[10px] font-semibold" style={{ color: "hsl(196 40% 60%)" }}>
                    Frontend (jarvas)
                  </span>
                  {!h.typescript.frontend.ok && (
                    <span className="text-[9px] ml-auto font-mono" style={{ color: "hsl(38 100% 62%)" }}>
                      {h.typescript.frontend.errorCount} error{h.typescript.frontend.errorCount !== 1 ? "s" : ""}
                    </span>
                  )}
                  {h.typescript.frontend.ok && (
                    <span className="text-[9px] ml-auto" style={{ color: "hsl(142 71% 55%)" }}>clean</span>
                  )}
                </div>
                {h.typescript.frontend.errors.length > 0 && (
                  <div className="rounded-lg overflow-y-auto text-[9px] font-mono px-2 py-1.5 flex flex-col gap-0.5"
                    style={{ maxHeight: "80px", background: "hsl(220 20% 5%)", color: "hsl(355 70% 62%)" }}>
                    {h.typescript.frontend.errors.map((e, i) => <div key={i}>{e}</div>)}
                  </div>
                )}
              </div>

              {/* Backend check */}
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  {h.typescript.backend.ok
                    ? <CheckCircle className="w-3 h-3" style={{ color: "hsl(142 71% 55%)" }} />
                    : <AlertTriangle className="w-3 h-3" style={{ color: "hsl(38 100% 62%)" }} />}
                  <span className="text-[10px] font-semibold" style={{ color: "hsl(196 40% 60%)" }}>
                    Backend (api-server)
                  </span>
                  {!h.typescript.backend.ok && (
                    <span className="text-[9px] ml-auto font-mono" style={{ color: "hsl(38 100% 62%)" }}>
                      {h.typescript.backend.errorCount} error{h.typescript.backend.errorCount !== 1 ? "s" : ""}
                    </span>
                  )}
                  {h.typescript.backend.ok && (
                    <span className="text-[9px] ml-auto" style={{ color: "hsl(142 71% 55%)" }}>clean</span>
                  )}
                </div>
                {h.typescript.backend.errors.length > 0 && (
                  <div className="rounded-lg overflow-y-auto text-[9px] font-mono px-2 py-1.5 flex flex-col gap-0.5"
                    style={{ maxHeight: "80px", background: "hsl(220 20% 5%)", color: "hsl(355 70% 62%)" }}>
                    {h.typescript.backend.errors.map((e, i) => <div key={i}>{e}</div>)}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Patches Tab (Approval Queue) ─────────────────────────────────────────────

interface PendingPatchFull {
  patchId: string;
  file: string;
  description: string;
  oldContent: string;
  newContent: string;
  riskLevel?: "low" | "medium" | "high";
  uiImpact?: string;
  logicImpact?: string;
  safeToTest?: boolean;
  testCommand?: string;
  createdAt: number;
}

interface AppliedPatch extends PendingPatchFull {
  appliedAt: number;
  snapshotId?: string;
  validationPassed: boolean;
  validationSummary: string;
  rolledBack?: boolean;
  rollbackPending?: boolean;
  rollbackValidationPassed?: boolean;
}

// ─── AutoFix types (Phase 3C) ─────────────────────────────────────────────────

type FixRisk = "safe" | "review" | "risky" | "blocked";
type IssueType =
  | "unused-import" | "missing-import" | "invalid-css-style"
  | "missing-type" | "wrong-export-name" | "endpoint-route-mismatch"
  | "syntax-typo" | "unknown";

interface DetectedIssueFE {
  id: string;
  type: IssueType;
  file: string;
  line?: number;
  errorCode?: number;
  errorText: string;
  risk: FixRisk;
  confidence: number;
}

interface AutoFixProposalFE {
  issueId: string;
  issue: DetectedIssueFE;
  description: string;
  file: string;
  patchId?: string;
  testCommand: string;
  status: "auto-applied" | "queued" | "blocked" | "skipped" | "failed";
  validationPassed?: boolean;
  snapshotId?: string;
  reason?: string;
  confidence: number;
  appliedAt?: number;
}

interface AutoFixResultFE {
  proposals: AutoFixProposalFE[];
  autoApplied: number;
  queued: number;
  blocked: number;
  attempts: number;
  finalValidationPassed?: boolean;
  ranAt: number;
}

// ─── Improvements Section ────────────────────────────────────────────────────
// Shows proposed code improvements with risk badges and guarded apply button.
// Human approval is always required — no autonomous execution.

interface FrontendImprovement {
  id: string;
  title: string;
  description: string;
  category: string;
  riskLevel: "low" | "medium" | "high";
  status: string;
  files: string[];
  autoFixable: boolean;
  createdAt: number;
  updatedAt: number;
  appliedAt?: number;
  failureReason?: string;
}

interface AutofixHistEntry {
  id: string;
  improvementTitle: string;
  file: string;
  category: string;
  appliedAt: number;
  validationPassed: boolean;
  rolledBack: boolean;
  rollbackReason?: string;
  healthScoreBefore: number;
  healthScoreAfter: number;
}

function ImprovementsSection({
  onMessage,
}: {
  onMessage: (msg: string, isError?: boolean) => void;
}) {
  const [improvements, setImprovements] = useState<FrontendImprovement[]>([]);
  const [loading,     setLoading]       = useState(true);
  const [scanning,    setScanning]      = useState(false);
  const [applying,    setApplying]      = useState<Record<string, boolean>>({});
  const [expanded,    setExpanded]      = useState<Record<string, boolean>>({});
  const [showHistory, setShowHistory]   = useState(false);
  const [history,     setHistory]       = useState<AutofixHistEntry[]>([]);
  const [histLoading, setHistLoading]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(IMPROVEMENTS_URL);
      const d = await r.json() as { ok: boolean; improvements?: FrontendImprovement[] };
      if (d.ok) setImprovements(d.improvements ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleScan = useCallback(async () => {
    setScanning(true);
    try {
      const r = await fetch(AUTOFIX_URL, { method: "POST" });
      const d = await r.json() as { ok: boolean; created?: number; error?: string };
      if (d.ok) {
        onMessage(`✓ Scan complete — ${d.created ?? 0} new improvement${d.created !== 1 ? "s" : ""} found`);
        await load();
      } else {
        onMessage(d.error ?? "Scan failed", true);
      }
    } catch (err) {
      onMessage(`Scan error: ${String(err)}`, true);
    }
    setScanning(false);
  }, [load, onMessage]);

  const handleApply = useCallback(async (imp: FrontendImprovement) => {
    setApplying(prev => ({ ...prev, [imp.id]: true }));
    try {
      const r = await fetch(`${IMPROVEMENTS_URL}/${imp.id}/apply`, { method: "POST" });
      const d = await r.json() as {
        ok: boolean; rolledBack?: boolean; healthBefore?: number;
        healthAfter?: number; error?: string;
      };
      if (d.ok) {
        onMessage(
          `✓ Applied improvement "${imp.title}" — health ${d.healthBefore}→${d.healthAfter}`,
        );
        setImprovements(prev => prev.filter(i => i.id !== imp.id));
      } else if (d.rolledBack) {
        onMessage(`⟲ Rolled back "${imp.title}" — ${d.error ?? "validation failed"}`, true);
        await load(); // refresh to show failed status
      } else {
        onMessage(d.error ?? "Apply failed", true);
        await load();
      }
    } catch (err) {
      onMessage(`Network error: ${String(err)}`, true);
    }
    setApplying(prev => ({ ...prev, [imp.id]: false }));
  }, [load, onMessage]);

  const handleReject = useCallback(async (imp: FrontendImprovement) => {
    try {
      await fetch(`${IMPROVEMENTS_URL}/${imp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "rejected" }),
      });
      setImprovements(prev => prev.filter(i => i.id !== imp.id));
      onMessage(`Improvement "${imp.title}" rejected.`);
    } catch { /* ignore */ }
  }, [onMessage]);

  const toggleHistory = useCallback(async () => {
    if (!showHistory) {
      setHistLoading(true);
      try {
        const r = await fetch(AUTOFIX_HIST_URL);
        const d = await r.json() as { ok: boolean; history?: AutofixHistEntry[] };
        if (d.ok) setHistory((d.history ?? []).slice().reverse());
      } catch { /* ignore */ }
      setHistLoading(false);
    }
    setShowHistory(v => !v);
  }, [showHistory]);

  const catColor = (cat: string) => {
    const m: Record<string, string> = {
      "unused-imports":   "hsl(38 100% 62%)",
      "type-annotations": "hsl(194 100% 55%)",
      "null-checks":      "hsl(264 80% 72%)",
      "readonly-typing":  "hsl(280 70% 65%)",
      "formatting":       "hsl(142 71% 55%)",
      "lint":             "hsl(196 50% 60%)",
      "ui-text":          "hsl(30 80% 62%)",
    };
    return m[cat] ?? "hsl(196 30% 55%)";
  };

  const riskColor = (r: string) =>
    r === "high" ? "hsl(355 80% 62%)" : r === "medium" ? "hsl(38 100% 62%)" : "hsl(142 71% 55%)";

  const statusColor = (s: string) => {
    const m: Record<string, string> = {
      proposed: "hsl(196 30% 55%)", approved: "hsl(194 100% 60%)",
      applying: "hsl(38 100% 62%)", applied: "hsl(142 71% 55%)",
      failed: "hsl(355 80% 62%)",   rejected: "hsl(196 20% 40%)",
    };
    return m[s] ?? "hsl(196 30% 55%)";
  };

  const activeImprovements = improvements.filter(
    i => !["applied", "rejected"].includes(i.status),
  );

  if (loading && improvements.length === 0) return null;

  return (
    <>
      {/* ── Section divider ── */}
      <div className="flex items-center gap-2 mt-2 mb-0.5">
        <div className="flex-1 h-px" style={{ background: "hsl(210 15% 14%)" }} />
        <span className="text-[9px] font-mono opacity-40 flex-shrink-0" style={{ color: "hsl(194 100% 55%)" }}>
          IMPROVEMENTS
        </span>
        <div className="flex-1 h-px" style={{ background: "hsl(210 15% 14%)" }} />
      </div>

      {/* ── Improvements header bar ── */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-[10px] font-semibold" style={{ color: "hsl(194 100% 60%)" }}>
          <Zap className="w-3 h-3 inline mr-1" />
          {activeImprovements.length} improvement{activeImprovements.length !== 1 ? "s" : ""}
        </span>
        <div className="flex items-center gap-1 ml-auto">
          <button type="button" onClick={toggleHistory}
            className="text-[9px] px-2 py-1 rounded-lg transition-opacity opacity-60 hover:opacity-100"
            style={{ border: "1px solid hsl(210 15% 20%)", color: "hsl(196 30% 55%)" }}>
            {showHistory ? "Hide history" : "History"}
          </button>
          <button type="button" onClick={handleScan} disabled={scanning}
            className="flex items-center gap-1 text-[9px] px-2.5 py-1 rounded-lg transition-all disabled:opacity-40"
            style={{ background: "hsl(194 100% 50% / 0.1)", border: "1px solid hsl(194 100% 50% / 0.3)", color: "hsl(194 100% 65%)" }}>
            {scanning ? <><RefreshCw className="w-2.5 h-2.5 animate-spin" />Scanning…</> : <><Play className="w-2.5 h-2.5" />Scan</>}
          </button>
          <button type="button" onClick={load}
            className="p-1 rounded-lg opacity-50 hover:opacity-100 transition-opacity"
            style={{ color: "hsl(196 30% 55%)" }}>
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* ── Empty state ── */}
      {activeImprovements.length === 0 && (
        <div className="flex flex-col items-center gap-1.5 py-4 opacity-40">
          <CheckCircle className="w-5 h-5" style={{ color: "hsl(142 71% 55%)" }} />
          <p className="text-[10px]" style={{ color: "hsl(196 30% 55%)" }}>
            No improvements — click Scan to check
          </p>
        </div>
      )}

      {/* ── Improvement cards ── */}
      {activeImprovements.map(imp => {
        const isApplying = applying[imp.id] ?? false;
        const isExpanded = expanded[imp.id] ?? false;
        const cc = catColor(imp.category);
        const rc = riskColor(imp.riskLevel);
        const sc = statusColor(imp.status);
        const canApply = imp.autoFixable && imp.riskLevel === "low" && !!imp.id;

        return (
          <div key={imp.id} className="rounded-lg overflow-hidden"
            style={{ border: "1px solid hsl(210 15% 16%)", background: "hsl(220 20% 6%)" }}>

            {/* ── Collapsed row ── */}
            <div className="flex items-center gap-2 px-3 py-2.5 min-w-0">

              {/* Category pill */}
              <span className="text-[8px] px-1.5 py-0.5 rounded font-mono flex-shrink-0 uppercase"
                style={{ background: `${cc}14`, border: `1px solid ${cc}35`, color: cc }}>
                {imp.category.replace("-", " ")}
              </span>

              {/* Title */}
              <span className="text-xs truncate flex-1 min-w-0" style={{ color: "hsl(196 40% 68%)" }}>
                {imp.title}
              </span>

              {/* Auto-fixable badge */}
              {imp.autoFixable && (
                <span className="text-[8px] px-1 py-0.5 rounded flex-shrink-0"
                  style={{ background: "hsl(142 60% 40% / 0.12)", border: "1px solid hsl(142 60% 40% / 0.35)", color: "hsl(142 71% 55%)" }}>
                  auto
                </span>
              )}

              {/* Risk pill */}
              <span className="text-[8px] px-1.5 py-0.5 rounded font-mono flex-shrink-0"
                style={{ background: `${rc}14`, border: `1px solid ${rc}35`, color: rc }}>
                {imp.riskLevel}
              </span>

              {/* Status */}
              {imp.status !== "proposed" && (
                <span className="text-[8px] flex-shrink-0" style={{ color: sc }}>
                  {imp.status}
                </span>
              )}

              {/* Apply button — only when autoFixable + low risk */}
              {canApply && imp.status !== "failed" && (
                <button type="button"
                  onClick={() => handleApply(imp)}
                  disabled={isApplying || imp.status === "applying"}
                  title="Apply improvement (snapshot + tsc + health check)"
                  className="flex-shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-semibold active:scale-95 transition-all disabled:opacity-40"
                  style={{ background: "hsl(142 60% 35% / 0.2)", border: "1px solid hsl(142 60% 40% / 0.45)", color: "hsl(142 71% 65%)" }}>
                  {isApplying || imp.status === "applying" ? "…" : "✓"}
                </button>
              )}

              {/* Reject */}
              <button type="button"
                onClick={() => handleReject(imp)}
                disabled={isApplying}
                title="Reject improvement"
                className="flex-shrink-0 px-2 py-1.5 rounded-lg text-xs active:scale-95 transition-all disabled:opacity-40"
                style={{ background: "hsl(355 80% 40% / 0.1)", border: "1px solid hsl(355 80% 45% / 0.3)", color: "hsl(355 80% 62%)" }}>
                ✕
              </button>

              {/* Expand toggle */}
              <button type="button"
                onClick={() => setExpanded(prev => ({ ...prev, [imp.id]: !prev[imp.id] }))}
                className="flex-shrink-0 w-6 py-1.5 rounded-lg text-xs text-center transition-all"
                style={{ background: "transparent", border: "1px solid hsl(210 15% 20%)", color: "hsl(196 30% 50%)" }}>
                {isExpanded ? "▲" : "▼"}
              </button>
            </div>

            {/* ── Expanded: file + description ── */}
            {isExpanded && (
              <div className="border-t px-3 py-2 flex flex-col gap-1.5"
                style={{ borderColor: "hsl(210 15% 13%)" }}>
                {imp.files.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {imp.files.map(f => (
                      <span key={f} className="font-mono text-[9px] px-1.5 py-0.5 rounded"
                        style={{ background: "hsl(220 20% 5%)", color: "hsl(194 80% 55%)" }}>
                        {f.split("/").pop()}
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-[10px] leading-snug whitespace-pre-wrap"
                  style={{ color: "hsl(196 30% 55%)" }}>
                  {imp.description}
                </p>
                {imp.failureReason && (
                  <p className="text-[9px] leading-snug"
                    style={{ color: "hsl(355 80% 60%)" }}>
                    ✗ {imp.failureReason}
                  </p>
                )}
                {!imp.autoFixable && (
                  <p className="text-[9px] italic opacity-60" style={{ color: "hsl(38 80% 60%)" }}>
                    This improvement requires manual intervention — no patch data available.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* ── History panel ── */}
      {showHistory && (
        <div className="mt-1 rounded-lg overflow-hidden"
          style={{ border: "1px solid hsl(210 15% 14%)", background: "hsl(220 20% 5%)" }}>
          <div className="px-3 py-2 border-b flex items-center justify-between"
            style={{ borderColor: "hsl(210 15% 13%)" }}>
            <span className="text-[10px] font-semibold" style={{ color: "hsl(196 40% 55%)" }}>
              Autofix history
            </span>
            {histLoading && <RefreshCw className="w-3 h-3 animate-spin opacity-50" style={{ color: "hsl(196 30% 55%)" }} />}
          </div>
          {history.length === 0 && !histLoading && (
            <p className="px-3 py-2 text-[9px] opacity-40" style={{ color: "hsl(196 30% 55%)" }}>
              No history yet
            </p>
          )}
          {history.slice(0, 20).map(h => (
            <div key={h.id} className="flex items-start gap-2 px-3 py-2 border-b last:border-0"
              style={{ borderColor: "hsl(210 15% 11%)" }}>
              {h.rolledBack
                ? <RotateCcw className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: "hsl(38 100% 62%)" }} />
                : <CheckCircle className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: "hsl(142 71% 55%)" }} />}
              <div className="flex-1 min-w-0">
                <p className="text-[9px] font-medium truncate" style={{ color: "hsl(196 40% 62%)" }}>
                  {h.improvementTitle}
                </p>
                <p className="text-[8px] opacity-60" style={{ color: "hsl(196 20% 50%)" }}>
                  {h.rolledBack ? `rolled back — ${h.rollbackReason ?? ""}` : `✓ applied  · health ${h.healthScoreBefore}→${h.healthScoreAfter}`}
                </p>
              </div>
              <span className="text-[8px] opacity-40 flex-shrink-0" style={{ color: "hsl(196 20% 50%)" }}>
                {new Date(h.appliedAt).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ─── AutoFixPanel ─────────────────────────────────────────────────────────────
// Shows the result of the most recent auto-fix analysis run.
// Triggered automatically after a failed patch validation.

function autoFixRiskColor(risk: FixRisk) {
  return risk === "safe"    ? "hsl(142 71% 55%)"
       : risk === "review"  ? "hsl(196 60% 60%)"
       : risk === "risky"   ? "hsl(38 100% 62%)"
       : "hsl(355 80% 62%)";
}

function autoFixStatusBadge(status: AutoFixProposalFE["status"]) {
  switch (status) {
    case "auto-applied":
      return { label: "auto-applied", bg: "hsl(142 70% 50% / 0.12)", border: "hsl(142 70% 50% / 0.3)", color: "hsl(142 70% 65%)" };
    case "queued":
      return { label: "queued", bg: "hsl(196 60% 50% / 0.12)", border: "hsl(196 60% 50% / 0.3)", color: "hsl(196 60% 65%)" };
    case "blocked":
      return { label: "blocked", bg: "hsl(355 80% 50% / 0.12)", border: "hsl(355 80% 50% / 0.3)", color: "hsl(355 80% 65%)" };
    case "failed":
      return { label: "failed", bg: "hsl(355 80% 50% / 0.12)", border: "hsl(355 80% 50% / 0.3)", color: "hsl(355 80% 65%)" };
    default:
      return { label: "skipped", bg: "hsl(210 15% 20% / 0.5)", border: "hsl(210 15% 25%)", color: "hsl(210 15% 55%)" };
  }
}

function AutoFixPanel({
  result,
  onRefresh,
  onSendMessage,
}: {
  result: AutoFixResultFE;
  onRefresh: () => void;
  onSendMessage: (msg: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const summaryParts = [
    result.autoApplied > 0 && `${result.autoApplied} auto-applied`,
    result.queued      > 0 && `${result.queued} queued`,
    result.blocked     > 0 && `${result.blocked} blocked`,
  ].filter(Boolean).join(" · ");

  return (
    <div className="mt-3 rounded-lg overflow-hidden"
      style={{ border: "1px solid hsl(196 60% 30% / 0.35)", background: "hsl(196 20% 4%)" }}>

      {/* Header */}
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
        style={{ borderBottom: collapsed ? "none" : "1px solid hsl(196 20% 10%)" }}>
        <Zap className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(196 60% 60%)" }} />
        <span className="text-xs font-semibold flex-1" style={{ color: "hsl(196 60% 65%)" }}>
          AutoFix · {result.attempts} pass{result.attempts !== 1 ? "es" : ""}
        </span>
        {summaryParts && (
          <span className="text-[10px] opacity-60" style={{ color: "hsl(196 40% 55%)" }}>
            {summaryParts}
          </span>
        )}
        {result.finalValidationPassed !== undefined && (
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
            style={{
              background: result.finalValidationPassed ? "hsl(142 70% 50% / 0.12)" : "hsl(355 80% 50% / 0.12)",
              border: `1px solid ${result.finalValidationPassed ? "hsl(142 70% 50% / 0.3)" : "hsl(355 80% 50% / 0.3)"}`,
              color: result.finalValidationPassed ? "hsl(142 70% 65%)" : "hsl(355 80% 65%)",
            }}>
            TS {result.finalValidationPassed ? "✓" : "✗"}
          </span>
        )}
        <button type="button" onClick={e => { e.stopPropagation(); onRefresh(); }}
          className="p-0.5 rounded opacity-50 hover:opacity-100 transition-opacity flex-shrink-0"
          title="Refresh from server">
          <RefreshCw className="w-3 h-3" style={{ color: "hsl(196 40% 55%)" }} />
        </button>
        <span className="text-[10px] opacity-40 flex-shrink-0">{collapsed ? "▼" : "▲"}</span>
      </button>

      {/* Proposals list */}
      {!collapsed && (
        <div className="flex flex-col" style={{ gap: 0 }}>
          {result.proposals.length === 0 && (
            <p className="px-3 py-2 text-[10px] opacity-40" style={{ color: "hsl(210 15% 60%)" }}>
              No issues detected.
            </p>
          )}
          {result.proposals.map(p => {
            const rc   = autoFixRiskColor(p.issue.risk);
            const badge = autoFixStatusBadge(p.status);
            return (
              <div key={p.issueId} className="px-3 py-2">
                {/* Row 1: type · risk · file · status */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* Issue type */}
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded flex-shrink-0"
                    style={{ background: `${rc}12`, border: `1px solid ${rc}30`, color: rc }}>
                    {p.issue.type}
                  </span>

                  {/* Risk */}
                  <span className="text-[9px] opacity-60 flex-shrink-0" style={{ color: rc }}>
                    {p.issue.risk}
                  </span>

                  {/* Confidence bar */}
                  <span className="text-[9px] opacity-40 flex-shrink-0" style={{ color: "hsl(210 15% 60%)" }}>
                    {p.confidence}%
                  </span>

                  <span className="flex-1" />

                  {/* Status badge */}
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold flex-shrink-0"
                    style={{ background: badge.bg, border: `1px solid ${badge.border}`, color: badge.color }}>
                    {badge.label}
                  </span>

                  {/* TS validation badge (for auto-applied) */}
                  {p.status === "auto-applied" && p.validationPassed !== undefined && (
                    <span className="text-[9px] px-1 py-0.5 rounded flex-shrink-0"
                      style={{
                        background: p.validationPassed ? "hsl(142 70% 50% / 0.1)" : "hsl(355 80% 50% / 0.1)",
                        color: p.validationPassed ? "hsl(142 70% 65%)" : "hsl(355 80% 65%)",
                      }}>
                      TS {p.validationPassed ? "✓" : "✗"}
                    </span>
                  )}
                </div>

                {/* Row 2: file:line + description */}
                <p className="mt-0.5 text-[10px] font-mono truncate" style={{ color: "hsl(196 40% 50%)" }}>
                  {p.file.split("/").pop()}{p.issue.line ? `:${p.issue.line}` : ""}
                </p>
                <p className="mt-0.5 text-[10px] leading-snug opacity-70 line-clamp-2"
                  style={{ color: "hsl(196 30% 58%)" }}>
                  {p.description}
                </p>

                {/* Row 3: reason (if skipped/blocked) or "Fix with Dev Agent" (if queued/failed) */}
                {p.reason && (
                  <p className="mt-0.5 text-[9px] opacity-50 italic" style={{ color: "hsl(38 60% 60%)" }}>
                    {p.reason}
                  </p>
                )}
                {(p.status === "queued" || p.status === "failed" || p.status === "skipped") && !p.reason && (
                  <button
                    type="button"
                    onClick={() => onSendMessage(
                      `Fix this TypeScript error: TS${p.issue.errorCode ?? ""} "${p.issue.errorText}" in \`${p.file}\`${p.issue.line ? ` at line ${p.issue.line}` : ""}`
                    )}
                    className="mt-1 text-[9px] px-2 py-0.5 rounded transition-all hover:opacity-80"
                    style={{ background: "hsl(196 60% 50% / 0.08)", border: "1px solid hsl(196 60% 50% / 0.25)", color: "hsl(196 60% 65%)" }}>
                    Ask Dev Agent →
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── PatchesTab ─────────────────────────────────────────────────────────────
// Collapsed-card layout: each card shows file + risk + Apply / Reject / Expand
// in a single row. Diff is hidden until the user taps ▼. Sticky bulk-action
// bar sits above the list when patches are present.
function PatchesTab({ onMessage }: { onMessage: (msg: string, isError?: boolean) => void }) {
  const [patches,       setPatches]       = useState<PendingPatchFull[]>([]);
  const [appliedPatches,setAppliedPatches] = useState<AppliedPatch[]>([]);
  const [autoFixResult, setAutoFixResult] = useState<AutoFixResultFE | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [applying,      setApplying]      = useState<Record<string, boolean>>({});
  // expanded[patchId] = true → show diff; false / absent → collapsed
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  /* ── fetch ── */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(PATCHES_URL);
      const d = await r.json() as { ok: boolean; patches?: PendingPatchFull[] };
      if (d.ok) {
        setPatches(d.patches ?? []);
        // keep expansion state for surviving patches; new ones default to false
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ── per-card actions ── */
  const handleApprove = useCallback(async (p: PendingPatchFull) => {
    setApplying(prev => ({ ...prev, [p.patchId]: true }));
    try {
      const project = p.file.startsWith("artifacts/api-server") ? "api-server" : "jarvas";
      const r = await fetch(APPLY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patchId: p.patchId, project }),
      });
      const d = await r.json() as {
        ok: boolean; error?: string; snapshotId?: string;
        validation?: { passed: boolean; summary: string };
        autoFixResult?: AutoFixResultFE;
      };
      if (d.ok) {
        const applied: AppliedPatch = {
          ...p,
          appliedAt: Date.now(),
          snapshotId: d.snapshotId,
          validationPassed: d.validation?.passed ?? false,
          validationSummary: d.validation?.summary ?? "no summary",
        };
        setPatches(prev => prev.filter(x => x.patchId !== p.patchId));
        setExpanded(prev => { const n = { ...prev }; delete n[p.patchId]; return n; });
        setAppliedPatches(prev => [applied, ...prev].slice(0, 20));
        // Capture AutoFix results (populated only on validation failure)
        if (d.autoFixResult) {
          setAutoFixResult(d.autoFixResult);
          // Reload patch queue — AutoFix may have added review patches
          load();
        }
        const afSuffix = d.autoFixResult
          ? ` · AutoFix: ${d.autoFixResult.autoApplied} applied, ${d.autoFixResult.queued} queued`
          : "";
        onMessage(`✓ Applied \`${p.file}\` — TS check ${d.validation?.passed ? "passed ✓" : "failed ✗"}: ${d.validation?.summary ?? ""}${afSuffix}`);
      } else {
        onMessage(d.error ?? "Apply failed", true);
      }
    } catch (err) {
      onMessage(`Network error: ${String(err)}`, true);
    }
    setApplying(prev => ({ ...prev, [p.patchId]: false }));
  }, [onMessage]);

  const handleReject = useCallback((patchId: string) => {
    setPatches(prev => prev.filter(p => p.patchId !== patchId));
    setExpanded(prev => { const n = { ...prev }; delete n[patchId]; return n; });
    onMessage("Patch rejected — removed from queue.");
  }, [onMessage]);

  const handleRollback = useCallback(async (ap: AppliedPatch) => {
    setAppliedPatches(prev => prev.map(x => x.patchId === ap.patchId ? { ...x, rollbackPending: true } : x));
    try {
      let r: Response;
      if (ap.snapshotId) {
        r = await fetch(`${SNAP_RESTORE_URL}/${ap.snapshotId}/restore`, { method: "POST" });
      } else {
        r = await fetch(ROLLBACK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file: ap.file }),
        });
      }
      const d = await r.json() as { ok: boolean; error?: string; validation?: { passed: boolean; summary: string } };
      if (d.ok) {
        setAppliedPatches(prev => prev.map(x =>
          x.patchId === ap.patchId
            ? { ...x, rolledBack: true, rollbackPending: false, rollbackValidationPassed: d.validation?.passed }
            : x
        ));
        onMessage(`↩ Rolled back \`${ap.file}\` — TS check ${d.validation?.passed ? "passed ✓" : "failed ✗"}`);
      } else {
        setAppliedPatches(prev => prev.map(x => x.patchId === ap.patchId ? { ...x, rollbackPending: false } : x));
        onMessage(d.error ?? "Rollback failed", true);
      }
    } catch (err) {
      setAppliedPatches(prev => prev.map(x => x.patchId === ap.patchId ? { ...x, rollbackPending: false } : x));
      onMessage(`Network error: ${String(err)}`, true);
    }
  }, [onMessage]);

  /* ── bulk actions ── */
  const lowPatches = patches.filter(p => p.riskLevel === "low");

  const handleApplyAllLow = async () => {
    for (const p of lowPatches) await handleApprove(p);
  };

  const handleRejectAll = () => {
    setPatches([]);
    setExpanded({});
    onMessage(`Rejected all ${patches.length} patch${patches.length === 1 ? "" : "es"}.`);
  };

  /* ── expand toggle ── */
  const toggleExpand = (id: string) =>
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  /* ── helpers ── */
  const riskColor = (r?: string) =>
    r === "high"   ? "hsl(355 80% 62%)"
    : r === "medium" ? "hsl(38 100% 62%)"
    : "hsl(142 71% 55%)";

  /* ── render ── */
  return (
    <div className="flex flex-col h-full">

      {/* Title bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b flex-shrink-0"
        style={{ borderColor: "hsl(210 15% 13%)" }}>
        <span className="text-xs font-semibold" style={{ color: "hsl(38 100% 62%)" }}>
          Pending Patches ({patches.length})
        </span>
        <button type="button" onClick={load}
          className="p-1 rounded-lg opacity-60 hover:opacity-100 transition-opacity"
          style={{ color: "hsl(196 30% 55%)" }}>
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Sticky bulk-action bar — only when patches exist */}
      {!loading && patches.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 border-b flex-shrink-0 flex-wrap"
          style={{ borderColor: "hsl(210 15% 13%)", background: "hsl(220 20% 5%)" }}>

          <button type="button" onClick={handleApplyAllLow}
            disabled={lowPatches.length === 0}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-30 active:scale-95 transition-all"
            style={{ background: "hsl(142 60% 35% / 0.2)", border: "1px solid hsl(142 60% 40% / 0.45)", color: "hsl(142 71% 65%)" }}>
            <CheckCircle className="w-3 h-3" />
            Apply all LOW{lowPatches.length > 0 ? ` (${lowPatches.length})` : ""}
          </button>

          <button type="button" onClick={handleRejectAll}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold active:scale-95 transition-all"
            style={{ background: "hsl(355 80% 40% / 0.12)", border: "1px solid hsl(355 80% 45% / 0.35)", color: "hsl(355 80% 62%)" }}>
            <XCircle className="w-3 h-3" />
            Reject all
          </button>

          <button type="button" onClick={load}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs active:scale-95 transition-all ml-auto"
            style={{ background: "transparent", border: "1px solid hsl(210 15% 20%)", color: "hsl(196 30% 50%)" }}>
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </div>
      )}

      {/* Patch list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2">

        {loading && (
          <div className="text-xs opacity-50 text-center py-6" style={{ color: "hsl(196 30% 55%)" }}>
            Loading patches…
          </div>
        )}

        {!loading && patches.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 opacity-50">
            <CheckCircle className="w-6 h-6" style={{ color: "hsl(142 71% 55%)" }} />
            <p className="text-xs" style={{ color: "hsl(196 30% 55%)" }}>
              No pending patches — queue is empty.
            </p>
          </div>
        )}

        {patches.map(p => {
          const isExpanded = expanded[p.patchId] ?? false;
          const isApplying = applying[p.patchId] ?? false;
          const rc = riskColor(p.riskLevel);

          return (
            <div key={p.patchId} className="rounded-lg overflow-hidden"
              style={{ border: "1px solid hsl(210 15% 17%)", background: "hsl(220 20% 6.5%)" }}>

              {/* ── Collapsed row — ALWAYS visible ── */}
              <div className="flex items-center gap-2 px-3 py-2.5 min-w-0">

                <FileEdit className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(194 100% 55%)" }} />

                {/* File basename — truncates so buttons stay on-screen */}
                <span className="font-mono text-xs truncate flex-1 min-w-0" style={{ color: "hsl(196 50% 65%)" }}>
                  {p.file.split("/").pop()}
                </span>

                {/* Risk pill */}
                <span className="text-[9px] px-1.5 py-0.5 rounded font-mono flex-shrink-0"
                  style={{ background: `${rc}18`, border: `1px solid ${rc}45`, color: rc }}>
                  {p.riskLevel ?? "?"}
                </span>

                {/* ✓ Apply */}
                <button type="button"
                  onClick={() => handleApprove(p)}
                  disabled={isApplying}
                  title="Apply patch"
                  className="flex-shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-semibold active:scale-95 transition-all disabled:opacity-40"
                  style={{ background: "hsl(142 60% 35% / 0.22)", border: "1px solid hsl(142 60% 40% / 0.45)", color: "hsl(142 71% 65%)" }}>
                  {isApplying ? "…" : "✓"}
                </button>

                {/* ✕ Reject */}
                <button type="button"
                  onClick={() => handleReject(p.patchId)}
                  disabled={isApplying}
                  title="Reject patch"
                  className="flex-shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-semibold active:scale-95 transition-all disabled:opacity-40"
                  style={{ background: "hsl(355 80% 40% / 0.12)", border: "1px solid hsl(355 80% 45% / 0.35)", color: "hsl(355 80% 62%)" }}>
                  ✕
                </button>

                {/* ▼ / ▲ Expand */}
                <button type="button"
                  onClick={() => toggleExpand(p.patchId)}
                  title={isExpanded ? "Collapse diff" : "Expand diff"}
                  className="flex-shrink-0 w-7 py-1.5 rounded-lg text-xs active:scale-95 transition-all text-center"
                  style={{ background: "transparent", border: "1px solid hsl(210 15% 22%)", color: "hsl(196 30% 50%)" }}>
                  {isExpanded ? "▲" : "▼"}
                </button>
              </div>

              {/* ── Expanded: description + metadata + scrollable diff ── */}
              {isExpanded && (
                <div className="border-t" style={{ borderColor: "hsl(210 15% 13%)" }}>
                  <p className="px-3 pt-2 pb-1 text-xs leading-snug" style={{ color: "hsl(196 40% 58%)" }}>
                    {p.description}
                  </p>
                  {/* Metadata row: impacts + test command */}
                  <div className="px-3 pb-2 flex flex-wrap gap-x-4 gap-y-1">
                    {p.uiImpact && p.uiImpact !== "unknown" && (
                      <span className="text-[10px] opacity-70" style={{ color: "hsl(264 60% 70%)" }}>
                        <span className="opacity-60">UI·</span> {p.uiImpact}
                      </span>
                    )}
                    {p.logicImpact && p.logicImpact !== "unknown" && (
                      <span className="text-[10px] opacity-70" style={{ color: "hsl(196 50% 65%)" }}>
                        <span className="opacity-60">Logic·</span> {p.logicImpact}
                      </span>
                    )}
                    {p.testCommand && (
                      <div className="w-full mt-1 flex items-start gap-1.5">
                        <Play className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: "hsl(142 70% 55%)" }} />
                        <code className="text-[10px] font-mono break-all" style={{ color: "hsl(142 70% 65%)" }}>
                          {p.testCommand}
                        </code>
                      </div>
                    )}
                  </div>
                  <div className="overflow-y-auto overflow-x-auto" style={{ maxHeight: "min(240px, 42vh)" }}>
                    <DiffViewer
                      file={p.file}
                      description={p.description}
                      oldContent={p.oldContent}
                      newContent={p.newContent}
                      onApprove={() => handleApprove(p)}
                      onReject={() => handleReject(p.patchId)}
                      applying={isApplying}
                      metadata={{ riskLevel: p.riskLevel, uiImpact: p.uiImpact, logicImpact: p.logicImpact, safeToTest: p.safeToTest }}
                      showHeader={false}
                      showActions={false}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* ── Applied patches history ─────────────────────────────────────── */}
        {appliedPatches.length > 0 && (
          <div className="mt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider px-1 mb-1.5 opacity-50"
              style={{ color: "hsl(210 15% 65%)" }}>
              Applied ({appliedPatches.length})
            </p>
            <div className="flex flex-col gap-1.5">
              {appliedPatches.map(ap => {
                const rc = riskColor(ap.riskLevel);
                const isRollingBack = ap.rollbackPending ?? false;
                return (
                  <div key={ap.patchId} className="rounded-lg overflow-hidden"
                    style={{
                      border: `1px solid ${ap.rolledBack ? "hsl(38 100% 50% / 0.25)" : "hsl(210 15% 15%)"}`,
                      background: ap.rolledBack ? "hsl(38 100% 50% / 0.04)" : "hsl(220 20% 5.5%)",
                      opacity: ap.rolledBack ? 0.7 : 1,
                    }}>

                    {/* Card header */}
                    <div className="flex items-center gap-2 px-3 py-2 min-w-0">
                      {ap.rolledBack
                        ? <RotateCcw className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(38 100% 62%)" }} />
                        : <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(142 71% 55%)" }} />
                      }

                      <span className="font-mono text-xs truncate flex-1 min-w-0" style={{ color: "hsl(196 40% 55%)" }}>
                        {ap.file.split("/").pop()}
                      </span>

                      {/* Snapshot / checkpoint badge */}
                      {ap.snapshotId && !ap.rolledBack && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded flex-shrink-0"
                          style={{ background: "hsl(264 80% 60% / 0.12)", border: "1px solid hsl(264 80% 60% / 0.25)", color: "hsl(264 80% 72%)" }}>
                          checkpoint
                        </span>
                      )}

                      {/* Risk pill */}
                      <span className="text-[9px] px-1.5 py-0.5 rounded font-mono flex-shrink-0"
                        style={{ background: `${rc}10`, border: `1px solid ${rc}30`, color: `${rc}` }}>
                        {ap.riskLevel ?? "?"}
                      </span>

                      {/* Validation badge */}
                      {!ap.rolledBack && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded flex-shrink-0 font-semibold"
                          style={{
                            background: ap.validationPassed ? "hsl(142 70% 50% / 0.12)" : "hsl(355 80% 50% / 0.12)",
                            border: `1px solid ${ap.validationPassed ? "hsl(142 70% 50% / 0.3)" : "hsl(355 80% 50% / 0.3)"}`,
                            color: ap.validationPassed ? "hsl(142 70% 65%)" : "hsl(355 80% 65%)",
                          }}>
                          {ap.validationPassed ? "TS ✓" : "TS ✗"}
                        </span>
                      )}

                      {/* Rollback status or button */}
                      {ap.rolledBack ? (
                        <span className="text-[9px] flex-shrink-0 opacity-60"
                          style={{ color: "hsl(38 100% 62%)" }}>
                          rolled back {ap.rollbackValidationPassed !== undefined && (ap.rollbackValidationPassed ? "· TS ✓" : "· TS ✗")}
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={isRollingBack}
                          onClick={() => handleRollback(ap)}
                          title="Restore file to pre-patch state using saved checkpoint"
                          className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-all disabled:opacity-40 active:scale-95"
                          style={{ background: "hsl(38 100% 50% / 0.08)", border: "1px solid hsl(38 100% 50% / 0.3)", color: "hsl(38 100% 65%)" }}>
                          <RotateCcw className="w-2.5 h-2.5" />
                          {isRollingBack ? "…" : "↩"}
                        </button>
                      )}
                    </div>

                    {/* Description + test command (always shown on applied cards) */}
                    <div className="px-3 pb-2 border-t" style={{ borderColor: "hsl(210 15% 10%)" }}>
                      <p className="text-[10px] pt-1.5 leading-snug opacity-60" style={{ color: "hsl(196 30% 60%)" }}>
                        {ap.description}
                      </p>
                      {ap.testCommand && (
                        <div className="flex items-start gap-1 mt-1">
                          <Play className="w-2.5 h-2.5 flex-shrink-0 mt-0.5 opacity-60" style={{ color: "hsl(142 70% 55%)" }} />
                          <code className="text-[10px] font-mono opacity-50" style={{ color: "hsl(142 60% 60%)" }}>
                            {ap.testCommand}
                          </code>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── AutoFix results (Phase 3C) ── */}
        {autoFixResult && (
          <AutoFixPanel
            result={autoFixResult}
            onRefresh={async () => {
              try {
                const r = await fetch(AUTOFIX_LATEST_URL);
                const d = await r.json() as { ok: boolean; result?: AutoFixResultFE };
                if (d.ok && d.result) setAutoFixResult(d.result);
              } catch { /* ignore */ }
            }}
            onSendMessage={msg => onMessage(msg)}
          />
        )}

        {/* ── Improvements section (below patches, same scrollable container) ── */}
        <ImprovementsSection onMessage={onMessage} />

      </div>
    </div>
  );
}

// ─── Workspace Tab ─────────────────────────────────────────────────────────────

function WorkspaceTab({ onInsertPath }: { onInsertPath: (p: string) => void }) {
  const [gitInfo, setGitInfo] = useState<{ branch?: string; changes?: Array<{ status: string; file: string }> | number; available?: boolean } | null>(null);
  const [apiOk, setApiOk]     = useState<boolean | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`${GIT_URL}/status`).then(r => r.json()).catch(() => null),
      fetch(HEALTH_URL).then(r => r.ok).catch(() => false),
    ]).then(([git, health]) => {
      setGitInfo(git as { branch?: string; changes?: Array<{ status: string; file: string }> | number; available?: boolean });
      setApiOk(health === true);
    });
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Status strip */}
      <div className="flex items-center gap-4 px-3 py-2 border-b flex-shrink-0 text-[10px]"
        style={{ borderColor: "hsl(210 15% 13%)", background: "hsl(220 20% 5.5%)" }}>
        <span className="flex items-center gap-1.5" style={{ color: apiOk ? "hsl(142 71% 55%)" : "hsl(355 80% 62%)" }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: apiOk ? "hsl(142 71% 55%)" : "hsl(355 80% 55%)" }} />
          <Server className="w-2.5 h-2.5" />
          {apiOk === null ? "checking…" : apiOk ? "API online" : "API offline"}
        </span>
        {gitInfo?.available && (
          <span className="flex items-center gap-1.5" style={{ color: (Array.isArray(gitInfo.changes) ? gitInfo.changes.length : (gitInfo.changes ?? 0)) > 0 ? "hsl(38 80% 62%)" : "hsl(196 30% 50%)" }}>
            <GitBranch className="w-2.5 h-2.5" />
            {gitInfo.branch ?? "main"}
            {(Array.isArray(gitInfo.changes) ? gitInfo.changes.length : (gitInfo.changes ?? 0)) > 0
              ? ` · ${Array.isArray(gitInfo.changes) ? gitInfo.changes.length : gitInfo.changes} changed`
              : " · clean"}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1 opacity-40" style={{ color: "hsl(38 60% 55%)" }}>
          <HardDrive className="w-2.5 h-2.5" />data in /tmp
        </span>
      </div>
      {/* File browser */}
      <div className="flex-1 overflow-hidden">
        <FileBrowser onInsertPath={onInsertPath} />
      </div>
    </div>
  );
}

// ─── ContextPill ─────────────────────────────────────────────────────────────
// Compact context strip shown at the top of the chat tab.
// Fetches GET /api/dev/context (read-only) every 30 s.
// Shows: health score · improvements · open tasks · git status.
// Also surfaces dynamic task suggestions the user can click to pre-fill input.

function ContextPill({
  onSuggest,
  onSwitchTab,
}: {
  onSuggest: (prompt: string) => void;
  onSwitchTab: (tab: PanelTab) => void;
}) {
  const [ctx,         setCtx]         = useState<DevContextData | null>(null);
  const [suggestions, setSuggestions] = useState<TaskSuggestion[]>([]);
  const [refreshing,  setRefreshing]  = useState(false);
  const [showSugg,    setShowSugg]    = useState(false);

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    try {
      const url = force ? `${DEV_CONTEXT_URL}?refresh=1` : DEV_CONTEXT_URL;
      const res  = await fetch(url);
      if (!res.ok) return;
      const data = await res.json() as { ok: boolean; context: DevContextData; suggestions: TaskSuggestion[] };
      if (data.ok) {
        setCtx(data.context);
        setSuggestions(data.suggestions);
      }
    } catch { /* non-fatal */ } finally {
      if (force) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    const id = setInterval(() => void load(false), 30_000);
    return () => clearInterval(id);
  }, [load]);

  if (!ctx) return null;

  // Health colour
  const healthColor =
    ctx.health.score >= 90 ? "hsl(142 70% 55%)" :
    ctx.health.score >= 70 ? "hsl(38 100% 55%)"  :
    "hsl(355 80% 62%)";

  const totalTsErrors = ctx.health.feErrors + ctx.health.beErrors;

  return (
    <div className="mx-4 mt-2.5 mb-0 flex-shrink-0 rounded-lg overflow-hidden"
      style={{ border: "1px solid hsl(210 15% 18%)", background: "hsl(210 15% 7%)" }}>

      {/* Pills row */}
      <div className="flex items-center gap-0 text-[10px] font-mono divide-x divide-white/10">

        {/* Health */}
        <button
          type="button"
          className="flex items-center gap-1 px-2.5 py-1.5 hover:bg-white/5 transition-colors flex-shrink-0"
          title={`Health ${ctx.health.score}/100${totalTsErrors > 0 ? ` — ${totalTsErrors} TS errors` : ""}`}
          onClick={() => void load(true)}
        >
          <Zap className="w-3 h-3" style={{ color: healthColor }} />
          <span style={{ color: healthColor }}>{ctx.health.score}</span>
          {totalTsErrors > 0 && (
            <span className="ml-0.5 px-1 rounded" style={{ background: "hsl(355 80% 62% / 0.18)", color: "hsl(355 80% 70%)" }}>
              {totalTsErrors} err
            </span>
          )}
          {refreshing && <RefreshCw className="w-2.5 h-2.5 animate-spin ml-0.5 opacity-50" style={{ color: healthColor }} />}
        </button>

        {/* Improvements */}
        <button
          type="button"
          className="flex items-center gap-1 px-2.5 py-1.5 hover:bg-white/5 transition-colors flex-shrink-0"
          title={`${ctx.improvements.total} improvement${ctx.improvements.total !== 1 ? "s" : ""} (${ctx.improvements.autoFixable} auto-fixable)`}
          onClick={() => onSwitchTab("patches")}
        >
          <Play className="w-3 h-3" style={{ color: ctx.improvements.autoFixable > 0 ? "hsl(142 70% 55%)" : "hsl(210 15% 40%)" }} />
          <span style={{ color: ctx.improvements.total > 0 ? "hsl(142 70% 65%)" : "hsl(210 15% 40%)" }}>
            {ctx.improvements.total} fix{ctx.improvements.total !== 1 ? "es" : ""}
          </span>
        </button>

        {/* Tasks */}
        <button
          type="button"
          className="flex items-center gap-1 px-2.5 py-1.5 hover:bg-white/5 transition-colors flex-shrink-0"
          title={`${ctx.tasks.open} open task${ctx.tasks.open !== 1 ? "s" : ""}`}
          onClick={() => onSwitchTab("workspace")}
        >
          <Layers className="w-3 h-3" style={{ color: ctx.tasks.open > 0 ? "hsl(264 80% 70%)" : "hsl(210 15% 40%)" }} />
          <span style={{ color: ctx.tasks.open > 0 ? "hsl(264 80% 75%)" : "hsl(210 15% 40%)" }}>
            {ctx.tasks.open} task{ctx.tasks.open !== 1 ? "s" : ""}
          </span>
        </button>

        {/* Git */}
        <div
          className="flex items-center gap-1 px-2.5 py-1.5 flex-shrink-0 flex-1 min-w-0"
          title={ctx.git.dirty ? `${ctx.git.changes} uncommitted changes on ${ctx.git.branch}` : `Clean on ${ctx.git.branch}`}
        >
          <GitBranch className="w-3 h-3 flex-shrink-0" style={{ color: ctx.git.dirty ? "hsl(38 100% 55%)" : "hsl(210 15% 40%)" }} />
          <span className="truncate" style={{ color: ctx.git.dirty ? "hsl(38 100% 65%)" : "hsl(210 15% 40%)" }}>
            {ctx.git.branch}{ctx.git.dirty ? ` · ${ctx.git.changes}↑` : ""}
          </span>
        </div>

        {/* Suggestions toggle */}
        {suggestions.length > 0 && (
          <button
            type="button"
            className="flex items-center gap-1 px-2.5 py-1.5 hover:bg-white/5 transition-colors flex-shrink-0"
            title="Context-aware task suggestions"
            onClick={() => setShowSugg(v => !v)}
          >
            <AlertTriangle className="w-3 h-3" style={{ color: showSugg ? "hsl(196 100% 60%)" : "hsl(210 15% 40%)" }} />
            <span style={{ color: showSugg ? "hsl(196 100% 65%)" : "hsl(210 15% 40%)" }}>suggest</span>
            <ChevronRight className={`w-3 h-3 transition-transform ${showSugg ? "rotate-90" : ""}`} style={{ color: "hsl(210 15% 40%)" }} />
          </button>
        )}
      </div>

      {/* Suggestions drawer */}
      {showSugg && suggestions.length > 0 && (
        <div className="px-2.5 pb-2.5 pt-1.5 flex flex-col gap-1.5 border-t" style={{ borderColor: "hsl(210 15% 15%)" }}>
          <p className="text-[9px] font-semibold uppercase tracking-wider opacity-40" style={{ color: "hsl(210 15% 70%)" }}>
            Suggested tasks based on current context
          </p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map(s => {
              const pillColor =
                s.priority === "high"   ? "hsl(355 80% 62%)" :
                s.priority === "medium" ? "hsl(38 100% 55%)"  :
                "hsl(142 70% 50%)";
              return (
                <button
                  key={s.label}
                  type="button"
                  className="text-[10px] px-2.5 py-1 rounded-md transition-all hover:opacity-100 opacity-80"
                  style={{ background: `${pillColor}18`, border: `1px solid ${pillColor}40`, color: pillColor }}
                  onClick={() => { onSuggest(s.prompt); setShowSugg(false); }}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          <p className="text-[9px] opacity-30 mt-0.5" style={{ color: "hsl(210 15% 60%)" }}>
            Clicking fills the input. No code is changed until you send and approve a patch.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface DevAgentPanelProps { onClose: () => void; }
type PanelTab = "chat" | "workspace" | "patches" | "memory" | "agents";

export default function DevAgentPanel({ onClose }: DevAgentPanelProps) {
  const [tab, setTab]         = useState<PanelTab>("chat");
  const [input, setInput]     = useState("");
  const [messages, setMessages] = useState<DevMessage[]>(() => {
    const saved = loadMessages();
    if (saved.length === 0) return [];
    const taskSummary = saved.filter(m => m.type === "agent_text" && m.text?.startsWith("**You:**")).length;
    const notice: DevMessage = { id: `restore-${Date.now()}`, type: "restore_notice", text: `Session restored — ${taskSummary} turn(s)` };
    return [notice, ...saved];
  });
  const [isRunning, setIsRunning]   = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [sseDropped, setSseDropped] = useState(false);
  const [lastMsg, setLastMsg]       = useState("");
  const [taskId, setTaskId]         = useState<string | null>(() => getSavedTaskId());
  const [gitAvailable, setGitAvailable] = useState(false);
  const [currentStage, setCurrentStage] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<string | null>(null);
  const [startupBanner, setStartupBanner] = useState<{
    score: number; label: string; patchCount: number; tsErrors: number;
  } | null>(null);

  const bottomRef        = useRef<HTMLDivElement>(null);
  const inputRef         = useRef<HTMLTextAreaElement>(null);
  const streamingTextRef = useRef("");

  // Check git on mount
  useEffect(() => {
    fetch(`${GIT_URL}/status`)
      .then(r => r.json() as Promise<{ available?: boolean }>)
      .then(d => setGitAvailable(d.available === true))
      .catch(() => {});
  }, []);

  // Startup health + patch summary banner (auto-dismisses after 8 s)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    Promise.all([
      fetch(DEV_HEALTH_URL).then(r => r.json() as Promise<HealthData & { ok: boolean }>).catch(() => null),
      fetch(PATCHES_URL).then(r => r.json() as Promise<{ ok: boolean; patches?: unknown[] }>).catch(() => null),
    ]).then(([h, p]) => {
      if (!h?.ok) return;
      const tsErrors = (h.typescript?.frontend?.errorCount ?? 0) + (h.typescript?.backend?.errorCount ?? 0);
      const patchCount = (p?.patches ?? []).length;
      setStartupBanner({ score: h.score, label: h.label, patchCount, tsErrors });
      timer = setTimeout(() => setStartupBanner(null), 8_000);
    }).catch(() => {});
    return () => clearTimeout(timer);
  }, []);

  const scrollToBottom = () => bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  useEffect(() => { scrollToBottom(); }, [messages, streamingText]);

  useEffect(() => {
    const toSave = messages.filter(m => m.type !== "restore_notice");
    if (toSave.length > 0) saveMessages(toSave);
  }, [messages]);

  const addMsg = useCallback((msg: Omit<DevMessage, "id">) => {
    setMessages(prev => [...prev, { ...msg, id: `dev-${Date.now()}-${Math.random()}` }]);
  }, []);

  const handleClear = useCallback(() => {
    clearMessages();
    setMessages([]);
    setStreamingText("");
    streamingTextRef.current = "";
    setTaskId(null);
    setSseDropped(false);
    setCurrentStage(null);
  }, []);

  // ── Apply ──────────────────────────────────────────────────────────────────

  const handleApprove = useCallback(async (patch: PatchData) => {
    setMessages(prev => prev.map(m => m.patch?.patchId === patch.patchId ? { ...m, applying: true } : m));
    setSseDropped(false);

    const showFallback = () => {
      setMessages(prev => prev.map(m => m.patch?.patchId === patch.patchId ? { ...m, applying: false } : m));
      addMsg({ type: "manual_patch", patch });
    };

    let res: Response;
    try {
      res = await fetch(APPLY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patchId: patch.patchId, taskId, project: "jarvas" }),
      });
    } catch (err) {
      addMsg({ type: "error", error: `Network error: ${String(err)}` });
      showFallback();
      return;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      addMsg({ type: "error", error: `${APPLY_URL} → HTTP ${res.status}: ${body.slice(0, 300)}` });
      showFallback();
      return;
    }

    const data = await res.json() as {
      ok: boolean; error?: string;
      snapshotId?: string;
      validation?: { passed: boolean; summary: string };
      validationEvents?: Array<Record<string, unknown>>;
    };

    if (!data.ok) {
      addMsg({ type: "error", error: data.error ?? "Apply failed" });
      showFallback();
      return;
    }

    // Update patch card to applied + store snapshotId
    setMessages(prev => prev.map(m =>
      m.patch?.patchId === patch.patchId
        ? { ...m, type: "patch_applied" as DevEventType, applying: false, patch: { ...m.patch!, snapshotId: data.snapshotId } }
        : m,
    ));

    // Replay validation events
    if (data.validationEvents) {
      for (const ev of data.validationEvents) {
        const t = ev.type as string;
        if (t === "dev:check_started") addMsg({ type: "check_started", check: ev.check as string, project: ev.project as string });
        else if (t === "dev:check_passed") addMsg({ type: "check_passed", check: ev.check as string, output: ev.output as string, project: ev.project as string });
        else if (t === "dev:check_failed") addMsg({ type: "check_failed", check: ev.check as string, output: ev.output as string, project: ev.project as string });
        else if (t === "dev:validation_done") addMsg({ type: "validation_done", validationPassed: ev.passed as boolean, validationSummary: ev.summary as string });
      }
    }
  }, [addMsg, taskId]);

  const handleReject = useCallback((patchId: string) => {
    setMessages(prev => prev.map(m =>
      m.patch?.patchId === patchId ? { ...m, type: "patch_rejected" as DevEventType } : m,
    ));
  }, []);

  // ── Rollback ───────────────────────────────────────────────────────────────

  const handleRollback = useCallback(async (file: string, msgId: string) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, rollingBack: true } : m));
    try {
      const res  = await fetch(ROLLBACK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file }) });
      const data = await res.json() as { ok: boolean; restoredFrom?: string; error?: string };
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, rollingBack: false } : m));
      if (data.ok) addMsg({ type: "agent_text", text: `↩ Rolled back \`${file}\` from \`${data.restoredFrom ?? "backup"}\`` });
      else addMsg({ type: "error", error: data.error ?? "Rollback failed" });
    } catch (err) {
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, rollingBack: false } : m));
      addMsg({ type: "error", error: `Rollback error: ${String(err)}` });
    }
  }, [addMsg]);

  // ── Snapshot restore ───────────────────────────────────────────────────────

  const handleSnapshotRestore = useCallback(async (snapshotId: string, file: string, msgId: string) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, rollingBack: true } : m));
    try {
      const res  = await fetch(`${SNAP_URL}/${snapshotId}/restore`, { method: "POST" });
      const data = await res.json() as { ok: boolean; error?: string };
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, rollingBack: false } : m));
      if (data.ok) addMsg({ type: "agent_text", text: `↩ Snapshot restored — \`${file}\`` });
      else addMsg({ type: "error", error: data.error ?? "Snapshot restore failed" });
    } catch (err) {
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, rollingBack: false } : m));
      addMsg({ type: "error", error: `Snapshot error: ${String(err)}` });
    }
  }, [addMsg]);

  // ── Git commit ─────────────────────────────────────────────────────────────

  const handleCommit = useCallback(async (patch: PatchData, msgId: string) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, committing: true } : m));
    try {
      const res  = await fetch(`${GIT_URL}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: patch.description || `Apply patch to ${patch.file}`, files: [patch.file] }),
      });
      const data = await res.json() as { ok: boolean; hash?: string; error?: string };
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, committing: false } : m));
      if (data.ok) addMsg({ type: "agent_text", text: `✓ Committed \`${patch.file}\`${data.hash ? ` (${data.hash})` : ""}` });
      else addMsg({ type: "error", error: data.error ?? "Commit failed" });
    } catch (err) {
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, committing: false } : m));
      addMsg({ type: "error", error: `Commit error: ${String(err)}` });
    }
  }, [addMsg]);

  // ── Stream ─────────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (overrideMsg?: string) => {
    const goal = (overrideMsg ?? input).trim();
    if (!goal || isRunning) return;
    if (!overrideMsg) setInput("");
    setIsRunning(true);
    setSseDropped(false);
    setLastMsg(goal);
    streamingTextRef.current = "";
    setStreamingText("");

    addMsg({ type: "agent_text", text: `**You:** ${goal}` });

    // Create task if we don't have one
    let currentTaskId = taskId;
    if (!currentTaskId) {
      try {
        const r  = await fetch(TASKS_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: goal }) });
        const d  = await r.json() as { ok: boolean; task?: { id: string } };
        if (d.ok && d.task) { currentTaskId = d.task.id; setTaskId(currentTaskId); saveTaskId(currentTaskId); }
      } catch { /* continue without taskId */ }
    }

    let res: Response;
    try {
      res = await fetch(STREAM_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: goal, taskId: currentTaskId }),
      });
    } catch (err) {
      addMsg({ type: "error", error: `Network error on ${STREAM_URL} — ${String(err)}` });
      setIsRunning(false);
      setSseDropped(true);
      return;
    }

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      addMsg({ type: "error", error: `${STREAM_URL} → HTTP ${res.status}: ${body.slice(0, 300)}` });
      setIsRunning(false);
      return;
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = "";
    let cleanClose = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          try {
            const ev = JSON.parse(jsonStr) as Record<string, unknown>;
            const t  = ev.type as string;

            if (t === "dev:task_created") {
              const id = ev.taskId as string;
              setTaskId(id);
              saveTaskId(id);
              setTaskStatus("running");
            } else if (t === "dev:token") {
              streamingTextRef.current += (ev.text as string) ?? "";
              setStreamingText(streamingTextRef.current);
            } else if (t === "dev:done" || t === "done") {
              cleanClose = true;
              if (streamingTextRef.current.trim()) addMsg({ type: "agent_text", text: streamingTextRef.current });
              streamingTextRef.current = "";
              setStreamingText("");
              setTaskStatus("completed");
            } else if (t === "dev:file_op") {
              addMsg({ type: "file_op", op: ev.op as string, path: (ev.path as string) ?? "", pattern: ev.pattern as string });
            } else if (t === "dev:patch_proposed") {
              setTaskStatus("waiting_approval");
              if (streamingTextRef.current.trim()) {
                addMsg({ type: "agent_text", text: streamingTextRef.current });
                streamingTextRef.current = "";
                setStreamingText("");
              }
              addMsg({
                type: "patch_proposed",
                patch: {
                  patchId:     ev.patchId     as string,
                  file:        ev.file        as string,
                  description: ev.description as string,
                  oldContent:  ev.oldContent  as string,
                  newContent:  ev.newContent  as string,
                  linesAdded:  ev.linesAdded  as number,
                  riskLevel:   ev.riskLevel   as "low" | "medium" | "high" | undefined,
                  uiImpact:    ev.uiImpact    as string | undefined,
                  logicImpact: ev.logicImpact as string | undefined,
                  safeToTest:  ev.safeToTest  as boolean | undefined,
                },
              });
            } else if (t === "dev:check_started") {
              addMsg({ type: "check_started", check: ev.check as string, project: ev.project as string });
            } else if (t === "dev:check_passed") {
              addMsg({ type: "check_passed", check: ev.check as string, output: ev.output as string, project: ev.project as string });
            } else if (t === "dev:check_failed") {
              addMsg({ type: "check_failed", check: ev.check as string, output: ev.output as string, project: ev.project as string });
            } else if (t === "dev:error" || t === "error") {
              addMsg({ type: "error", error: (ev.error as string) ?? (ev.message as string) });
            } else if (t === "dev:status") {
              const stage = ev.stage as string;
              setCurrentStage(stage === "done" || stage === "thinking" ? null : stage);
            } else if (t === "dev:manual_patch") {
              addMsg({
                type: "manual_patch",
                patch: {
                  patchId:     `manual-${Date.now()}`,
                  file:        ev.file        as string,
                  description: ev.description as string,
                  oldContent:  ev.oldText     as string ?? "",
                  newContent:  ev.newContent  as string,
                },
              });
            }
          } catch { /* malformed SSE */ }
        }
      }
    } catch { /* stream read error */ }

    setIsRunning(false);
    setCurrentStage(null);
    streamingTextRef.current = "";
    setStreamingText("");
    if (!cleanClose) setSseDropped(true);
  }, [input, isRunning, addMsg, taskId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const insertPath = (p: string) => {
    setInput(prev => prev ? `${prev} ${p}` : `Read ${p}`);
    setTab("chat");
    setTimeout(() => inputRef.current?.focus(), 80);
  };

  const hasRealMessages = messages.filter(m => m.type !== "restore_notice").length > 0;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "hsl(220 25% 4% / 0.85)", backdropFilter: "blur(4px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative flex flex-col w-full sm:w-[720px] sm:max-w-[95vw] rounded-t-2xl sm:rounded-2xl overflow-hidden"
        style={{
          height: "min(92vh, 760px)",
          background: "hsl(220 20% 7%)",
          border: "1px solid hsl(210 15% 18%)",
          boxShadow: "0 0 60px hsl(194 100% 40% / 0.08), 0 24px 80px hsl(220 25% 2% / 0.8)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0" style={{ borderColor: "hsl(210 15% 13%)" }}>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4" style={{ color: "hsl(194 100% 55%)" }} />
              <span className="font-mono text-sm font-semibold tracking-wide" style={{ color: "hsl(196 50% 70%)" }}>DEV AGENT</span>
              {isRunning && <span className="text-xs font-mono animate-pulse" style={{ color: "hsl(38 100% 62%)" }}>● RUNNING</span>}
              {taskId && !isRunning && <span className="text-[9px] font-mono opacity-40 ml-1" style={{ color: "hsl(194 100% 60%)" }}>TASK</span>}
            </div>
            {/* Tabs */}
            <div className="flex items-center gap-0.5 ml-2">
              {(["chat", "workspace", "patches", "memory", "agents"] as PanelTab[]).map(t => (
                <button key={t} type="button" onClick={() => setTab(t)}
                  className="text-xs px-2.5 py-1 rounded-lg transition-all font-medium"
                  style={{
                    background: tab === t ? "hsl(194 100% 50% / 0.12)" : "transparent",
                    color: tab === t ? "hsl(194 100% 65%)" : "hsl(196 30% 45%)",
                    border: `1px solid ${tab === t ? "hsl(194 100% 50% / 0.35)" : "transparent"}`,
                  }}>
                  {t === "chat"      ? "Chat"
                   : t === "workspace" ? <span className="flex items-center gap-1"><FolderOpen className="w-3 h-3" />Workspace</span>
                   : t === "patches"   ? <span className="flex items-center gap-1"><Layers className="w-3 h-3" />Patches</span>
                   : t === "agents"    ? <span className="flex items-center gap-1"><Network className="w-3 h-3" />Agents</span>
                   : <span className="flex items-center gap-1"><BookOpen className="w-3 h-3" />Memory</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            {hasRealMessages && tab === "chat" && !isRunning && (
              <button type="button" onClick={handleClear} title="Clear session"
                className="p-1 rounded-lg opacity-40 hover:opacity-70 transition-opacity"
                style={{ color: "hsl(355 70% 55%)" }}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button type="button" onClick={onClose} className="p-1 rounded-lg opacity-50 hover:opacity-100 transition-opacity" style={{ color: "hsl(196 30% 55%)" }}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Startup health summary banner — auto-dismisses after 8 s */}
        {startupBanner && (
          <div className="flex items-center gap-2.5 mx-4 mt-3 px-3 py-2 rounded-lg flex-shrink-0"
            style={{
              background: startupBanner.label === "healthy"
                ? "hsl(142 71% 45% / 0.07)"
                : startupBanner.label === "degraded"
                ? "hsl(38 100% 50% / 0.07)"
                : "hsl(355 80% 55% / 0.07)",
              border: `1px solid ${startupBanner.label === "healthy"
                ? "hsl(142 71% 45% / 0.25)"
                : startupBanner.label === "degraded"
                ? "hsl(38 100% 50% / 0.25)"
                : "hsl(355 80% 55% / 0.25)"}`,
            }}>
            <Zap className="w-3.5 h-3.5 flex-shrink-0" style={{
              color: startupBanner.label === "healthy"
                ? "hsl(142 71% 55%)"
                : startupBanner.label === "degraded"
                ? "hsl(38 100% 62%)"
                : "hsl(355 80% 62%)",
            }} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold" style={{
                color: startupBanner.label === "healthy"
                  ? "hsl(142 71% 65%)"
                  : startupBanner.label === "degraded"
                  ? "hsl(38 100% 70%)"
                  : "hsl(355 80% 68%)",
              }}>
                Build health {startupBanner.score}/100 — {startupBanner.label}
              </p>
              <p className="text-[10px] opacity-70 truncate" style={{ color: "hsl(196 30% 55%)" }}>
                {startupBanner.tsErrors > 0
                  ? `${startupBanner.tsErrors} TypeScript error${startupBanner.tsErrors !== 1 ? "s" : ""}`
                  : "No TypeScript errors"}
                {startupBanner.patchCount > 0
                  ? ` · ${startupBanner.patchCount} patch${startupBanner.patchCount !== 1 ? "es" : ""} pending`
                  : ""}
              </p>
            </div>
            <button type="button" onClick={() => setStartupBanner(null)}
              className="p-1 rounded opacity-40 hover:opacity-80 transition-opacity flex-shrink-0"
              style={{ color: "hsl(196 30% 55%)" }}>
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Workspace tab */}
        {tab === "workspace" && <div className="flex-1 overflow-hidden"><WorkspaceTab onInsertPath={insertPath} /></div>}

        {/* Patches tab */}
        {tab === "patches" && (
          <div className="flex-1 overflow-hidden">
            <PatchesTab onMessage={(msg, isErr) => {
              addMsg({ type: isErr ? "error" : "agent_text", text: isErr ? undefined : msg, error: isErr ? msg : undefined } as DevMessage);
            }} />
          </div>
        )}

        {/* Memory tab */}
        {tab === "memory" && <div className="flex-1 overflow-hidden"><MemoryTab /></div>}

        {/* Agents tab */}
        {tab === "agents" && <div className="flex-1 overflow-hidden"><MultiAgentPanel /></div>}

        {/* Chat tab */}
        {tab === "chat" && (
          <>
            {/* Always-visible status bar */}
            <StatusBar onSwitchTab={setTab} taskStatus={taskStatus} />

            {/* Context pill — health · improvements · tasks · git + dynamic suggestions */}
            <ContextPill
              onSuggest={prompt => { setInput(prompt); setTimeout(() => inputRef.current?.focus(), 50); }}
              onSwitchTab={setTab}
            />

            {/* Resume / clear stuck task banner */}
            {taskId && !isRunning && taskStatus === "waiting_approval" && (
              <div className="flex items-center gap-2.5 mx-4 mt-3 px-3 py-2 rounded-lg flex-shrink-0"
                style={{ background: "hsl(264 80% 60% / 0.08)", border: "1px solid hsl(264 80% 60% / 0.25)" }}>
                <Layers className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(264 80% 72%)" }} />
                <div className="flex-1">
                  <p className="text-xs font-semibold" style={{ color: "hsl(264 80% 80%)" }}>Patch ready for review</p>
                  <p className="text-[10px] opacity-70" style={{ color: "hsl(264 60% 65%)" }}>A proposed patch is waiting in the queue.</p>
                </div>
                <button type="button" onClick={() => setTab("patches")}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg"
                  style={{ background: "hsl(264 80% 55% / 0.15)", border: "1px solid hsl(264 80% 55% / 0.35)", color: "hsl(264 80% 80%)" }}>
                  <Layers className="w-3 h-3" />Review
                </button>
                <button type="button"
                  onClick={async () => {
                    await fetch(`${TASKS_URL}/${taskId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "cancelled" }) });
                    setTaskStatus(null);
                    setTaskId(null);
                    saveTaskId(null);
                  }}
                  className="flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg opacity-60 hover:opacity-100 transition-opacity"
                  style={{ color: "hsl(355 80% 62%)" }}>
                  <X className="w-3 h-3" />Clear
                </button>
              </div>
            )}

            {/* SSE reconnect banner */}
            {sseDropped && !isRunning && (
              <div className="flex items-center gap-2.5 mx-4 mt-3 px-3 py-2 rounded-lg flex-shrink-0" style={{ background: "hsl(38 100% 50% / 0.08)", border: "1px solid hsl(38 100% 50% / 0.25)" }}>
                <WifiOff className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(38 100% 62%)" }} />
                <div className="flex-1">
                  <p className="text-xs font-semibold" style={{ color: "hsl(38 100% 72%)" }}>Connection dropped</p>
                  <p className="text-[10px] opacity-70" style={{ color: "hsl(38 80% 62%)" }}>The stream closed before finishing.</p>
                </div>
                <button type="button" onClick={() => { setSseDropped(false); sendMessage(lastMsg); }}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg"
                  style={{ background: "hsl(38 80% 50% / 0.15)", border: "1px solid hsl(38 80% 50% / 0.35)", color: "hsl(38 100% 72%)" }}>
                  <RefreshCw className="w-3 h-3" />Reconnect
                </button>
              </div>
            )}

            {/* Onboarding / quick starters */}
            {!hasRealMessages && (
              <>
                <div className="flex items-start gap-2.5 mx-4 mt-3 px-3 py-2 rounded-lg flex-shrink-0" style={{ background: "hsl(38 100% 50% / 0.08)", border: "1px solid hsl(38 100% 50% / 0.2)" }}>
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "hsl(38 100% 62%)" }} />
                  <div>
                    <p className="text-xs font-semibold mb-0.5" style={{ color: "hsl(38 100% 72%)" }}>Dev Mode — Inspect &amp; Edit Project Files</p>
                    <p className="text-xs" style={{ color: "hsl(38 80% 55%)" }}>Tasks persist across restarts. Validation runs automatically after apply. Snapshots let you restore any file.</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 px-4 pt-3 flex-shrink-0">
                  {[
                    "Find where the Jarvis title is rendered",
                    "Propose changing the input placeholder text",
                    "Run typecheck on the frontend",
                    "Search for where SSE events are sent",
                  ].map(s => (
                    <button key={s} type="button"
                      onClick={() => { setInput(s); setTimeout(() => inputRef.current?.focus(), 50); }}
                      className="text-xs px-3 py-1.5 rounded-lg opacity-70 hover:opacity-100 transition-all"
                      style={{ background: "hsl(210 15% 10%)", border: "1px solid hsl(210 15% 18%)", color: "hsl(196 40% 60%)" }}>
                      {s}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 flex flex-col gap-3">
              {messages.map(msg => {
                switch (msg.type) {
                  case "restore_notice":
                    return (
                      <div key={msg.id} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{ background: "hsl(194 100% 50% / 0.06)", border: "1px solid hsl(194 100% 50% / 0.18)" }}>
                        <RotateCcw className="w-3 h-3 flex-shrink-0" style={{ color: "hsl(194 100% 55%)" }} />
                        <span style={{ color: "hsl(194 100% 65%)" }}>{msg.text}</span>
                      </div>
                    );
                  case "agent_text":
                    return (
                      <div key={msg.id} className="px-0 py-1 text-sm" style={{ color: "hsl(196 40% 70%)" }}>
                        <MarkdownContent content={msg.text ?? ""} />
                      </div>
                    );
                  case "file_op":
                    return <FileOpCard key={msg.id} msg={msg} />;
                  case "check_started":
                  case "check_passed":
                  case "check_failed":
                  case "validation_started":
                  case "validation_done":
                    return <CheckCard key={msg.id} msg={msg} />;
                  case "patch_proposed":
                    return msg.patch ? (
                      <DiffViewer
                        key={msg.id}
                        file={msg.patch.file}
                        description={msg.patch.description}
                        oldContent={msg.patch.oldContent}
                        newContent={msg.patch.newContent}
                        onApprove={() => handleApprove(msg.patch!)}
                        onReject={() => handleReject(msg.patch!.patchId)}
                        applying={msg.applying}
                        metadata={{
                          riskLevel:   msg.patch.riskLevel,
                          uiImpact:    msg.patch.uiImpact,
                          logicImpact: msg.patch.logicImpact,
                          safeToTest:  msg.patch.safeToTest,
                        }}
                      />
                    ) : null;
                  case "patch_applied":
                    return (
                      <div key={msg.id} className="rounded-lg text-xs overflow-hidden" style={{ background: "hsl(142 60% 30% / 0.12)", border: "1px solid hsl(142 60% 35% / 0.3)" }}>
                        <div className="flex items-center gap-2 px-3 py-2">
                          <FileEdit className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(142 71% 60%)" }} />
                          <span style={{ color: "hsl(142 71% 60%)" }}>Patch applied — <span className="font-mono">{msg.patch?.file}</span></span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
                          {/* Rollback */}
                          <button type="button" disabled={msg.rollingBack}
                            onClick={() => msg.patch?.file && handleRollback(msg.patch.file, msg.id)}
                            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md transition-all disabled:opacity-40"
                            style={{ background: "hsl(38 80% 50% / 0.12)", border: "1px solid hsl(38 80% 50% / 0.3)", color: "hsl(38 100% 65%)" }}>
                            <RotateCcw className="w-2.5 h-2.5" />
                            {msg.rollingBack ? "Rolling back…" : "Rollback"}
                          </button>
                          {/* Snapshot restore */}
                          {msg.patch?.snapshotId && (
                            <button type="button" disabled={msg.rollingBack}
                              onClick={() => handleSnapshotRestore(msg.patch!.snapshotId!, msg.patch!.file, msg.id)}
                              className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md transition-all disabled:opacity-40"
                              style={{ background: "hsl(264 60% 50% / 0.12)", border: "1px solid hsl(264 60% 50% / 0.3)", color: "hsl(264 80% 72%)" }}>
                              <Database className="w-2.5 h-2.5" />Restore snapshot
                            </button>
                          )}
                          {/* Git commit */}
                          {gitAvailable && msg.patch && (
                            <button type="button" disabled={msg.committing}
                              onClick={() => handleCommit(msg.patch!, msg.id)}
                              className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md transition-all disabled:opacity-40"
                              style={{ background: "hsl(194 80% 40% / 0.12)", border: "1px solid hsl(194 80% 45% / 0.3)", color: "hsl(194 100% 65%)" }}>
                              <GitCommit className="w-2.5 h-2.5" />
                              {msg.committing ? "Committing…" : "Commit"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  case "patch_rejected":
                    return (
                      <div key={msg.id} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{ background: "hsl(210 15% 8%)", border: "1px solid hsl(210 15% 15%)" }}>
                        <span style={{ color: "hsl(210 15% 40%)" }}>✕ Patch rejected — {msg.patch?.file}</span>
                      </div>
                    );
                  case "manual_patch":
                    return <ManualPatchCard key={msg.id} msg={msg} />;
                  case "error":
                    return (
                      <div key={msg.id} className="px-3 py-2 rounded-lg text-xs" style={{ background: "hsl(355 80% 40% / 0.1)", border: "1px solid hsl(355 80% 45% / 0.3)" }}>
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: "hsl(355 80% 62%)" }} />
                          <span className="font-mono break-all flex-1" style={{ color: "hsl(355 80% 62%)" }}>{msg.error}</span>
                          {!isRunning && lastMsg && (
                            <button type="button"
                              onClick={() => sendMessage(lastMsg)}
                              className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-md transition-all"
                              style={{ background: "hsl(355 60% 40% / 0.15)", border: "1px solid hsl(355 60% 45% / 0.35)", color: "hsl(355 80% 72%)" }}>
                              <RefreshCw className="w-2.5 h-2.5" />Retry
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  default:
                    return null;
                }
              })}

              {streamingText && (
                <div className="text-sm" style={{ color: "hsl(196 40% 70%)" }}>
                  <MarkdownContent content={streamingText} />
                  <span className="streaming-cursor" aria-hidden="true" />
                </div>
              )}

              {isRunning && !streamingText && (
                <div className="flex items-center gap-2 text-xs" style={{ color: "hsl(194 100% 55%)" }}>
                  <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin inline-block" />
                  <span>
                    {currentStage === "reading"      && "Reading file…"}
                    {currentStage === "searching"    && "Searching…"}
                    {currentStage === "proposing"    && "Proposing patch…"}
                    {currentStage === "validating"   && "Validating…"}
                    {currentStage === "direct_patch" && "Direct patch mode…"}
                    {currentStage === "blocked"      && "Skipping redundant step…"}
                    {(!currentStage || currentStage === "thinking") && "Thinking…"}
                  </span>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="flex-shrink-0 border-t px-4 py-3" style={{ borderColor: "hsl(210 15% 13%)" }}>
              <div className="flex items-end gap-2 bg-card border border-border rounded-xl px-3 py-2 focus-within:border-primary/60 transition-colors">
                <textarea
                  ref={inputRef}
                  className="flex-1 bg-transparent resize-none outline-none text-sm leading-relaxed placeholder:text-muted-foreground min-h-[20px] max-h-[100px] scrollbar-thin"
                  style={{ color: "hsl(196 80% 85%)" }}
                  placeholder="Ask the Dev Agent to find, analyze, or propose changes…"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  disabled={isRunning}
                />
                <button type="button" onClick={() => sendMessage()} disabled={!input.trim() || isRunning}
                  className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all active:scale-95 disabled:opacity-30"
                  style={{ background: "hsl(194 100% 50% / 0.15)", border: "1px solid hsl(194 100% 50% / 0.4)", color: "hsl(194 100% 60%)" }}>
                  <Code2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
