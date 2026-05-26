/**
 * components/DevAgentPanel.tsx — Dev Agent overlay panel.
 *
 * Features:
 * - Chat with Dev Agent (SSE stream from /api/dev/stream)
 * - Diff viewer with risk/impact metadata before approval
 * - Apply patches via /api/dev/apply (user-initiated only)
 * - Rollback button on every applied patch
 * - File browser tab (GET /api/dev/files + /api/dev/file)
 * - Manual Patch Mode fallback when apply fails
 * - Full localStorage persistence across refresh/reload
 */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  X, Code2, FileSearch, FileEdit, CheckCircle, XCircle,
  AlertTriangle, Trash2, RotateCcw, ClipboardCopy, Check,
  FolderOpen, Folder, FileText, ChevronRight,
} from "lucide-react";
import DiffViewer from "./DiffViewer";
import MarkdownContent from "./MarkdownContent";

const BASE        = import.meta.env.BASE_URL;
const STREAM_URL  = `${BASE}api/dev/stream`;
const APPLY_URL   = `${BASE}api/dev/apply`;
const ROLLBACK_URL = `${BASE}api/dev/rollback`;
const FILES_URL   = `${BASE}api/dev/files`;
const FILE_URL    = `${BASE}api/dev/file`;
const DEV_MESSAGES_KEY = "jarvas_dev_messages";

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
}

type DevEventType =
  | "agent_text" | "file_op" | "tool_start" | "tool_done" | "tool_error"
  | "patch_proposed" | "patch_applied" | "patch_rejected"
  | "check_started" | "check_passed" | "check_failed"
  | "manual_patch" | "restore_notice" | "error" | "done";

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
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

function saveDevMessages(msgs: DevMessage[]): void {
  try {
    const toSave = msgs
      .filter(m => m.type !== "check_started")
      .map(m => ({ ...m, applying: false, rollingBack: false }));
    const json = JSON.stringify(toSave);
    localStorage.setItem(
      DEV_MESSAGES_KEY,
      json.length > 400_000 ? JSON.stringify(toSave.slice(-60)) : json,
    );
  } catch { /* quota exceeded */ }
}

function loadDevMessages(): { messages: DevMessage[]; restored: boolean; taskSummary: string } {
  try {
    const raw = localStorage.getItem(DEV_MESSAGES_KEY);
    if (!raw) return { messages: [], restored: false, taskSummary: "" };
    const msgs = JSON.parse(raw) as DevMessage[];
    if (!Array.isArray(msgs) || msgs.length === 0) return { messages: [], restored: false, taskSummary: "" };
    const userTurns = msgs.filter(m => m.type === "agent_text" && m.text?.startsWith("**You:**"));
    const lastTask = userTurns.length > 0
      ? (userTurns[userTurns.length - 1].text ?? "").replace("**You:** ", "").slice(0, 80)
      : "";
    const summary = userTurns.length > 0
      ? `${userTurns.length} task${userTurns.length > 1 ? "s" : ""} · last: "${lastTask}${lastTask.length >= 80 ? "…" : ""}"`
      : `${msgs.length} messages`;
    return { messages: msgs, restored: true, taskSummary: summary };
  } catch {
    return { messages: [], restored: false, taskSummary: "" };
  }
}

