/**
 * components/DevAgentPanel.tsx — Dev Agent overlay panel.
 *
 * Tabs: Chat | Files | Memory
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
} from "lucide-react";
import DiffViewer from "./DiffViewer";
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

function clearMessages(): void {
  localStorage.removeItem(LS_MESSAGES);
  localStorage.removeItem(LS_TASK_ID);
}

function getSavedTaskId(): string | null { return localStorage.getItem(LS_TASK_ID); }
function saveTaskId(id: string): void    { localStorage.setItem(LS_TASK_ID, id); }

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

// ─── Main panel ───────────────────────────────────────────────────────────────

interface DevAgentPanelProps { onClose: () => void; }
type PanelTab = "chat" | "files" | "memory";

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
            } else if (t === "dev:token") {
              streamingTextRef.current += (ev.text as string) ?? "";
              setStreamingText(streamingTextRef.current);
            } else if (t === "dev:done" || t === "done") {
              cleanClose = true;
              if (streamingTextRef.current.trim()) addMsg({ type: "agent_text", text: streamingTextRef.current });
              streamingTextRef.current = "";
              setStreamingText("");
            } else if (t === "dev:file_op") {
              addMsg({ type: "file_op", op: ev.op as string, path: (ev.path as string) ?? "", pattern: ev.pattern as string });
            } else if (t === "dev:patch_proposed") {
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
              {(["chat", "files", "memory"] as PanelTab[]).map(t => (
                <button key={t} type="button" onClick={() => setTab(t)}
                  className="text-xs px-2.5 py-1 rounded-lg transition-all font-medium"
                  style={{
                    background: tab === t ? "hsl(194 100% 50% / 0.12)" : "transparent",
                    color: tab === t ? "hsl(194 100% 65%)" : "hsl(196 30% 45%)",
                    border: `1px solid ${tab === t ? "hsl(194 100% 50% / 0.35)" : "transparent"}`,
                  }}>
                  {t === "chat" ? "Chat" : t === "files" ? "Files" : <span className="flex items-center gap-1"><BookOpen className="w-3 h-3" />Memory</span>}
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

        {/* Files tab */}
        {tab === "files" && <div className="flex-1 overflow-hidden"><FileBrowser onInsertPath={insertPath} /></div>}

        {/* Memory tab */}
        {tab === "memory" && <div className="flex-1 overflow-hidden"><MemoryTab /></div>}

        {/* Chat tab */}
        {tab === "chat" && (
          <>
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
