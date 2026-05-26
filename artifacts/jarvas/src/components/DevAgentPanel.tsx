/**
 * components/DevAgentPanel.tsx — Dev Agent overlay panel.
 *
 * Reliability fixes:
 * - Every failed fetch shows the exact URL + HTTP status + response body
 * - When /api/dev/apply fails for any reason, Manual Patch Mode kicks in:
 *   exact file path, full new content in a copyable block, no conversation lost
 * - Messages and pending patch data persist in localStorage across reloads
 */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  X, Code2, FileSearch, FileEdit, CheckCircle, XCircle,
  AlertTriangle, Trash2, RotateCcw, ClipboardCopy, Check,
} from "lucide-react";
import DiffViewer from "./DiffViewer";
import MarkdownContent from "./MarkdownContent";

const BASE = import.meta.env.BASE_URL;
const APPLY_URL  = `${BASE}api/dev/apply`;
const STREAM_URL = `${BASE}api/dev/stream`;
const DEV_MESSAGES_KEY = "jarvas_dev_messages";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PatchData {
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
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

function saveDevMessages(msgs: DevMessage[]): void {
  try {
    const toSave = msgs
      .filter(m => m.type !== "check_started")
      .map(m => ({ ...m, applying: false }));
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

function clearDevMessages(): void {
  localStorage.removeItem(DEV_MESSAGES_KEY);
}

// ─── Cards ────────────────────────────────────────────────────────────────────

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

function AgentTextCard({ text }: { text: string }) {
  return (
    <div className="px-0 py-1 text-sm" style={{ color: "hsl(196 40% 70%)" }}>
      <MarkdownContent content={text} />
    </div>
  );
}

function RestoreNotice({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{ background: "hsl(194 100% 50% / 0.06)", border: "1px solid hsl(194 100% 50% / 0.18)" }}>
      <RotateCcw className="w-3 h-3 flex-shrink-0" style={{ color: "hsl(194 100% 55%)" }} />
      <span style={{ color: "hsl(194 100% 65%)" }}>{text}</span>
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
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all active:scale-95"
          style={{ background: "hsl(38 80% 50% / 0.15)", border: "1px solid hsl(38 80% 50% / 0.35)", color: copied ? "hsl(142 71% 60%)" : "hsl(38 100% 72%)" }}
        >
          {copied ? <Check className="w-3 h-3" /> : <ClipboardCopy className="w-3 h-3" />}
          {copied ? "Copied!" : "Copy file"}
        </button>
      </div>
      <div className="px-3 py-2 flex flex-col gap-1.5">
        <p style={{ color: "hsl(38 80% 60%)" }}>
          <span className="opacity-60">File: </span>
          <span className="font-mono">{patch.file}</span>
        </p>
        {patch.description && (
          <p style={{ color: "hsl(38 60% 55%)" }}>{patch.description}</p>
        )}
        <p className="opacity-60" style={{ color: "hsl(38 80% 60%)" }}>
          Replace the entire file with the copied content, or expand to view below:
        </p>
        <details>
          <summary className="cursor-pointer select-none" style={{ color: "hsl(38 80% 55%)" }}>
            View new content ({patch.newContent.split("\n").length} lines)
          </summary>
          <pre className="mt-2 p-2 rounded overflow-x-auto max-h-64 scrollbar-thin text-[11px] leading-relaxed whitespace-pre-wrap break-all" style={{ background: "hsl(220 20% 6%)", color: "hsl(196 40% 65%)" }}>
            {patch.newContent}
          </pre>
        </details>
      </div>
    </div>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────────

interface DevAgentPanelProps {
  onClose: () => void;
}

export default function DevAgentPanel({ onClose }: DevAgentPanelProps) {
  const [input, setInput] = useState("");

  const initialLoad = useRef(loadDevMessages());
  const [messages, setMessages] = useState<DevMessage[]>(() => {
    const { messages: saved, restored, taskSummary } = initialLoad.current;
    if (!restored || saved.length === 0) return [];
    const notice: DevMessage = {
      id: `restore-${Date.now()}`,
      type: "restore_notice",
      text: `Session restored — ${taskSummary}`,
    };
    return [notice, ...saved];
  });

  const [isRunning, setIsRunning] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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

  // ── Apply patch ────────────────────────────────────────────────────────────

  const handleApprove = useCallback(async (patch: PatchData) => {
    setMessages(prev => prev.map(m =>
      m.patch?.patchId === patch.patchId ? { ...m, applying: true } : m,
    ));

    const fallback = () => {
      setMessages(prev => prev.map(m =>
        m.patch?.patchId === patch.patchId ? { ...m, applying: false } : m,
      ));
      addMsg({ type: "manual_patch", patch, text: "Auto-apply failed — use manual patch below" });
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
      fallback();
      return;
    }

    if (!res.ok) {
      let body = "";
      try { body = await res.text(); } catch { /* ignore */ }
      addMsg({ type: "error", error: `${APPLY_URL} → HTTP ${res.status}: ${body.slice(0, 300)}` });
      fallback();
      return;
    }

    const data = await res.json() as { ok: boolean; error?: string; checkResult?: string };
    if (data.ok) {
      setMessages(prev => prev.map(m =>
        m.patch?.patchId === patch.patchId ? { ...m, type: "patch_applied" as DevEventType, applying: false } : m,
      ));
      addMsg({ type: "check_passed", check: "patch", output: data.checkResult ?? "Patch applied successfully." });
    } else {
      addMsg({ type: "error", error: `${APPLY_URL}: ${data.error ?? "Unknown error"}` });
      fallback();
    }
  }, [addMsg]);

  const handleReject = useCallback((patchId: string) => {
    setMessages(prev => prev.map(m =>
      m.patch?.patchId === patchId ? { ...m, type: "patch_rejected" as DevEventType } : m,
    ));
  }, []);

  // ── Send message ───────────────────────────────────────────────────────────

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
      let body = "";
      try { body = await res.text(); } catch { /* ignore */ }
      addMsg({ type: "error", error: `${STREAM_URL} → HTTP ${res.status}: ${body.slice(0, 300)}` });
      setIsRunning(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

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
            const t = ev.type as string;

            if (t === "dev:token") {
              streamingTextRef.current += (ev.text as string) ?? "";
              setStreamingText(streamingTextRef.current);
            } else if (t === "dev:done" || t === "done") {
              if (streamingTextRef.current.trim()) {
                addMsg({ type: "agent_text", text: streamingTextRef.current });
              }
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
                  patchId: ev.patchId as string,
                  file: ev.file as string,
                  description: ev.description as string,
                  oldContent: ev.oldContent as string,
                  newContent: ev.newContent as string,
                  linesAdded: ev.linesAdded as number,
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

  const hasRealMessages = messages.filter(m => m.type !== "restore_notice").length > 0;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "hsl(220 25% 4% / 0.85)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative flex flex-col w-full sm:w-[680px] sm:max-w-[95vw] rounded-t-2xl sm:rounded-2xl overflow-hidden"
        style={{
          height: "min(90vh, 700px)",
          background: "hsl(220 20% 7%)",
          border: "1px solid hsl(210 15% 18%)",
          boxShadow: "0 0 60px hsl(194 100% 40% / 0.08), 0 24px 80px hsl(220 25% 2% / 0.8)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0" style={{ borderColor: "hsl(210 15% 13%)" }}>
          <div className="flex items-center gap-2.5">
            <Code2 className="w-4 h-4" style={{ color: "hsl(194 100% 55%)" }} />
            <span className="font-mono text-sm font-semibold tracking-wide" style={{ color: "hsl(196 50% 70%)" }}>DEV AGENT</span>
            {isRunning && (
              <span className="text-xs font-mono animate-pulse" style={{ color: "hsl(38 100% 62%)" }}>● RUNNING</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-xs" style={{ color: "hsl(210 15% 35%)" }}>Patches require your approval</span>
            {hasRealMessages && !isRunning && (
              <button
                type="button"
                onClick={handleClear}
                title="Clear session"
                className="p-1 rounded-lg transition-opacity opacity-40 hover:opacity-70"
                style={{ color: "hsl(355 70% 55%)" }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button type="button" onClick={onClose} className="p-1 rounded-lg opacity-50 hover:opacity-100 transition-opacity" style={{ color: "hsl(196 30% 55%)" }}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Warning banner — only on fresh start */}
        {!hasRealMessages && (
          <div className="flex items-start gap-2.5 mx-4 mt-3 px-3 py-2 rounded-lg" style={{ background: "hsl(38 100% 50% / 0.08)", border: "1px solid hsl(38 100% 50% / 0.2)" }}>
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "hsl(38 100% 62%)" }} />
            <div>
              <p className="text-xs font-semibold mb-0.5" style={{ color: "hsl(38 100% 72%)" }}>Dev Mode — Inspect &amp; Edit Project Files</p>
              <p className="text-xs" style={{ color: "hsl(38 80% 55%)" }}>The Dev Agent can read, search, and propose changes to source files. Patches are shown as diffs and require your explicit approval before anything is written.</p>
            </div>
          </div>
        )}

        {/* Quick starters */}
        {!hasRealMessages && (
          <div className="flex flex-wrap gap-2 px-4 pt-3">
            {[
              "Find where the Jarvis title is rendered",
              "Search for how chat messages are stored",
              "Propose changing the input placeholder text",
              "Run typecheck on the frontend",
            ].map(s => (
              <button
                key={s}
                type="button"
                onClick={() => { setInput(s); setTimeout(() => inputRef.current?.focus(), 50); }}
                className="text-xs px-3 py-1.5 rounded-lg opacity-70 hover:opacity-100 transition-all"
                style={{ background: "hsl(210 15% 10%)", border: "1px solid hsl(210 15% 18%)", color: "hsl(196 40% 60%)" }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Message list */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 flex flex-col gap-3">
          {messages.map(msg => {
            switch (msg.type) {
              case "restore_notice":
                return <RestoreNotice key={msg.id} text={msg.text ?? ""} />;
              case "agent_text":
                return <AgentTextCard key={msg.id} text={msg.text ?? ""} />;
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
                  />
                ) : null;
              case "patch_applied":
                return (
                  <div key={msg.id} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{ background: "hsl(142 60% 30% / 0.15)", border: "1px solid hsl(142 60% 35% / 0.3)" }}>
                    <FileEdit className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(142 71% 60%)" }} />
                    <span style={{ color: "hsl(142 71% 60%)" }}>Patch applied — {msg.patch?.file}</span>
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
            <button
              type="button"
              onClick={sendMessage}
              disabled={!input.trim() || isRunning}
              className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all active:scale-95 disabled:opacity-30"
              style={{ background: "hsl(194 100% 50% / 0.15)", border: "1px solid hsl(194 100% 50% / 0.4)", color: "hsl(194 100% 60%)" }}
            >
              <Code2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