function clearDevMessages(): void { localStorage.removeItem(DEV_MESSAGES_KEY); }

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
  const isPassed = msg.type === "check_passed";
  const isRunning = msg.type === "check_started";
  const color = isPassed ? "hsl(142 71% 55%)" : isRunning ? "hsl(194 100% 60%)" : "hsl(355 80% 62%)";
  const label = isRunning ? `Running ${msg.check}…` : isPassed ? `${msg.check} passed` : `${msg.check} failed`;
  return (
    <div className="rounded-lg text-xs overflow-hidden" style={{ border: `1px solid ${color}30`, background: `${color}0a` }}>
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span style={{ color }}>
          {isPassed ? <CheckCircle className="w-3.5 h-3.5" /> : isRunning
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
        <p className="opacity-60" style={{ color: "hsl(38 80% 60%)" }}>Replace the entire file with the copied content, or expand to view:</p>
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

type FileBrowserMode = "tree" | "file";

function FileBrowser({ onInsertPath }: { onInsertPath: (p: string) => void }) {
  const [dir, setDir]         = useState("artifacts/jarvas/src");
  const [files, setFiles]     = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewFile, setViewFile] = useState<{ path: string; content: string; lines: number } | null>(null);
  const [mode, setMode]       = useState<FileBrowserMode>("tree");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const loadDir = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${FILES_URL}?dir=${encodeURIComponent(d)}&depth=2`);
      const data = await res.json() as { ok: boolean; files?: string[]; error?: string };
      if (data.ok && data.files) setFiles(data.files);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadDir(dir); }, [dir, loadDir]);

  const openFile = async (filePath: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${FILE_URL}?path=${encodeURIComponent(filePath)}`);
      const data = await res.json() as { ok: boolean; content?: string; lines?: number };
      if (data.ok && data.content) {
        setViewFile({ path: filePath, content: data.content, lines: data.lines ?? 0 });
        setMode("file");
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  // Quick-access dirs
  const QUICK_DIRS = [
    { label: "Frontend src", dir: "artifacts/jarvas/src" },
    { label: "Components",   dir: "artifacts/jarvas/src/components" },
    { label: "API routes",   dir: "artifacts/api-server/src/routes" },
    { label: "API lib",      dir: "artifacts/api-server/src/lib" },
  ];

  if (mode === "file" && viewFile) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-2 border-b flex-shrink-0" style={{ borderColor: "hsl(210 15% 13%)" }}>
          <button type="button" onClick={() => setMode("tree")} className="text-xs opacity-60 hover:opacity-100 transition-opacity" style={{ color: "hsl(194 100% 55%)" }}>← Back</button>
          <span className="font-mono text-xs truncate flex-1" style={{ color: "hsl(196 50% 65%)" }}>{viewFile.path}</span>
          <span className="text-xs opacity-50" style={{ color: "hsl(196 30% 50%)" }}>{viewFile.lines} lines</span>
          <button type="button" onClick={() => onInsertPath(viewFile.path)}
            className="text-xs px-2 py-0.5 rounded-md transition-all"
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
      {/* Quick-access buttons */}
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

      {/* File tree */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-2 py-2">
        {loading && <div className="text-xs px-2 opacity-50" style={{ color: "hsl(194 100% 55%)" }}>Loading…</div>}
        {files.map(f => {
          const isDir = f.endsWith("/");
          const depth = f.split("/").length - (isDir ? 2 : 1);
          const name  = f.split("/").filter(Boolean).pop() ?? f;
          const isOpen = expanded.has(f);

          return (
            <button
              key={f}
              type="button"
              onClick={() => {
                if (isDir) {
                  const next = new Set(expanded);
                  if (isOpen) next.delete(f); else next.add(f);
                  setExpanded(next);
                } else {
                  openFile(f);
                }
              }}
              className="flex items-center gap-1.5 w-full text-left px-2 py-0.5 rounded hover:bg-white/5 transition-colors text-xs"
              style={{ paddingLeft: `${8 + depth * 12}px`, color: isDir ? "hsl(194 100% 60%)" : "hsl(196 40% 60%)" }}
            >
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

// ─── Main panel ───────────────────────────────────────────────────────────────

interface DevAgentPanelProps { onClose: () => void; }

type PanelTab = "chat" | "files";

export default function DevAgentPanel({ onClose }: DevAgentPanelProps) {
  const [tab, setTab]   = useState<PanelTab>("chat");
  const [input, setInput] = useState("");

  const initialLoad = useRef(loadDevMessages());
  const [messages, setMessages] = useState<DevMessage[]>(() => {
    const { messages: saved, restored, taskSummary } = initialLoad.current;
    if (!restored || saved.length === 0) return [];
    const notice: DevMessage = { id: `restore-${Date.now()}`, type: "restore_notice", text: `Session restored — ${taskSummary}` };
    return [notice, ...saved];
  });

  const [isRunning, setIsRunning]     = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const bottomRef       = useRef<HTMLDivElement>(null);
  const inputRef        = useRef<HTMLTextAreaElement>(null);
  const streamingTextRef = useRef("");

  const scrollToBottom = () => bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  useEffect(() => { scrollToBottom(); }, [messages, streamingText]);

  useEffect(() => {
    const toSave = messages.filter(m => m.type !== "restore_notice");
    if (toSave.length > 0) saveDevMessages(toSave);
  }, [messages]);

  const addMsg = useCallback((msg: Omit<DevMessage, "id">) => {
    setMessages(prev => [...prev, { ...msg, id: `dev-${Date.now()}-${Math.random()}` }]);
  }, []);

  const handleClear = useCallback(() => {
    clearDevMessages();
    setMessages([]);
    setStreamingText("");
    streamingTextRef.current = "";
  }, []);

  // ── Apply ──────────────────────────────────────────────────────────────────

  const handleApprove = useCallback(async (patch: PatchData) => {
    setMessages(prev => prev.map(m => m.patch?.patchId === patch.patchId ? { ...m, applying: true } : m));

    const showFallback = () => {
      setMessages(prev => prev.map(m => m.patch?.patchId === patch.patchId ? { ...m, applying: false } : m));
      addMsg({ type: "manual_patch", patch });
    };

    let res: Response;
    try {
      res = await fetch(APPLY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patchId: patch.patchId, runCheck: true, project: "jarvas" }),
      });
    } catch (err) {
      addMsg({ type: "error", error: `Network error on ${APPLY_URL} — ${String(err)}` });
      showFallback();
      return;
    }

    if (!res.ok) {
      let body = "";
      try { body = await res.text(); } catch { /* ignore */ }
      addMsg({ type: "error", error: `${APPLY_URL} → HTTP ${res.status}: ${body.slice(0, 300)}` });
      showFallback();
      return;
    }

    const data = await res.json() as { ok: boolean; error?: string; checkResult?: string; backupPath?: string };
    if (data.ok) {
      setMessages(prev => prev.map(m =>
        m.patch?.patchId === patch.patchId ? { ...m, type: "patch_applied" as DevEventType, applying: false } : m,
      ));
      addMsg({ type: "check_passed", check: "patch", output: data.checkResult ?? "Patch applied." });
    } else {
      addMsg({ type: "error", error: `${APPLY_URL}: ${data.error ?? "Unknown error"}` });
      showFallback();
    }
  }, [addMsg]);

  const handleReject = useCallback((patchId: string) => {
    setMessages(prev => prev.map(m =>
      m.patch?.patchId === patchId ? { ...m, type: "patch_rejected" as DevEventType } : m,
    ));
  }, []);

  // ── Rollback ───────────────────────────────────────────────────────────────

  const handleRollback = useCallback(async (file: string, msgId: string) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, rollingBack: true } : m));

    let res: Response;
    try {
      res = await fetch(ROLLBACK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file }),
      });
    } catch (err) {
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, rollingBack: false } : m));
      addMsg({ type: "error", error: `Rollback network error: ${String(err)}` });
      return;
    }

    if (!res.ok) {
      let body = ""; try { body = await res.text(); } catch { /* ignore */ }
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, rollingBack: false } : m));
      addMsg({ type: "error", error: `${ROLLBACK_URL} → HTTP ${res.status}: ${body.slice(0, 200)}` });
      return;
    }

    const data = await res.json() as { ok: boolean; restoredFrom?: string; error?: string };
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, rollingBack: false } : m));
    if (data.ok) {
      addMsg({ type: "agent_text", text: `↩ Rolled back \`${file}\` from \`${data.restoredFrom ?? "backup"}\`` });
    } else {
      addMsg({ type: "error", error: data.error ?? "Rollback failed" });
    }
  }, [addMsg]);

  // ── Stream ─────────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async () => {
    const goal = input.trim();
    if (!goal || isRunning) return;
    setInput("");
    setIsRunning(true);
    streamingTextRef.current = "";
    setStreamingText("");

    addMsg({ type: "agent_text", text: `**You:** ${goal}` });

    let res: Response;
    try {
      res = await fetch(STREAM_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: goal }),
      });
    } catch (err) {
      addMsg({ type: "error", error: `Network error on ${STREAM_URL} — ${String(err)}` });
      setIsRunning(false);
      return;
    }

    if (!res.ok || !res.body) {
      let body = ""; try { body = await res.text(); } catch { /* ignore */ }
      addMsg({ type: "error", error: `${STREAM_URL} → HTTP ${res.status}: ${body.slice(0, 300)}` });
      setIsRunning(false);
      return;
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = "";

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

            if (t === "dev:token") {
              streamingTextRef.current += (ev.text as string) ?? "";
              setStreamingText(streamingTextRef.current);
            } else if (t === "dev:done" || t === "done") {
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
              addMsg({ type: "check_passed", check: ev.check as string, output: ev.output as string });
            } else if (t === "dev:check_failed") {
              addMsg({ type: "check_failed", check: ev.check as string, output: ev.output as string });
            } else if (t === "dev:error" || t === "error") {
              addMsg({ type: "error", error: (ev.error as string) ?? (ev.message as string) });
            }
          } catch { /* malformed SSE line */ }
        }
      }
    } catch { /* stream read error */ }

    setIsRunning(false);
    streamingTextRef.current = "";
    setStreamingText("");
  }, [input, isRunning, addMsg]);

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
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative flex flex-col w-full sm:w-[720px] sm:max-w-[95vw] rounded-t-2xl sm:rounded-2xl overflow-hidden"
        style={{
          height: "min(92vh, 740px)",
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
            </div>
            {/* Tabs */}
            <div className="flex items-center gap-0.5 ml-2">
              {(["chat", "files"] as PanelTab[]).map(t => (
                <button key={t} type="button" onClick={() => setTab(t)}
                  className="text-xs px-2.5 py-1 rounded-lg transition-all font-medium"
                  style={{
                    background: tab === t ? "hsl(194 100% 50% / 0.12)" : "transparent",
                    color: tab === t ? "hsl(194 100% 65%)" : "hsl(196 30% 45%)",
                    border: `1px solid ${tab === t ? "hsl(194 100% 50% / 0.35)" : "transparent"}`,
                  }}>
                  {t === "chat" ? "Chat" : "Files"}
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

        {/* File browser tab */}
        {tab === "files" && (
          <div className="flex-1 overflow-hidden">
            <FileBrowser onInsertPath={insertPath} />
          </div>
        )}

        {/* Chat tab */}
        {tab === "chat" && (
          <>
            {/* Warning banner — fresh start only */}
            {!hasRealMessages && (
              <div className="flex items-start gap-2.5 mx-4 mt-3 px-3 py-2 rounded-lg flex-shrink-0" style={{ background: "hsl(38 100% 50% / 0.08)", border: "1px solid hsl(38 100% 50% / 0.2)" }}>
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "hsl(38 100% 62%)" }} />
                <div>
                  <p className="text-xs font-semibold mb-0.5" style={{ color: "hsl(38 100% 72%)" }}>Dev Mode — Inspect &amp; Edit Project Files</p>
                  <p className="text-xs" style={{ color: "hsl(38 80% 55%)" }}>The agent reads files, proposes changes with a risk/impact label, and waits for your approval before writing anything.</p>
                </div>
              </div>
            )}

            {/* Quick starters */}
            {!hasRealMessages && (
              <div className="flex flex-wrap gap-2 px-4 pt-3 flex-shrink-0">
                {[
                  "Find where the Jarvis title is rendered",
                  "Search how chat messages are stored",
                  "Propose changing the input placeholder text",
                  "Run typecheck on the frontend",
                ].map(s => (
                  <button key={s} type="button"
                    onClick={() => { setInput(s); setTimeout(() => inputRef.current?.focus(), 50); }}
                    className="text-xs px-3 py-1.5 rounded-lg opacity-70 hover:opacity-100 transition-all"
                    style={{ background: "hsl(210 15% 10%)", border: "1px solid hsl(210 15% 18%)", color: "hsl(196 40% 60%)" }}>
                    {s}
                  </button>
                ))}
              </div>
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
                      <div key={msg.id} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{ background: "hsl(142 60% 30% / 0.15)", border: "1px solid hsl(142 60% 35% / 0.3)" }}>
                        <FileEdit className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(142 71% 60%)" }} />
                        <span style={{ color: "hsl(142 71% 60%)" }}>Patch applied — <span className="font-mono">{msg.patch?.file}</span></span>
                        <button
                          type="button"
                          disabled={msg.rollingBack}
                          onClick={() => msg.patch?.file && handleRollback(msg.patch.file, msg.id)}
                          className="ml-auto flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md transition-all disabled:opacity-40"
                          style={{ background: "hsl(38 80% 50% / 0.12)", border: "1px solid hsl(38 80% 50% / 0.3)", color: "hsl(38 100% 65%)" }}
                        >
                          <RotateCcw className="w-2.5 h-2.5" />
                          {msg.rollingBack ? "Rolling back…" : "Rollback"}
                        </button>
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
                          <span className="font-mono break-all" style={{ color: "hsl(355 80% 62%)" }}>{msg.error}</span>
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

              {isRunning && !streamingText && messages.length > 0 && (
                <div className="flex items-center gap-2 text-xs" style={{ color: "hsl(194 100% 55%)" }}>
                  <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin inline-block" />
                  <span>Thinking…</span>
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
                <button type="button" onClick={sendMessage} disabled={!input.trim() || isRunning}
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
