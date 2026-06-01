/**
 * pages/Chat.tsx — Main Jarvis chat interface
 *
 * All messages now go through a single POST /api/chat endpoint.
 * The backend handles intent classification, tool routing, web search,
 * and memory — the frontend just sends the message and renders the response.
 *
 * Debug mode (toggle with the Terminal button in the header):
 *   Each assistant message shows a debug panel with intent, action,
 *   confidence, reasoning path, and timing.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  Brain,
  Trash2,
  Terminal,
  LayoutDashboard,
  BookOpen,
  Code2,
  Activity,
  Gauge,
  ScrollText,
  ShieldCheck,
  History,
  Cpu,
  Bot,
  Layers,
  TrendingUp,
  Map as MapIcon,
  Users,
  Network,
  ClipboardList,
  RefreshCw,
  Download,
  Wrench,
  ChevronDown,
} from "lucide-react";
import { DevErrorBoundary } from "@/components/DevErrorBoundary";
import { generateId } from "@/lib/uuid";
import { useSpeechInput } from "@/hooks/useSpeechInput";
import { useSpeechSession } from "@/hooks/useSpeechSession";
import RuntimeInspector from "@/components/RuntimeInspector";
import NotificationToast from "@/components/NotificationToast";
import PlanCard from "@/components/PlanCard";
import PlannerPanel from "@/components/PlannerPanel";
import { JarvisRuntime } from "@/lib/runtime";
import { callPlanStream, savePlan, clearSavedPlan, type FrontendPlan, type PlanToolEvent } from "@/lib/plannerApi";
import { useLocation } from "wouter";
import MemoryPanel, { type SessionMemory } from "@/components/MemoryPanel";
import DebugPanel, { type DebugInfo } from "@/components/DebugPanel";
import MarkdownContent from "@/components/MarkdownContent";
import ToolStatusBubble, { type ToolCallInfo } from "@/components/ToolStatusBubble";
import DevAgentPanel from "@/components/DevAgentPanel";
import JarvisTasksPanel    from "@/components/JarvisTasksPanel";
import DiagnosticsPanel    from "@/components/DiagnosticsPanel";
import SystemStatusPanel   from "@/components/SystemStatusPanel";
import ActivityLogPanel    from "@/components/ActivityLogPanel";
import AgentActionsPanel   from "@/components/AgentActionsPanel";
import CheckpointsPanel    from "@/components/CheckpointsPanel";
import ExecutionsPanel     from "@/components/ExecutionsPanel";
import AutoLoopPanel       from "@/components/AutoLoopPanel";
import PlansPanel          from "@/components/PlansPanel";
import PriorityPanel       from "@/components/PriorityPanel";
import WorkspacePanel      from "@/components/WorkspacePanel";
import ReasonPanel         from "@/components/ReasonPanel";
import AgentsPanel         from "@/components/AgentsPanel";
import CollabPanel         from "@/components/CollabPanel";
import WorkOrdersPanel     from "@/components/WorkOrdersPanel";
import ImprovementPanel    from "@/components/ImprovementPanel";
import {
  approvePatch, rejectPatch as logRejectPatch, fetchPendingPatches,
  fetchServerStatus,
  type PendingPatchSummary, type ServerStatus,
} from "@/lib/patchApproval";
import PatchNotificationBar from "@/components/PatchNotificationBar";
import ChatPatchProposal from "@/components/ChatPatchProposal";
import { STATUS_CONFIG } from "@/components/chat/chat.types";
import type { AgentStatus, Source, PatchProposalRef, Message } from "@/components/chat/chat.types";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ChatToolbar } from "@/components/chat/ChatToolbar";
import { ChatMessageList } from "@/components/chat/ChatMessageList";
import { ChatInput } from "@/components/chat/ChatInput";

// ─── Types — imported from src/components/chat/chat.types.ts ──────────────────

function inferStatus(message: string): AgentStatus {
  if (/\b(latest|current|recent|today|news|search|find|look up|weather|stock|price|happening)\b/i.test(message))
    return "researching";
  if (/\b(code|debug|function|bug|error|script|javascript|typescript|python|react|css|html|api|fix)\b/i.test(message))
    return "processing";
  return "thinking";
}

// ─── Session management ───────────────────────────────────────────────────────

const SESSION_KEY = "jarvas_session_id";
const DEBUG_KEY = "jarvas_debug_mode";
const AUTO_PLANNER_KEY = "jarvas_auto_planner";
const DEV_PANEL_KEY = "jarvas_dev_panel_open";

function getAutoPlannerEnabled(): boolean {
  return localStorage.getItem(AUTO_PLANNER_KEY) === "true";
}

function setAutoPlannerEnabledStorage(val: boolean): void {
  localStorage.setItem(AUTO_PLANNER_KEY, String(val));
}

function getDevPanelOpen(): boolean {
  return localStorage.getItem(DEV_PANEL_KEY) === "true";
}

// ─── Planner intent detection ─────────────────────────────────────────────────

interface PlannerIntentResult {
  shouldRoute: boolean;
  confidence: number;
  reason: string;
}

function detectPlannerIntent(msg: string): PlannerIntentResult {
  const m = msg.toLowerCase().trim();
  const words = m.split(/\s+/);

  if (words.length < 4) return { shouldRoute: false, confidence: 0.1, reason: "too_short" };

  const casualOpener = /^(hi|hey|hello|what is|what's|who is|who's|how do|how does|is there|are there|can you just|tell me|explain|what are|define|what does)\b/i;
  if (casualOpener.test(m) && words.length < 10) {
    return { shouldRoute: false, confidence: 0.15, reason: "casual_question" };
  }

  const multiStep = /\b(then|and then|after that|followed by|also remind|and remind|and summarize|and create|and save|and send)\b/i.test(msg);

  const startsWithPlanner = /^(research|summarize|summarise|compare|analyze|analyse|investigate|evaluate|assess|find the best|make a plan|create a plan|plan out|break down|compile|gather)\b/i.test(m);

  const hasPlannerVerb = /\b(research|summarize|summarise|compare|analyze|analyse|investigate|evaluate|find the best|compile a|gather (info|data)|create a (report|summary|plan|schedule|breakdown))\b/i.test(msg);

  const hasReminder = /\b(remind me|set a reminder|create a reminder|schedule a reminder|add a reminder)\b/i.test(msg);

  let confidence = 0;
  let reason = "no_match";

  if (startsWithPlanner && multiStep) { confidence = 0.97; reason = "planner_start+multi_step"; }
  else if (startsWithPlanner && hasReminder) { confidence = 0.92; reason = "planner_start+reminder"; }
  else if (startsWithPlanner) { confidence = 0.82; reason = "planner_start"; }
  else if (hasPlannerVerb && multiStep) { confidence = 0.90; reason = "planner_verb+multi_step"; }
  else if (hasPlannerVerb && hasReminder) { confidence = 0.85; reason = "planner_verb+reminder"; }
  else if (hasPlannerVerb) { confidence = 0.76; reason = "planner_verb"; }
  else if (multiStep && hasReminder) { confidence = 0.80; reason = "multi_step+reminder"; }
  else if (hasReminder && words.length >= 8) { confidence = 0.65; reason = "reminder_long"; }
  else if (multiStep && words.length >= 12) { confidence = 0.62; reason = "multi_step_long"; }

  return { shouldRoute: confidence >= 0.75, confidence, reason };
}

function getOrCreateSessionId(): string {
  const existing = localStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const id = generateId();
  localStorage.setItem(SESSION_KEY, id);
  return id;
}

function createNewSessionId(): string {
  const id = generateId();
  localStorage.setItem(SESSION_KEY, id);
  return id;
}

function getDebugMode(): boolean {
  return localStorage.getItem(DEBUG_KEY) === "true";
}

function setDebugMode(val: boolean): void {
  localStorage.setItem(DEBUG_KEY, String(val));
}

// ─── API ─────────────────────────────────────────────────────────────────────

interface StreamDonePayload {
  debug: DebugInfo;
  model: string;
  isSearch?: boolean;
  isFakeSearch?: boolean;
  sources?: Source[];
}

type ToolSSEEvent =
  | { type: "tool_start"; toolCallId: string; tool: string; label: string }
  | { type: "tool_done";  toolCallId: string; tool: string; durationMs: number; result: unknown }
  | { type: "tool_error"; toolCallId: string; tool: string; durationMs: number; error: string };

async function callChatStream(
  message: string,
  sessionId: string,
  base: string,
  onToken: (text: string) => void,
  onDone: (data: StreamDonePayload) => void,
  onError: (reason?: string) => void,
  onToolEvent?: (event: ToolSSEEvent) => void,
): Promise<void> {
  const url = `${base}api/chat/stream`;
  console.log("[Jarvis] POST →", url);

  // 15 s timeout for the initial connection only.
  // Once the stream starts reading, the timer is cleared.
  const controller = new AbortController();
  const connectTimer = setTimeout(() => controller.abort(), 15_000);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sessionId }),
      signal: controller.signal,
    });
    clearTimeout(connectTimer);
  } catch (err) {
    clearTimeout(connectTimer);
    const timedOut = controller.signal.aborted;
    const detail = err instanceof Error ? err.message : String(err);
    const reason = timedOut
      ? `No response from API after 15 s — check VITE_API_BASE_URL (tried: ${url})`
      : `Network error: ${detail} (tried: ${url})`;
    console.error("[Jarvis] fetch failed:", reason);
    onError(reason);
    return;
  }

  if (!res.ok || !res.body) {
    const reason = `API returned ${res.status} ${res.statusText} (${url})`;
    console.error("[Jarvis] stream error:", reason);
    onError(reason);
    return;
  }

  // ── Shared SSE line parser ──────────────────────────────────────────────────
  let doneEventReceived = false;
  let tokenCount = 0;

  function parseLine(line: string, src: "stream" | "fallback"): void {
    if (!line.startsWith("data: ")) return;
    const jsonStr = line.slice(6).trim();
    if (!jsonStr) return;
    try {
      const event = JSON.parse(jsonStr) as Record<string, unknown>;
      const evType = event.type as string;
      console.log(`[CSP:${src}] event type="${evType}"`, evType === "token" ? `text="${String(event.text).slice(0, 30)}"` : "");
      if (evType === "token" && typeof event.text === "string") {
        tokenCount++;
        onToken(event.text);
      } else if (evType === "done") {
        doneEventReceived = true;
        console.log(`[CSP:${src}] calling onDone — tokenCount:`, tokenCount);
        onDone(event as unknown as StreamDonePayload);
      } else if (evType === "error") {
        doneEventReceived = true;
        const msg = typeof event.message === "string" ? event.message : "Stream error from server";
        console.warn(`[CSP:${src}] server error event:`, msg);
        onError(msg);
      } else if (
        (evType === "tool_start" || evType === "tool_done" || evType === "tool_error") &&
        onToolEvent
      ) {
        onToolEvent(event as unknown as ToolSSEEvent);
      } else if (evType) {
        console.log(`[CSP:${src}] unhandled event type:`, evType);
      }
    } catch (parseErr) {
      console.warn(`[CSP:${src}] JSON parse failed for line:`, line.slice(0, 80), parseErr);
    }
  }

  // ── Path A: ReadableStream progressive streaming ────────────────────────────
  // Runs as a background IIFE raced against an 8-second timer.
  //
  // Safari cross-origin SSE problem: reader.read() does NOT throw — it hangs
  // forever, suspending the while-loop.  A catch-based fallback never fires.
  // The only safe escape is Promise.race with a timeout.
  console.log("[CSP] starting streaming attempt, URL:", url);
  const streamingAttempt = (async () => {
    try {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { console.log("[CSP:stream] reader done, doneEventReceived:", doneEventReceived); break; }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) parseLine(line, "stream");
        }
        // Flush decoder, process any partial line left in the buffer
        const tail = decoder.decode();
        if (tail) buffer += tail;
        if (buffer.trim()) parseLine(buffer, "stream");
      } catch (readErr) {
        console.warn("[CSP:stream] reader.read() threw (likely Safari CORS hang):", readErr);
        try { reader.cancel(); } catch { /* ignore */ }
      }
    } catch (readerErr) {
      console.warn("[CSP:stream] getReader() threw:", readerErr);
    }
    console.log("[CSP:stream] streamingAttempt IIFE resolved — doneEventReceived:", doneEventReceived);
  })();

  const raceTimer = new Promise<void>(resolve =>
    setTimeout(() => { console.log("[CSP] 8s timeout fired"); resolve(); }, 8_000)
  );

  console.log("[CSP] awaiting Promise.race(streamingAttempt, 8s)");
  await Promise.race([streamingAttempt, raceTimer]);
  console.log("[CSP] race resolved — doneEventReceived:", doneEventReceived, "tokenCount:", tokenCount);

  // ── Path B: fresh fetch + res.text() fallback ───────────────────────────────
  // Triggered when streaming hung (Safari), threw, or completed without a done
  // event.  Mirrors DebugApi.tsx probeChat() exactly — proven to work.
  if (!doneEventReceived) {
    console.warn("[CSP] Path B fallback starting — no done event from streaming. URL:", url);
    try {
      // Fresh request — no AbortController signal, no getReader(), just text()
      const fbRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, sessionId }),
      });
      console.log("[CSP:fallback] fetch status:", fbRes.status, fbRes.statusText);
      if (!fbRes.ok) {
        onError(`Fallback fetch returned ${fbRes.status} ${fbRes.statusText} (${url})`);
        return;
      }
      const fullText = await fbRes.text();
      console.log("[CSP:fallback] received", fullText.length, "bytes — first 200:", fullText.slice(0, 200));
      for (const line of fullText.split("\n")) parseLine(line, "fallback");
      console.log("[CSP:fallback] parse complete — doneEventReceived:", doneEventReceived, "tokenCount:", tokenCount);
    } catch (fbErr) {
      const detail = fbErr instanceof Error ? fbErr.message : String(fbErr);
      console.error("[CSP:fallback] failed:", detail, "URL:", url);
      onError(`Text fallback failed: ${detail}`);
      return;
    }
  }

  if (!doneEventReceived) {
    console.error("[CSP] No done event from streaming or fallback. URL:", url);
    onError(`Stream closed without a response (URL: ${url})`);
  }
  console.log("[CSP] callChatStream returning — doneEventReceived:", doneEventReceived);
}

async function loadSession(
  sessionId: string,
  base: string,
): Promise<SessionMemory> {
  const res = await fetch(`${base}api/memory/${sessionId}`);
  if (!res.ok) throw new Error(`Memory API error: ${res.status}`);
  return res.json() as Promise<SessionMemory>;
}

// ─── Sub-components — moved to src/components/chat/ ──────────────────────────

// ─── Main page ────────────────────────────────────────────────────────────────

import { getApiBase } from "@/lib/apiConfig";
const BASE = getApiBase();
console.log("[Jarvis] Chat module loaded v2 — BASE:", BASE);

const DEV_TOOLS_ENABLED =
  import.meta.env.DEV === true ||
  import.meta.env.VITE_ENABLE_DEV_TOOLS === "true";

// Runtime singleton — no React dependency, survives re-renders
const _rt = JarvisRuntime.getInstance();

const WELCOME = (name?: string): Message => ({
  id: "init",
  role: "assistant",
  content: name
    ? `Hello, ${name}. I remember you. What can I help with today?`
    : "Hello. I'm Jarvis — ask me anything. I'll search the web, write code, help plan, or just talk.",
  timestamp: new Date(),
});

// ─── CopyButton ───────────────────────────────────────────────────────────────

function CopyButton({ text, label = "COPY" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text)
          .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); })
          .catch(() => {});
      }}
      className="flex items-center gap-1 text-[9px] font-bold px-2 py-1 rounded-lg transition-all active:scale-95"
      style={{
        background: copied ? "hsl(142 60% 40% / 0.2)" : "hsl(210 15% 12%)",
        border:     `1px solid ${copied ? "hsl(142 60% 40%)" : "hsl(210 15% 22%)"}`,
        color:      copied ? "hsl(142 71% 62%)" : "hsl(196 25% 45%)",
      }}
      title="Copy to clipboard"
    >
      {copied ? "✓ COPIED" : label}
    </button>
  );
}

// ─── ManualChecklist ──────────────────────────────────────────────────────────

function ManualChecklist() {
  const ITEMS = [
    "GitHub repository pushed",
    "Production URL configured in Coolify",
    "Database URL connected and tested",
    "Custom domain pointed at production",
    "All env vars set in hosting platform",
    "Latest project snapshot downloaded",
  ];
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const toggle = (item: string) =>
    setChecked(prev => { const s = new Set(prev); s.has(item) ? s.delete(item) : s.add(item); return s; });

  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid hsl(210 15% 16%)" }}>
      <div className="px-4 py-2 text-[10px] font-bold tracking-widest" style={{ background: "hsl(210 15% 10%)", color: "hsl(196 30% 50%)" }}>
        MANUAL CHECKLIST
      </div>
      <div className="divide-y" style={{ borderColor: "hsl(210 15% 12%)" }}>
        {ITEMS.map(item => {
          const done = checked.has(item);
          return (
            <button
              key={item}
              onClick={() => toggle(item)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left transition-all hover:bg-white/5 active:scale-[0.99]"
            >
              <div
                className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 text-[10px] font-bold transition-all"
                style={{
                  background: done ? "hsl(142 60% 40% / 0.3)" : "transparent",
                  border:     `1.5px solid ${done ? "hsl(142 60% 50%)" : "hsl(210 15% 28%)"}`,
                  color:      "hsl(142 71% 62%)",
                }}
              >
                {done ? "✓" : ""}
              </div>
              <span
                className="text-xs"
                style={{
                  color:           done ? "hsl(142 71% 62%)" : "hsl(196 35% 60%)",
                  textDecoration:  done ? "line-through" : "none",
                }}
              >
                {item}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Dev workspace types ──────────────────────────────────────────────────────

interface DevMemoryEntry {
  id: string;
  category: "architecture"|"coding-rules"|"ui-conventions"|"known-bugs"|"file-map"|"deployment"|"general";
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}
interface DevDiagIssue {
  type: string;
  severity: "error"|"warning"|"info";
  likelyCause: string;
  suggestedFix: string;
  confidence: string;
  detail?: string;
}
interface DevDiagReport {
  ok: boolean;
  checkedAt: string;
  issueCount: number;
  errorCount: number;
  warnCount: number;
  issues: DevDiagIssue[];
  checks: Record<string, string>;
  runtimeInfo: { nodeVersion: string; pnpmVersion: string; platform: string; uptimeSeconds: number };
}
interface DevHealthResult {
  ok: boolean;
  score: number;
  label: "healthy"|"degraded"|"critical";
  frontend: { errorCount: number; errors: string[] };
  backend:  { errorCount: number; errors: string[] };
}

// ─── PatchCard ────────────────────────────────────────────────────────────────

/** Minimal positional line diff — enough for a readable +/- preview. */
function computeLineDiff(oldText: string, newText: string): Array<{ t: "add" | "del" | "ctx"; line: string }> {
  const ol = oldText.split("\n");
  const nl = newText.split("\n");
  const out: Array<{ t: "add" | "del" | "ctx"; line: string }> = [];
  const len = Math.max(ol.length, nl.length);
  for (let i = 0; i < len; i++) {
    if (ol[i] === nl[i]) { out.push({ t: "ctx", line: ol[i] ?? "" }); }
    else {
      if (ol[i] !== undefined) out.push({ t: "del", line: ol[i] });
      if (nl[i] !== undefined) out.push({ t: "add", line: nl[i] });
    }
  }
  return out;
}

function PatchCard({
  patch,
  onRemove,
  onAcceptedGoToBuild,
}: {
  patch: PendingPatchSummary;
  onRemove: (id: string) => void;
  onAcceptedGoToBuild?: () => void;
}) {
  const BASE = getApiBase();
  const [status,     setStatus]     = useState<"idle" | "applying" | "done" | "error">("idle");
  const [applyError, setApplyError] = useState<string | null>(null);
  const [validation, setValidation] = useState<{ passed: boolean; summary: string } | null>(null);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [showDiff,   setShowDiff]   = useState(false);
  const [rolling,    setRolling]    = useState(false);
  const [rollResult, setRollResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const RISK_COLOR: Record<string, string> = {
    low:    "hsl(142 71% 55%)",
    medium: "hsl(38 100% 65%)",
    high:   "hsl(355 80% 62%)",
  };

  const handleAccept = async () => {
    setStatus("applying");
    setApplyError(null);
    const result = await approvePatch(patch.patchId, patch.file);
    if (result.ok) {
      setStatus("done");
      setSnapshotId(result.snapshotId ?? null);
      setValidation(result.validation ?? null);
    } else {
      setStatus("error");
      setApplyError(result.error ?? "Apply failed");
    }
  };

  const handleDecline = async () => {
    await logRejectPatch(patch.patchId, patch.file);
    onRemove(patch.patchId);
  };

  const handleRollback = async () => {
    if (!snapshotId) return;
    setRolling(true);
    try {
      const res = await fetch(`${BASE}api/dev/snapshots/${snapshotId}/restore`, { method: "POST" });
      const data = await res.json() as { ok: boolean; error?: string; validation?: { passed: boolean; summary: string } };
      if (data.ok) {
        setRollResult({ ok: true, msg: data.validation?.passed ? "Rolled back — build passing." : "Rolled back — build still failing." });
        setValidation(data.validation ?? null);
      } else {
        setRollResult({ ok: false, msg: data.error ?? "Rollback failed" });
      }
    } catch (err) {
      setRollResult({ ok: false, msg: String(err) });
    } finally {
      setRolling(false);
    }
  };

  const hasDiff = !!(patch.oldContent !== undefined && patch.newContent !== undefined);
  const diffLines = hasDiff ? computeLineDiff(patch.oldContent!, patch.newContent!) : [];
  const MAX_DIFF = 60;
  const truncated = diffLines.length > MAX_DIFF;

  return (
    <div
      className="rounded-2xl border flex flex-col gap-3 p-4"
      style={{ background: "hsl(210 15% 7%)", borderColor: "hsl(210 15% 16%)" }}
    >
      {/* Header row */}
      <div className="flex items-start gap-2 flex-wrap">
        <p className="flex-1 text-sm font-semibold leading-snug min-w-0" style={{ color: "hsl(196 80% 85%)" }}>
          {patch.description}
        </p>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {patch.safeToTest && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "hsl(142 60% 14%)", color: "hsl(142 71% 60%)", border: "1px solid hsl(142 60% 24%)" }}>
              SAFE
            </span>
          )}
          {patch.riskLevel && (
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
              style={{ color: RISK_COLOR[patch.riskLevel] ?? "hsl(196 60% 60%)", borderColor: `${RISK_COLOR[patch.riskLevel] ?? "hsl(196 60% 60%)"}44` }}
            >
              {patch.riskLevel.toUpperCase()}
            </span>
          )}
        </div>
      </div>

      {/* File + diff toggle */}
      <div className="flex items-center gap-2">
        <Code2 className="w-3 h-3 flex-shrink-0" style={{ color: "hsl(196 40% 42%)" }} />
        <span className="text-xs font-mono truncate flex-1" style={{ color: "hsl(196 60% 58%)" }}>
          {patch.file}
        </span>
        {hasDiff && (
          <button
            onClick={() => setShowDiff(v => !v)}
            className="text-[10px] font-bold px-2 py-0.5 rounded-lg transition-all"
            style={{ background: showDiff ? "hsl(194 100% 55% / 0.15)" : "transparent", border: "1px solid hsl(194 100% 55% / 0.3)", color: "hsl(194 100% 65%)" }}
          >
            {showDiff ? "HIDE DIFF" : "VIEW DIFF"}
          </button>
        )}
      </div>

      {/* Diff preview */}
      {showDiff && hasDiff && (
        <div
          className="rounded-xl overflow-auto max-h-64 text-[11px] font-mono leading-5"
          style={{ background: "hsl(210 15% 4%)", border: "1px solid hsl(210 15% 12%)" }}
        >
          {(truncated ? diffLines.slice(0, MAX_DIFF) : diffLines).map((d, i) => (
            <div
              key={i}
              className="px-3 whitespace-pre"
              style={{
                background: d.t === "add" ? "hsl(142 60% 40% / 0.12)" : d.t === "del" ? "hsl(355 80% 40% / 0.12)" : "transparent",
                color:      d.t === "add" ? "hsl(142 71% 68%)"        : d.t === "del" ? "hsl(355 80% 68%)"        : "hsl(196 20% 42%)",
              }}
            >
              {d.t === "add" ? "+ " : d.t === "del" ? "- " : "  "}{d.line}
            </div>
          ))}
          {truncated && (
            <div className="px-3 py-1 text-center" style={{ color: "hsl(196 20% 34%)" }}>
              … {diffLines.length - MAX_DIFF} more lines
            </div>
          )}
        </div>
      )}

      {/* Impact notes */}
      {(patch.uiImpact || patch.logicImpact) && patch.uiImpact !== "unknown" && (
        <div className="text-xs space-y-0.5" style={{ color: "hsl(196 25% 50%)" }}>
          {patch.uiImpact    && patch.uiImpact    !== "unknown" && <div>UI: {patch.uiImpact}</div>}
          {patch.logicImpact && patch.logicImpact !== "unknown" && <div>Logic: {patch.logicImpact}</div>}
        </div>
      )}

      {/* Rollback note */}
      <div className="text-[10px]" style={{ color: "hsl(196 20% 30%)" }}>
        ↺ Snapshot saved on apply — rollback available if build fails
      </div>

      {/* Apply error */}
      {status === "error" && applyError && (
        <div className="text-xs rounded-xl px-3 py-2" style={{ background: "hsl(355 80% 14%)", color: "hsl(355 80% 68%)", border: "1px solid hsl(355 80% 28%)" }}>
          ✖ {applyError}
        </div>
      )}

      {/* Post-apply state */}
      {status === "done" && (
        <div className="flex flex-col gap-2">
          {/* Validation result */}
          {validation ? (
            <div
              className="text-xs rounded-xl px-3 py-2 flex items-center gap-2"
              style={validation.passed
                ? { background: "hsl(142 60% 11%)", color: "hsl(142 71% 62%)", border: "1px solid hsl(142 60% 22%)" }
                : { background: "hsl(38 100% 12%)",  color: "hsl(38 100% 68%)",  border: "1px solid hsl(38 100% 28%)" }
              }
            >
              <span>{validation.passed ? "✓" : "⚠"}</span>
              <span className="flex-1">{validation.passed ? "Applied — build passing" : `Applied — build failed: ${validation.summary}`}</span>
            </div>
          ) : (
            <div className="text-xs rounded-xl px-3 py-2" style={{ background: "hsl(142 60% 11%)", color: "hsl(142 71% 62%)", border: "1px solid hsl(142 60% 22%)" }}>
              ✓ Applied
            </div>
          )}

          {/* Rollback result */}
          {rollResult && (
            <div
              className="text-xs rounded-xl px-3 py-2"
              style={rollResult.ok
                ? { background: "hsl(194 60% 11%)", color: "hsl(194 100% 68%)", border: "1px solid hsl(194 60% 22%)" }
                : { background: "hsl(355 80% 14%)", color: "hsl(355 80% 68%)", border: "1px solid hsl(355 80% 28%)" }
              }
            >
              {rollResult.ok ? "↺ " : "✖ "}{rollResult.msg}
            </div>
          )}

          {/* Action row after apply */}
          <div className="flex gap-2">
            <button
              onClick={() => { onAcceptedGoToBuild?.(); }}
              className="flex-1 py-2 rounded-xl text-xs font-bold tracking-widest transition-all active:scale-95"
              style={{ background: "hsl(38 100% 55% / 0.12)", color: "hsl(38 100% 70%)", border: "1px solid hsl(38 100% 55% / 0.40)" }}
            >
              → BUILD/TEST
            </button>
            {snapshotId && !rollResult?.ok && (
              <button
                onClick={() => void handleRollback()}
                disabled={rolling}
                className="px-3 py-2 rounded-xl text-xs font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40"
                style={{ background: "hsl(355 80% 35% / 0.12)", color: "hsl(355 80% 64%)", border: "1px solid hsl(355 80% 38% / 0.5)" }}
              >
                {rolling ? "…" : "↺ ROLLBACK"}
              </button>
            )}
            <button
              onClick={() => onRemove(patch.patchId)}
              className="px-3 py-2 rounded-xl text-xs font-bold tracking-widest transition-all active:scale-95"
              style={{ background: "transparent", color: "hsl(196 20% 36%)", border: "1px solid hsl(210 15% 18%)" }}
            >
              DISMISS
            </button>
          </div>
        </div>
      )}

      {/* Action buttons — pre-apply */}
      {status !== "done" && (
        <div className="flex gap-2">
          <button
            onClick={() => void handleAccept()}
            disabled={status === "applying"}
            className="flex-1 py-2 rounded-xl text-xs font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40"
            style={{ background: "hsl(142 60% 35% / 0.18)", border: "1px solid hsl(142 60% 38%)", color: "hsl(142 71% 62%)" }}
          >
            {status === "applying" ? "APPLYING…" : "✓  ACCEPT"}
          </button>
          <button
            onClick={() => void handleDecline()}
            disabled={status === "applying"}
            className="flex-1 py-2 rounded-xl text-xs font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40"
            style={{ background: "hsl(355 80% 35% / 0.14)", border: "1px solid hsl(355 80% 38% / 0.6)", color: "hsl(355 80% 64%)" }}
          >
            ✗  DECLINE
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Chat() {
  const [, navigate] = useLocation();
  const [sessionId, setSessionId] = useState(() => getOrCreateSessionId());
  const [messages, setMessages] = useState<Message[]>([WELCOME()]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("idle");
  const [panelOpen, setPanelOpen] = useState(false);
  const [debugMode, setDebugModeState] = useState(() => getDebugMode());
  const [memory, setMemory] = useState<SessionMemory | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [activePlan, setActivePlan] = useState<FrontendPlan | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"chat" | "tasks" | "diag" | "status" | "debug" | "dev">("chat");
  const [autoPlannerEnabled, setAutoPlannerEnabled] = useState(() => getAutoPlannerEnabled());
  const [devPanelOpen, setDevPanelOpen] = useState(() => getDevPanelOpen());
  const [tasksPanelOpen,  setTasksPanelOpen]  = useState(false);
  const [diagPanelOpen,   setDiagPanelOpen]   = useState(false);
  const [statusPanelOpen, setStatusPanelOpen] = useState(false);
  const [logsPanelOpen,   setLogsPanelOpen]   = useState(false);
  const [actionsPanelOpen,      setActionsPanelOpen]      = useState(false);
  const [checkpointsPanelOpen,  setCheckpointsPanelOpen]  = useState(false);
  const [executionsPanelOpen,   setExecutionsPanelOpen]   = useState(false);
  const [autoLoopPanelOpen,     setAutoLoopPanelOpen]     = useState(false);
  const [plansPanelOpen,        setPlansPanelOpen]        = useState(false);
  const [priorityPanelOpen,     setPriorityPanelOpen]     = useState(false);
  const [workspacePanelOpen,    setWorkspacePanelOpen]    = useState(false);
  const [reasonPanelOpen,       setReasonPanelOpen]       = useState(false);
  const [agentsPanelOpen,       setAgentsPanelOpen]       = useState(false);
  const [collabPanelOpen,       setCollabPanelOpen]       = useState(false);
  const [workOrdersPanelOpen,   setWorkOrdersPanelOpen]   = useState(false);
  const [improvementPanelOpen,  setImprovementPanelOpen]  = useState(false);
  const autoRoutedRef = useRef(false);

  // ── Patch notification bar + server status ───────────────────────────────
  const [pendingPatches,    setPendingPatches]    = useState<PendingPatchSummary[]>([]);
  const [approvingPatchId,  setApprovingPatchId]  = useState<string | null>(null);
  const [patchBarError,     setPatchBarError]     = useState<string | null>(null);
  const [dismissedIds,      setDismissedIds]      = useState<Set<string>>(new Set());
  const [serverStatus,      setServerStatus]      = useState<ServerStatus | null>(null);
  // Track the last server startedAt we saw so we can detect a restart
  const lastServerStartRef = useRef<number | null>(null);

  // ── Dev workspace ────────────────────────────────────────────────────────
  const [devMessages,  setDevMessages]  = useState<Array<{id: string; role: "user"|"assistant"; content: string}>>([]);
  const [devInput,     setDevInput]     = useState("");
  const [devSending,   setDevSending]   = useState(false);
  const devSendingRef  = useRef(false);  // guard ref — avoids stale-closure bug in sendDevMessage
  const [devSection,   setDevSection]   = useState<"chat"|"patches"|"build"|"diag"|"logs"|"checklist">("chat");
  const devChatEndRef = useRef<HTMLDivElement>(null);

  const [devProjectMemory, setDevProjectMemory] = useState<DevMemoryEntry[]>([]);
  const [devMemoryOpen,    setDevMemoryOpen]    = useState(false);
  const [devDiagReport,    setDevDiagReport]    = useState<DevDiagReport | null>(null);
  const [devDiagLoading,   setDevDiagLoading]   = useState(false);
  const [devBuildResult,   setDevBuildResult]   = useState<DevHealthResult | null>(null);
  const [devBuildLoading,  setDevBuildLoading]  = useState(false);
  const [devLogs,          setDevLogs]          = useState<string[]>([]);
  const [devLogsLoading,   setDevLogsLoading]   = useState(false);
  const [actionStatus,     setActionStatus]     = useState<Record<string, "idle"|"loading"|"success"|"error">>({});
  const [toolsMenuOpen,    setToolsMenuOpen]    = useState(false);
  const toolsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(DEV_PANEL_KEY, String(devPanelOpen));
  }, [devPanelOpen]);

  // Poll server status every 30 s to detect restarts and recover patch records.
  // Disabled in production — only runs when DEV_TOOLS_ENABLED.
  useEffect(() => {
    if (!DEV_TOOLS_ENABLED) return;
    const pollStatus = async () => {
      const status = await fetchServerStatus();
      if (!status) return;
      setServerStatus(status);
      // Detect a restart: if startedAt changed since last check, the server came back
      if (lastServerStartRef.current !== null && lastServerStartRef.current !== status.startedAt) {
        console.log("[Jarvis] Server restart detected — new startedAt:", status.startedAt);
        // Refresh patches so the bar reflects the recovered queue
        const patches = await fetchPendingPatches();
        setPendingPatches(patches);
      }
      lastServerStartRef.current = status.startedAt;
    };
    pollStatus();
    const id = setInterval(pollStatus, 30_000);
    return () => clearInterval(id);
  }, []);

  // Poll for pending patches every 15 s so the bar stays in sync without
  // requiring the DEV panel to be open.
  // Disabled in production — only runs when DEV_TOOLS_ENABLED.
  useEffect(() => {
    if (!DEV_TOOLS_ENABLED) return;
    const poll = async () => {
      const patches = await fetchPendingPatches();
      setPendingPatches(patches);
    };
    poll();
    const id = setInterval(poll, 15_000);
    return () => clearInterval(id);
  }, []);

  const handleApprovePatch = useCallback(async (patch: PendingPatchSummary) => {
    setApprovingPatchId(patch.patchId);
    setPatchBarError(null);
    const result = await approvePatch(patch.patchId, patch.file);
    setApprovingPatchId(null);
    if (result.ok) {
      setPendingPatches(prev => prev.filter(p => p.patchId !== patch.patchId));
    } else {
      setPatchBarError(result.error ?? "Apply failed");
    }
  }, []);

  const handleRejectPatch = useCallback((patch: PendingPatchSummary) => {
    void logRejectPatch(patch.patchId, patch.file);
    setDismissedIds(prev => new Set([...prev, patch.patchId]));
    setPendingPatches(prev => prev.filter(p => p.patchId !== patch.patchId));
  }, []);

  // ── Dev chat scroll ───────────────────────────────────────────────────────
  useEffect(() => {
    devChatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [devMessages]);

  // ── Dev workspace send ────────────────────────────────────────────────────
  const sendDevMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    console.log("[DEV CHAT] sendDevMessage called", { len: trimmed.length, busy: devSendingRef.current });
    if (!trimmed || devSendingRef.current) {
      console.warn("[DEV CHAT] guard blocked — empty or already sending", { trimmed: !!trimmed, busy: devSendingRef.current });
      return;
    }
    setDevMessages(prev => [...prev, { id: `du-${Date.now()}`, role: "user", content: trimmed }]);
    setDevInput("");
    setDevSending(true); devSendingRef.current = true;
    setDevSection("chat");
    const assistantId = `da-${Date.now()}`;
    setDevMessages(prev => [...prev, { id: assistantId, role: "assistant", content: "" }]);
    console.log("[DEV CHAT] POSTing to /api/dev/stream");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90_000);

    try {
      const res = await fetch(`${BASE}api/dev/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
        signal: controller.signal,
      });
      console.log("[DEV CHAT] response", { status: res.status, ok: res.ok, hasBody: !!res.body });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let tokens = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) { console.log("[DEV CHAT] stream done, tokens:", tokens); break; }
        const lines = (buf + decoder.decode(value, { stream: true })).split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === "[DONE]") continue;
          try {
            const evt = JSON.parse(raw) as {
              type: string; text?: string; response?: string; error?: string;
              patchId?: string; file?: string; description?: string;
              riskLevel?: "low" | "medium" | "high";
              uiImpact?: string; logicImpact?: string;
              safeToTest?: boolean; testCommand?: string;
              oldContent?: string; newContent?: string;
            };

            if (evt.type === "dev:token" && evt.text) {
              tokens++;
              setDevMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, content: m.content + evt.text! } : m));

            } else if (evt.type === "dev:done" && evt.response) {
              // If tokens were streamed already, response is a duplicate — skip to avoid double text.
              // If nothing was streamed yet, use the full response as the message.
              setDevMessages(prev => prev.map(m =>
                m.id === assistantId && !m.content ? { ...m, content: evt.response! } : m));

            } else if (evt.type === "dev:patch_proposed" && evt.patchId) {
              console.log("[DEV CHAT] patch proposed:", evt.patchId, evt.file);
              const newPatch: PendingPatchSummary = {
                patchId:     evt.patchId,
                file:        evt.file ?? "",
                description: evt.description ?? "Code change proposed by Jarvis DEV",
                riskLevel:   evt.riskLevel,
                uiImpact:    evt.uiImpact,
                logicImpact: evt.logicImpact,
                safeToTest:  evt.safeToTest,
                testCommand: evt.testCommand,
                oldContent:  evt.oldContent,
                newContent:  evt.newContent,
                createdAt:   Date.now(),
              };
              setPendingPatches(prev =>
                prev.some(p => p.patchId === evt.patchId) ? prev : [...prev, newPatch]);
              setDevMessages(prev => prev.map(m =>
                m.id === assistantId
                  ? { ...m, content: m.content + `\n\n📋 Patch ready in the PATCHES tab → ${evt.file}` }
                  : m));

            } else if (evt.type === "dev:error" && evt.error) {
              console.error("[DEV CHAT] dev:error:", evt.error);
              setDevMessages(prev => prev.map(m =>
                m.id === assistantId && !m.content
                  ? { ...m, content: `⚠ ${evt.error}` } : m));
            }
          } catch { /* malformed SSE line — skip */ }
        }
      }
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "AbortError";
      const msg = isTimeout
        ? "⚠ Request timed out after 90 s. Try a shorter or more specific request."
        : `⚠ ${err instanceof Error ? err.message : String(err)}`;
      console.error("[DEV CHAT] error:", err);
      setDevMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, content: m.content || msg } : m));
    } finally {
      clearTimeout(timeoutId);
      console.log("[DEV CHAT] finally: clearing devSending");
      setDevSending(false); devSendingRef.current = false;
    }
  }, [BASE]); // stable — guard uses devSendingRef; setPendingPatches/setDevMessages are stable setState fns

  // ── Dev workspace helpers ─────────────────────────────────────────────────
  const loadDevProjectMemory = useCallback(async () => {
    try {
      const res  = await fetch(`${BASE}api/dev/project-memory`);
      const data = await res.json() as { ok: boolean; entries?: DevMemoryEntry[] };
      if (data.ok && data.entries) setDevProjectMemory(data.entries);
    } catch { /* ignore */ }
  }, [BASE]);

  const runDevDiag = useCallback(async () => {
    setDevDiagLoading(true);
    try {
      const res = await fetch(`${BASE}api/system/diagnostics`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json() as Partial<DevDiagReport>;
      setDevDiagReport({
        ok:          raw.ok          ?? true,
        checkedAt:   raw.checkedAt   ?? new Date().toISOString(),
        issueCount:  raw.issueCount  ?? 0,
        errorCount:  raw.errorCount  ?? 0,
        warnCount:   raw.warnCount   ?? 0,
        issues:      raw.issues      ?? [],
        checks:      raw.checks      ?? {},
        runtimeInfo: raw.runtimeInfo ?? { nodeVersion: "unknown", pnpmVersion: "unknown", platform: "unknown", uptimeSeconds: 0 },
      });
    } catch (err) {
      setDevDiagReport({
        ok: false, checkedAt: new Date().toISOString(),
        issueCount: 1, errorCount: 1, warnCount: 0,
        issues: [{ type: "build_artifact_missing", severity: "error",
          likelyCause: `Could not reach diagnostics API: ${err instanceof Error ? err.message : "Unknown"}`,
          suggestedFix: "Check the API server is running.", confidence: "low" }],
        checks: {}, runtimeInfo: { nodeVersion: "—", pnpmVersion: "—", platform: "—", uptimeSeconds: 0 },
      });
    } finally { setDevDiagLoading(false); }
  }, [BASE]);

  const runDevBuild = useCallback(async (force = false) => {
    setDevBuildLoading(true);
    try {
      const url = force ? `${BASE}api/dev/health?refresh=1` : `${BASE}api/dev/health`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json() as Partial<DevHealthResult>;
      setDevBuildResult({
        ok:       raw.ok    ?? false,
        score:    typeof raw.score === "number" ? raw.score : 0,
        label:    raw.label ?? "critical",
        frontend: { errorCount: raw.frontend?.errorCount ?? 0, errors: raw.frontend?.errors ?? [] },
        backend:  { errorCount: raw.backend?.errorCount  ?? 0, errors: raw.backend?.errors  ?? [] },
      });
    } catch (err) {
      setDevBuildResult({
        ok: false, score: 0, label: "critical",
        frontend: { errorCount: 1, errors: [`API error: ${err instanceof Error ? err.message : "Unknown"}`] },
        backend:  { errorCount: 0, errors: [] },
      });
    } finally { setDevBuildLoading(false); }
  }, [BASE]);

  const loadDevLogs = useCallback(async () => {
    setDevLogsLoading(true);
    try {
      const res = await fetch(`${BASE}api/dev/logs`);
      if (!res.ok) {
        setDevLogs([`[UNAVAILABLE] Server returned HTTP ${res.status}. Check your hosting platform for deployment logs.`]);
        return;
      }
      const data = await res.json() as { ok: boolean; lines?: string[]; note?: string; source?: string };
      if (!data.ok || !data.lines?.length) {
        setDevLogs([data.note ? `[INFO] ${data.note}` : "[INFO] No log lines available from this environment."]);
        return;
      }
      const lines = data.note ? [`[INFO] ${data.note}`, ...data.lines] : data.lines;
      setDevLogs(lines);
    } catch {
      setDevLogs(["[UNAVAILABLE] Could not reach the logs API. Check your hosting platform for deployment logs."]);
    } finally { setDevLogsLoading(false); }
  }, [BASE]);

  const runAllChecks = useCallback(async () => {
    await Promise.all([
      runDevBuild(true),
      runDevDiag(),
      loadDevLogs(),
      loadDevProjectMemory(),
      fetchPendingPatches().then(setPendingPatches).catch(() => {}),
    ]);
  }, [runDevBuild, runDevDiag, loadDevLogs, loadDevProjectMemory]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportSnapshot = useCallback(async () => {
    const snapshot = {
      timestamp:      new Date().toISOString(),
      projectMemory:  devProjectMemory,
      diagnostics:    devDiagReport,
      buildResult:    devBuildResult,
      pendingPatches,
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `jarvis-snapshot-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [devProjectMemory, devDiagReport, devBuildResult, pendingPatches]);

  const withActionFeedback = useCallback(async (key: string, fn: () => Promise<void>) => {
    setActionStatus(s => ({ ...s, [key]: "loading" }));
    try {
      await fn();
      setActionStatus(s => ({ ...s, [key]: "success" }));
    } catch {
      setActionStatus(s => ({ ...s, [key]: "error" }));
    }
    setTimeout(() => setActionStatus(s => ({ ...s, [key]: "idle" })), 2000);
  }, []);

  useEffect(() => {
    if (!toolsMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target as Node)) {
        setToolsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [toolsMenuOpen]);

  // Auto-load project memory the first time the DEV tab is opened
  useEffect(() => {
    if (activeTab !== "dev") return;
    if (devProjectMemory.length === 0) void loadDevProjectMemory();
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Voice ────────────────────────────────────────────────────────────────
  const speechInput = useSpeechInput();
  const speech = useSpeechSession();
  // Base text in input box before voice recording started (so interim results
  // replace correctly and don't duplicate already-typed text)
  const micBaseTextRef = useRef<string>("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Token batching — flush to state at most every 25 ms to avoid over-rendering
  const tokenBufferRef = useRef<string>("");
  const tokenFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const responseContentRef = useRef<string>("");

  const scrollToBottom = useCallback((instant = false) => {
    messagesEndRef.current?.scrollIntoView({ behavior: instant ? "auto" : "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  // Flush the token buffer into the named message and scroll
  const flushTokenBuffer = useCallback((msgId: string, final = false) => {
    if (tokenFlushTimerRef.current) {
      clearTimeout(tokenFlushTimerRef.current);
      tokenFlushTimerRef.current = null;
    }
    const buffered = tokenBufferRef.current;
    tokenBufferRef.current = "";
    if (buffered) {
      setMessages((prev) =>
        prev.map((m) => m.id === msgId ? { ...m, content: m.content + buffered } : m)
      );
    }
    if (final) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    else messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, []);

  // Load session on mount / session change
  useEffect(() => {
    let cancelled = false;
    setIsLoadingHistory(true);

    loadSession(sessionId, BASE)
      .then((session) => {
        if (cancelled) return;
        _rt.bus.emit({ type: "memory:loaded", sessionId, messageCount: session.messages.length, ts: Date.now() });
        setMemory(session);
        if (session.messages.length > 0) {
          const restored: Message[] = session.messages.map((m, i) => ({
            id: `restored-${i}`,
            role: m.role as "user" | "assistant",
            content: m.content,
            timestamp: new Date(m.timestamp),
          }));
          setMessages([WELCOME(session.preferences?.name), ...restored]);
        } else {
          setMessages([WELCOME(session.preferences?.name)]);
        }
      })
      .catch(() => {
        if (!cancelled) {
          _rt.bus.emit({ type: "memory:error", error: "Failed to load session", ts: Date.now() });
          setMessages([WELCOME()]);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // ── On-screen debug log interceptor (temporary — iPhone Safari has no DevTools) ──
  useEffect(() => {
    const PREFIX = /\[(CSP|Chat)\]/;
    const MAX = 60;
    const orig = { log: console.log, warn: console.warn, error: console.error };

    function capture(level: string, args: unknown[]) {
      try {
        const msg = args.map(a => {
          try { return typeof a === "object" ? JSON.stringify(a) : String(a); }
          catch { return "[unserializable]"; }
        }).join(" ");
        if (!PREFIX.test(msg)) return;
        const ts = new Date().toISOString().slice(11, 23);
        const tag = level === "log" ? "" : level === "warn" ? "⚠ " : "✖ ";
        setDebugLogs(prev => [...prev.slice(-(MAX - 1)), `${ts} ${tag}${msg}`]);
      } catch { /* never let interceptor crash calling code */ }
    }

    console.log  = (...a) => { orig.log(...a);   capture("log",   a); };
    console.warn  = (...a) => { orig.warn(...a);  capture("warn",  a); };
    console.error = (...a) => { orig.error(...a); capture("error", a); };

    return () => {
      console.log   = orig.log;
      console.warn  = orig.warn;
      console.error = orig.error;
    };
  }, []);

  const toggleDebug = useCallback(() => {
    setDebugModeState((v) => {
      const next = !v;
      setDebugMode(next);
      return next;
    });
  }, []);

  // ── Mic toggle ─────────────────────────────────────────────────────────────
  const toggleMic = useCallback(() => {
    speech.unlock();
    if (speechInput.isListening) {
      speechInput.stop();
      return;
    }
    // Snapshot text already in the box before we start appending voice
    micBaseTextRef.current = input;

    speechInput.start({
      onInterim: (text) => {
        // Show live preview: base + interim (doesn't commit yet)
        setInput(micBaseTextRef.current + (micBaseTextRef.current ? " " : "") + text);
      },
      onFinal: (text) => {
        // Commit the final word(s): advance the base so next interim is relative
        const prefix = micBaseTextRef.current
          ? micBaseTextRef.current + " "
          : "";
        const committed = prefix + text;
        micBaseTextRef.current = committed;
        setInput(committed);
        // auto-resize textarea
        requestAnimationFrame(() => {
          const ta = textareaRef.current;
          if (ta) { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight}px`; }
        });
      },
      onDenied: () => {
        // permission denied — nothing extra needed; isListening already false
      },
    });
  }, [speechInput, input]);

  const sendMessage = useCallback(async () => {
    console.log("[Chat] sendMessage entered — input:", JSON.stringify(input.trim()), "isTyping:", isTyping, "isStreaming:", isStreaming);
    // step 1
    const text = input.trim();
    console.log("[Chat] step 1: text extracted =", JSON.stringify(text));
    if (!text || isTyping || isStreaming) {
      console.warn("[Chat] sendMessage blocked — isTyping:", isTyping, "isStreaming:", isStreaming, "text empty:", !text);
      return;
    }
    console.log("[Chat] step 2: guard passed");

    // Auto-route to planner if enabled and intent is high-confidence multi-step
    if (autoPlannerEnabled) {
      const intent = detectPlannerIntent(text);
      console.log("[Chat] planner intent check:", intent);
      if (intent.shouldRoute) {
        console.log("[Chat] auto-routing to planner — confidence:", intent.confidence, "reason:", intent.reason);
        autoRoutedRef.current = true;
        sendPlan();
        return;
      }
    }
    console.log("[Chat] step 3: planner check done, autoPlannerEnabled:", autoPlannerEnabled);

    try { speech.unlock(); } catch(e) { console.warn("[Chat] step 4 THREW: speech.unlock():", e); }
    console.log("[Chat] step 4: speech.unlock() done");

    responseContentRef.current = "";
    console.log("[Chat] step 5: refs reset");

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date(),
    };
    console.log("[Chat] step 6: userMsg created, id:", userMsg.id);

    setMessages((prev) => [...prev, userMsg]);
    console.log("[Chat] step 7: setMessages done");

    setInput("");
    console.log("[Chat] step 8: setInput done");

    setIsTyping(true);
    console.log("[Chat] step 9: setIsTyping(true) done");

    try { setAgentStatus(inferStatus(text)); } catch(e) { console.warn("[Chat] step 10 THREW: setAgentStatus:", e); }
    console.log("[Chat] step 10: setAgentStatus done");

    if (textareaRef.current) textareaRef.current.style.height = "auto";
    console.log("[Chat] step 11: textarea reset done");

    setMemory((prev) =>
      prev ? { ...prev, messageCount: prev.messageCount + 1 } : prev,
    );
    console.log("[Chat] step 12: setMemory done");

    const msgId = `assistant-${Date.now()}`;
    let messageCreated = false;
    const currentMsgId = msgId;
    console.log("[Chat] step 13: msgId =", currentMsgId);

    // ── Single try/catch wraps EVERYTHING after step 13 ──────────────────────
    // The catch writes directly to setDebugLogs (bypasses console interceptor)
    // and clears isTyping/isStreaming so the UI never gets permanently stuck.
    try {
      console.log("[Chat] step 14: inside try — setting up");

      const pendingToolCalls = new Map<string, ToolCallInfo>();
      console.log("[Chat] step 15: pendingToolCalls ok");

      const streamStartTime = Date.now();
      console.log("[Chat] step 16: streamStartTime ok");

      // _rt.bus.emit({ type: "stream:start", sessionId, ts: Date.now() });
      // ↑ removed — suspected throw source; not required for chat to function
      console.log("[Chat] step 17: skipped bus.emit");

      const handleError = (reason?: string) => {
        const label = reason ?? "Request failed — please try again.";
        console.error("[Chat] handleError:", label);
        try { _rt.bus.emit({ type: "stream:error", error: label, ts: Date.now() }); } catch { /* ignore */ }
        if (messageCreated) {
          setIsStreaming(false);
          setStreamingMsgId(null);
          try { flushTokenBuffer(currentMsgId, true); } catch { /* ignore */ }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === currentMsgId
                ? { ...m, content: m.content.trim() || `⚠️ ${label}` }
                : m
            )
          );
        } else {
          setIsTyping(false);
          setMessages((prev) => [
            ...prev,
            { id: currentMsgId, role: "assistant", content: `⚠️ ${label}`, timestamp: new Date() },
          ]);
        }
        setAgentStatus("error");
        setTimeout(() => setAgentStatus("idle"), 2500);
      };

      function ensureMessageCreated(initialContent = "") {
        if (messageCreated) return;
        messageCreated = true;
        console.log("[Chat] ensureMessageCreated — setIsTyping(false) setIsStreaming(true)");
        setIsTyping(false);
        setAgentStatus("idle");
        setIsStreaming(true);
        setStreamingMsgId(currentMsgId);
        setMessages((prev) => [
          ...prev,
          {
            id: currentMsgId,
            role: "assistant" as const,
            content: initialContent,
            timestamp: new Date(),
            toolCalls: Array.from(pendingToolCalls.values()),
          },
        ]);
        messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
      }

      console.log("[Chat] step 18: calling callChatStream — BASE:", BASE, "sessionId:", sessionId);
      await callChatStream(
      text,
      sessionId,
      BASE,
      // onToken
      (tokenText) => {
        const isFirst = !messageCreated;
        console.log("[Chat] onToken fired — isFirst:", isFirst, "messageCreated:", messageCreated, "text:", JSON.stringify(tokenText.slice(0, 30)));
        responseContentRef.current += tokenText;
        if (!messageCreated) {
          ensureMessageCreated(tokenText);
          return;
        }
        tokenBufferRef.current += tokenText;
        if (!tokenFlushTimerRef.current) {
          tokenFlushTimerRef.current = setTimeout(() => {
            tokenFlushTimerRef.current = null;
            flushTokenBuffer(currentMsgId);
          }, 25);
        }
      },
      // onDone
      (data) => {
        console.log("[Chat] onDone fired — messageCreated:", messageCreated, "responseContent length:", responseContentRef.current.length);
        flushTokenBuffer(currentMsgId, true);
        _rt.bus.emit({ type: "stream:done", sessionId, durationMs: Date.now() - streamStartTime, tokens: responseContentRef.current.length, ts: Date.now() });
        console.log("[Chat] onDone: calling setIsStreaming(false)");
        setIsStreaming(false);
        setStreamingMsgId(null);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === currentMsgId
              ? { ...m, sources: data.sources, isSearch: data.isSearch, isFakeSearch: data.isFakeSearch, debug: data.debug }
              : m
          )
        );
        setMemory((prev) =>
          prev ? { ...prev, messageCount: prev.messageCount + 1 } : prev,
        );
        if (data.debug?.action === "preference_update") {
          loadSession(sessionId, BASE).then(setMemory).catch(() => {});
        }
        if (speech.autoSpeak) {
          speech.queue(currentMsgId, responseContentRef.current);
        }
        responseContentRef.current = "";
      },
      // onError
      handleError,
      // onToolEvent
      (toolEvent) => {
        if (toolEvent.type === "tool_start") {
          _rt.bus.emit({ type: "tool:start", tool: toolEvent.tool, label: toolEvent.label, ts: Date.now() });
          const call: ToolCallInfo = {
            id: toolEvent.toolCallId,
            tool: toolEvent.tool,
            label: toolEvent.label,
            status: "running",
          };
          pendingToolCalls.set(toolEvent.toolCallId, call);

          // Update agent status bar label
          setAgentStatus(toolEvent.tool === "search_web" ? "researching" : "processing");

          // Create message early so tool chips are visible immediately
          if (!messageCreated) {
            ensureMessageCreated();
          } else {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === currentMsgId
                  ? { ...m, toolCalls: Array.from(pendingToolCalls.values()) }
                  : m
              )
            );
          }
        } else if (toolEvent.type === "tool_done") {
          _rt.bus.emit({ type: "tool:done", tool: toolEvent.tool, durationMs: toolEvent.durationMs, ts: Date.now() });
          const existing = pendingToolCalls.get(toolEvent.toolCallId);
          if (existing) {
            pendingToolCalls.set(toolEvent.toolCallId, {
              ...existing,
              status: "done",
              durationMs: toolEvent.durationMs,
              result: toolEvent.result,
              label: existing.label.replace(/\.\.\.$/, "").replace(/ing$/, "ed").replace(/Checking/, "Checked").replace(/Searching/, "Searched").replace(/Calculating/, "Calculated").replace(/Saving/, "Saved").replace(/Loading/, "Loaded").replace(/Running/, "Ran"),
            });
          }
          setAgentStatus("idle");

          // ── Detect propose_code_change → attach patchProposal to message ───
          if (toolEvent.tool === "propose_code_change" && toolEvent.result) {
            try {
              const parsed = toolEvent.result as {
                patchId?: string; file?: string; description?: string;
                riskLevel?: "low" | "medium" | "high";
                newContent?: string; oldContent?: string;
              };
              if (parsed.patchId) {
                console.log("[Jarvis] pending patches loaded — patchId:", parsed.patchId, "file:", parsed.file);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === currentMsgId
                      ? {
                          ...m,
                          toolCalls: Array.from(pendingToolCalls.values()),
                          patchProposal: {
                            patchId:     parsed.patchId!,
                            file:        parsed.file ?? "",
                            description: parsed.description ?? "Code change",
                            riskLevel:   parsed.riskLevel,
                            // Store content so ChatPatchProposal can resubmit
                            // if the server loses the patch after a restart
                            newContent:  parsed.newContent,
                            oldContent:  parsed.oldContent,
                          },
                        }
                      : m
                  )
                );
                // Immediately refresh the notification bar
                fetchPendingPatches().then(patches => {
                  console.log("[Jarvis] pending patches loaded — count:", patches.length);
                  setPendingPatches(patches);
                });
                return;
              }
            } catch { /* ignore */ }
          }

          setMessages((prev) =>
            prev.map((m) =>
              m.id === currentMsgId
                ? { ...m, toolCalls: Array.from(pendingToolCalls.values()) }
                : m
            )
          );
        } else if (toolEvent.type === "tool_error") {
          _rt.bus.emit({ type: "tool:error", tool: toolEvent.tool, error: toolEvent.error ?? "unknown", ts: Date.now() });
          const existing = pendingToolCalls.get(toolEvent.toolCallId);
          if (existing) {
            pendingToolCalls.set(toolEvent.toolCallId, {
              ...existing,
              status: "error",
              durationMs: toolEvent.durationMs,
              error: toolEvent.error,
            });
          }
          setAgentStatus("idle");
          setMessages((prev) =>
            prev.map((m) =>
              m.id === currentMsgId
                ? { ...m, toolCalls: Array.from(pendingToolCalls.values()) }
                : m
            )
          );
        }
      },
    );
    } catch (outerErr) {
      // FIRST: write directly to setDebugLogs — no console interceptor, no _rt.bus
      const detail = outerErr instanceof Error ? outerErr.message : String(outerErr);
      const ts = new Date().toISOString().slice(11, 23);
      setDebugLogs(prev => [...prev, `${ts} ✖ CAUGHT after step 13: ${detail}`]);
      // Clear stuck state immediately
      setIsTyping(false);
      setIsStreaming(false);
      // Show error bubble in chat
      setMessages(prev => [
        ...prev,
        { id: currentMsgId, role: "assistant" as const, content: `⚠️ Error: ${detail}`, timestamp: new Date() },
      ]);
      setAgentStatus("error");
      setTimeout(() => setAgentStatus("idle"), 2500);
    } finally {
      // Absolute safety net — direct setDebugLogs, no console
      setIsTyping(v => {
        if (v) setDebugLogs(p => [...p, `${new Date().toISOString().slice(11,23)} ⚠ finally: clearing stuck isTyping`]);
        return false;
      });
      setIsStreaming(v => {
        if (v) setDebugLogs(p => [...p, `${new Date().toISOString().slice(11,23)} ⚠ finally: clearing stuck isStreaming`]);
        return false;
      });
    }
  }, [input, isTyping, isStreaming, sessionId, flushTokenBuffer, autoPlannerEnabled]);

  // ── Plan execution ──────────────────────────────────────────────────────────

  const sendPlan = useCallback(async () => {
    const goal = input.trim();
    console.log("[Planner] sendPlan entered — goal:", JSON.stringify(goal), "isTyping:", isTyping, "isStreaming:", isStreaming);
    if (!goal || isTyping || isStreaming) return;
    console.log("[Planner] calling callPlanStream →", `${BASE}api/plan/stream`);

    speech.unlock();
    responseContentRef.current = "";
    setInput("");

    const isAutoRouted = autoRoutedRef.current;
    autoRoutedRef.current = false;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: isAutoRouted ? goal : `⚡ Plan: ${goal}`,
      timestamp: new Date(),
      autoRouted: isAutoRouted,
    };
    // Immediate visible confirmation message so user sees the planner path is active
    const confirmMsg: Message = {
      id: `planner-confirm-${Date.now()}`,
      role: "assistant",
      content: "⚡ Planner started — breaking your goal into steps…",
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg, confirmMsg]);
    setIsTyping(true);
    setAgentStatus("thinking");
    scrollToBottom(false);

    const planMsgId = `plan-${Date.now()}`;
    const pendingToolCalls = new Map<string, ToolCallInfo>();
    let currentPlan: FrontendPlan | null = null;
    let planMessageCreated = false;

    const ensurePlanMessage = (plan: FrontendPlan) => {
      if (planMessageCreated) return;
      planMessageCreated = true;
      setIsTyping(false);
      setIsStreaming(true);
      setStreamingMsgId(planMsgId);
      setMessages((prev) => [
        ...prev,
        { id: planMsgId, role: "assistant", content: "", timestamp: new Date(), plan },
      ]);
    };

    const updatePlan = (updated: FrontendPlan) => {
      currentPlan = updated;
      setActivePlan({ ...updated });
      setMessages((prev) =>
        prev.map((m) => m.id === planMsgId ? { ...m, plan: { ...updated } } : m),
      );
      savePlan(sessionId, updated);
    };

    const streamStartTime = Date.now();
    _rt.bus.emit({ type: "stream:start", sessionId, ts: Date.now() });

    await callPlanStream(goal, sessionId, BASE, {
      onPlanCreated: (payload) => {
        const plan: FrontendPlan = {
          id: payload.id,
          title: payload.title,
          goal: payload.goal,
          steps: payload.steps,
          status: "running",
          createdAt: payload.createdAt,
        };
        currentPlan = plan;
        ensurePlanMessage(plan);
        updatePlan(plan);
        _rt.bus.emit({ type: "plan:created", planId: plan.id, title: plan.title, stepCount: plan.steps.length, ts: Date.now() });
      },

      onStepStart: (payload) => {
        if (!currentPlan) return;
        const updated: FrontendPlan = {
          ...currentPlan,
          steps: currentPlan.steps.map((s) =>
            s.id === payload.stepId ? { ...s, status: "running" as const } : s,
          ),
        };
        tokenBufferRef.current += `\n\n### Step ${payload.stepIndex + 1}: ${payload.title}\n\n`;
        flushTokenBuffer(planMsgId);
        updatePlan(updated);
        _rt.bus.emit({ type: "plan:step:start", planId: payload.planId, stepId: payload.stepId, stepIndex: payload.stepIndex, ts: Date.now() });
      },

      onToken: (text) => {
        responseContentRef.current += text;
        tokenBufferRef.current += text;
        if (!tokenFlushTimerRef.current) {
          tokenFlushTimerRef.current = setTimeout(() => {
            tokenFlushTimerRef.current = null;
            flushTokenBuffer(planMsgId);
          }, 25);
        }
      },

      onToolEvent: (toolEvent: PlanToolEvent) => {
        if (toolEvent.type === "tool_start") {
          _rt.bus.emit({ type: "tool:start", tool: toolEvent.tool, label: toolEvent.label, ts: Date.now() });
          const call: ToolCallInfo = { id: toolEvent.toolCallId, tool: toolEvent.tool, label: toolEvent.label, status: "running" };
          pendingToolCalls.set(toolEvent.toolCallId, call);
          setAgentStatus(toolEvent.tool === "search_web" ? "researching" : "processing");
          setMessages((prev) =>
            prev.map((m) => m.id === planMsgId ? { ...m, toolCalls: Array.from(pendingToolCalls.values()) } : m),
          );
        } else if (toolEvent.type === "tool_done") {
          _rt.bus.emit({ type: "tool:done", tool: toolEvent.tool, durationMs: toolEvent.durationMs, ts: Date.now() });
          const existing = pendingToolCalls.get(toolEvent.toolCallId);
          if (existing) pendingToolCalls.set(toolEvent.toolCallId, { ...existing, status: "done", durationMs: toolEvent.durationMs });
          setAgentStatus("idle");
          setMessages((prev) =>
            prev.map((m) => m.id === planMsgId ? { ...m, toolCalls: Array.from(pendingToolCalls.values()) } : m),
          );
        } else if (toolEvent.type === "tool_error") {
          _rt.bus.emit({ type: "tool:error", tool: toolEvent.tool, error: toolEvent.error, ts: Date.now() });
          const existing = pendingToolCalls.get(toolEvent.toolCallId);
          if (existing) pendingToolCalls.set(toolEvent.toolCallId, { ...existing, status: "error", durationMs: toolEvent.durationMs, error: toolEvent.error });
          setAgentStatus("idle");
          setMessages((prev) =>
            prev.map((m) => m.id === planMsgId ? { ...m, toolCalls: Array.from(pendingToolCalls.values()) } : m),
          );
        }
      },

      onStepComplete: (payload) => {
        if (!currentPlan) return;
        const updated: FrontendPlan = {
          ...currentPlan,
          steps: currentPlan.steps.map((s) =>
            s.id === payload.stepId
              ? { ...s, status: "complete" as const, durationMs: payload.durationMs, result: payload.summary }
              : s,
          ),
        };
        updatePlan(updated);
        _rt.bus.emit({ type: "plan:step:complete", planId: payload.planId, stepId: payload.stepId, stepIndex: payload.stepIndex, ts: Date.now() });
      },

      onStepFailed: (payload) => {
        if (!currentPlan) return;
        const updated: FrontendPlan = {
          ...currentPlan,
          steps: currentPlan.steps.map((s) =>
            s.id === payload.stepId
              ? { ...s, status: payload.willRetry ? ("running" as const) : ("failed" as const), error: payload.error }
              : s,
          ),
        };
        updatePlan(updated);
        _rt.bus.emit({ type: "plan:step:failed", planId: payload.planId, stepId: payload.stepId, stepIndex: payload.stepIndex, ts: Date.now() });
      },

      onPlanDone: (payload) => {
        if (!currentPlan) return;
        flushTokenBuffer(planMsgId, true);
        const completed: FrontendPlan = {
          ...currentPlan,
          status: "complete" as const,
          durationMs: payload.durationMs,
          summary: payload.summary,
          stepsCompleted: payload.stepsCompleted,
          stepsFailed: payload.stepsFailed,
        };
        updatePlan(completed);
        setActivePlan(null);
        setIsStreaming(false);
        setStreamingMsgId(null);
        setAgentStatus("idle");
        _rt.bus.emit({ type: "plan:done", planId: payload.planId, durationMs: payload.durationMs, ts: Date.now() });
        _rt.bus.emit({ type: "stream:done", sessionId, durationMs: Date.now() - streamStartTime, tokens: responseContentRef.current.length, ts: Date.now() });
        clearSavedPlan(sessionId);
        responseContentRef.current = "";
        if (speech.autoSpeak && payload.summary) {
          speech.queue(planMsgId, payload.summary);
        }
      },

      onError: (msg) => {
        _rt.bus.emit({ type: "stream:error", error: msg ?? "Plan failed", ts: Date.now() });
        setIsTyping(false);
        setIsStreaming(false);
        setStreamingMsgId(null);
        setAgentStatus("error");
        setTimeout(() => setAgentStatus("idle"), 2500);
        if (!planMessageCreated) {
          setMessages((prev) => [
            ...prev,
            { id: planMsgId, role: "assistant", content: "Plan execution failed. Please try again.", timestamp: new Date() },
          ]);
        }
      },
    });
  }, [input, isTyping, isStreaming, sessionId, flushTokenBuffer, speech]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };

  const handleMemoryCleared = useCallback(() => {
    setMemory((prev) =>
      prev
        ? {
            ...prev,
            messages: [],
            summary: null,
            preferences: {},
            messageCount: 0,
          }
        : prev,
    );
    setMessages([WELCOME()]);
  }, []);

  const handleNewSession = useCallback(() => {
    const newId = createNewSessionId();
    setSessionId(newId);
    setMemory(null);
    setMessages([WELCOME()]);
  }, []);

  const handlePreferencesSaved = useCallback((updated: SessionMemory) => {
    setMemory(updated);
    setMessages((prev) => {
      const rest = prev.filter((m) => m.id !== "init");
      return [WELCOME(updated.preferences?.name), ...rest];
    });
  }, []);

  return (
    <ChatPanel>

      <ChatToolbar
        agentStatus={agentStatus}
        memory={memory}
        speech={speech}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        setTasksPanelOpen={setTasksPanelOpen}
        setDiagPanelOpen={setDiagPanelOpen}
        setStatusPanelOpen={setStatusPanelOpen}
        onOpenMemory={() => setPanelOpen(true)}
      />

      {/* Status bar — shows while agent is active */}
      {agentStatus !== "idle" && !isLoadingHistory && (
        <div
          className="relative z-10 flex-shrink-0 flex items-center gap-2 px-4 sm:px-8 py-1 border-b border-border/20 transition-all duration-500"
          style={{ background: `${STATUS_CONFIG[agentStatus].color}08` }}
        >
          <div
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: STATUS_CONFIG[agentStatus].color }}
          />
          <span
            className="text-xs font-display tracking-widest"
            style={{ color: STATUS_CONFIG[agentStatus].color, opacity: 0.75 }}
          >
            {STATUS_CONFIG[agentStatus].label}
          </span>
        </div>
      )}

      {/* Loading banner */}
      {isLoadingHistory && (
        <div className="relative z-10 flex-shrink-0 flex items-center justify-center gap-2 py-2 bg-primary/5 border-b border-primary/20">
          <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
          <span
            className="text-xs tracking-wider"
            style={{ color: "hsl(194 100% 55%)" }}
          >
            RESTORING MEMORY...
          </span>
        </div>
      )}

      {/* Debug mode banner */}
      {debugMode && (
        <div
          className="relative z-10 flex-shrink-0 flex items-center justify-center gap-2 py-1.5 border-b"
          style={{
            background: "hsl(38 100% 55% / 0.08)",
            borderColor: "hsl(38 100% 55% / 0.25)",
          }}
        >
          <Terminal className="w-3 h-3" style={{ color: "hsl(38 100% 65%)" }} />
          <span
            className="text-xs tracking-wider font-mono"
            style={{ color: "hsl(38 100% 65%)" }}
          >
            DEBUG MODE ACTIVE — click any response to expand reasoning
          </span>
        </div>
      )}

      {/* ── Debug tab ─────────────────────────────────────────────────────── */}
      {activeTab === "debug" && (
        <div className="relative z-10 flex-1 overflow-y-auto scrollbar-thin px-4 sm:px-6 py-6">
          <div className="max-w-2xl mx-auto flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-sm tracking-widest" style={{ color: "hsl(196 100% 65%)" }}>
                DEBUG LOG
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: "hsl(196 30% 45%)" }}>{debugLogs.length} entries</span>
                <button
                  onClick={() => setDebugLogs([])}
                  className="px-3 py-1 rounded-xl text-[10px] font-bold tracking-widest transition-all active:scale-95"
                  style={{ background: "hsl(355 80% 35% / 0.15)", border: "1px solid hsl(355 80% 40% / 0.5)", color: "hsl(355 80% 64%)" }}
                >
                  CLEAR
                </button>
              </div>
            </div>
            {debugLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-2">
                <Terminal className="w-10 h-10" style={{ color: "hsl(196 40% 30%)" }} />
                <p className="text-sm tracking-wide" style={{ color: "hsl(196 25% 38%)" }}>No debug logs yet</p>
              </div>
            ) : (
              <div
                className="rounded-2xl p-4 font-mono text-[11px] leading-relaxed flex flex-col gap-0.5"
                style={{ background: "hsl(210 15% 6%)", border: "1px solid hsl(210 15% 14%)" }}
              >
                {debugLogs.map((line, i) => (
                  <div
                    key={i}
                    style={{
                      color: line.includes("✖") ? "hsl(355 80% 68%)" : line.includes("⚠") ? "hsl(38 100% 65%)" : "hsl(142 71% 60%)",
                      wordBreak: "break-all",
                    }}
                  >
                    {line}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Dev Workspace tab ─────────────────────────────────────────────── */}
      {activeTab === "dev" && (
        <DevErrorBoundary>
          <div className="relative z-10 flex-1 flex flex-col overflow-hidden">

            {/* ── Action bar (mobile-first: flex-wrap, no horizontal scroll) ── */}
            {(() => {
              const btnIcon = (key: string) => {
                const st = actionStatus[key];
                if (st === "loading") return <RefreshCw className="w-3 h-3 animate-spin" />;
                if (st === "success") return <span className="text-[10px]">✓</span>;
                if (st === "error")   return <span className="text-[10px]">✖</span>;
                return null;
              };
              const isBusy = (key: string) => actionStatus[key] === "loading";
              return (
                <div className="flex-shrink-0 flex flex-wrap gap-1.5 px-4 py-2.5 border-b border-border/30">
                  {/* ── WORK ON JARVIS — primary action ── */}
                  <button
                    onClick={() => { setDevSection("chat"); void withActionFeedback("WORK", () => sendDevMessage("Let's work on Jarvis. Review the project memory and current state, then identify the most impactful thing to build or fix next. Give me a concrete implementation plan with specific files and changes.")); }}
                    disabled={devSending || isBusy("WORK")}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40"
                    style={{
                      background: "hsl(264 80% 55% / 0.20)",
                      border: "1.5px solid hsl(264 80% 65% / 0.70)",
                      color: actionStatus["WORK"] === "success" ? "hsl(142 71% 62%)" : actionStatus["WORK"] === "error" ? "hsl(355 80% 62%)" : "hsl(264 80% 82%)",
                      boxShadow: "0 0 12px hsl(264 80% 55% / 0.25)",
                    }}
                  >
                    {isBusy("WORK") ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5" />}
                    WORK ON JARVIS
                  </button>

                  {/* ── Chat-prompt actions ── */}
                  {([
                    { key: "SCAN",  label: "SCAN PROJECT", prompt: "Use list_project_files to scan the project structure, then read key source files. List main components, API routes, and libraries. Highlight quality issues and improvement opportunities. Start with artifacts/jarvas/src and artifacts/api-server/src." },
                    { key: "FIX",   label: "PROPOSE FIX",  prompt: "Review the project memory and current debug context. Propose a specific, actionable code fix for the most critical issue." },
                    { key: "PATCH", label: "CREATE PATCH", prompt: "Based on our conversation, create a concrete code patch for the most recently discussed fix. Queue it for review in the Patches tab." },
                  ] as const).map(({ key, label, prompt }) => (
                    <button
                      key={key}
                      onClick={() => { setDevSection("chat"); void withActionFeedback(key, () => sendDevMessage(prompt)); }}
                      disabled={devSending || isBusy(key)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40"
                      style={{ background: "hsl(194 100% 55% / 0.10)", border: "1px solid hsl(194 100% 55% / 0.35)", color: actionStatus[key] === "success" ? "hsl(142 71% 62%)" : actionStatus[key] === "error" ? "hsl(355 80% 62%)" : "hsl(194 100% 68%)" }}
                    >
                      {btnIcon(key)}
                      {label}
                    </button>
                  ))}

                  {/* ── RUN BUILD ── */}
                  <button
                    onClick={() => { setDevSection("build"); void withActionFeedback("BUILD", () => runDevBuild(true)); }}
                    disabled={devBuildLoading || isBusy("BUILD")}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40"
                    style={{ background: "hsl(38 100% 55% / 0.12)", border: "1px solid hsl(38 100% 55% / 0.35)", color: actionStatus["BUILD"] === "success" ? "hsl(142 71% 62%)" : actionStatus["BUILD"] === "error" ? "hsl(355 80% 62%)" : "hsl(38 100% 70%)" }}
                  >
                    {devBuildLoading || isBusy("BUILD") ? <RefreshCw className="w-3 h-3 animate-spin" /> : btnIcon("BUILD")}
                    RUN BUILD
                  </button>

                  {/* ── RUN ALL CHECKS (typecheck + build + diag) ── */}
                  <button
                    onClick={() => void withActionFeedback("RUN_ALL", () => runAllChecks())}
                    disabled={devBuildLoading || devDiagLoading || devLogsLoading || isBusy("RUN_ALL")}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40"
                    style={{ background: "hsl(38 100% 55% / 0.12)", border: "1px solid hsl(38 100% 55% / 0.45)", color: actionStatus["RUN_ALL"] === "success" ? "hsl(142 71% 62%)" : actionStatus["RUN_ALL"] === "error" ? "hsl(355 80% 62%)" : "hsl(38 100% 70%)" }}
                  >
                    {isBusy("RUN_ALL") || devBuildLoading || devDiagLoading
                      ? <RefreshCw className="w-3 h-3 animate-spin" />
                      : btnIcon("RUN_ALL") ?? <RefreshCw className="w-3 h-3" />}
                    RUN ALL CHECKS
                  </button>

                  {/* ── TOOLS dropdown — Export Snapshot + Refresh Current ── */}
                  <div ref={toolsMenuRef} className="relative">
                    <button
                      onClick={() => setToolsMenuOpen(v => !v)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold tracking-widest transition-all active:scale-95"
                      style={{
                        background: toolsMenuOpen ? "hsl(196 30% 44% / 0.15)" : "transparent",
                        border: `1px solid ${toolsMenuOpen ? "hsl(196 30% 44% / 0.55)" : "hsl(210 15% 24%)"}`,
                        color: "hsl(196 30% 52%)",
                      }}
                    >
                      <Wrench className="w-3 h-3" />
                      TOOLS
                      <ChevronDown className={`w-3 h-3 transition-transform duration-150 ${toolsMenuOpen ? "rotate-180" : ""}`} />
                    </button>
                    {toolsMenuOpen && (
                      <div
                        className="absolute top-full left-0 mt-1 z-50 rounded-xl overflow-hidden flex flex-col"
                        style={{ background: "hsl(210 15% 8%)", border: "1px solid hsl(210 15% 18%)", minWidth: "175px", boxShadow: "0 8px 24px rgba(0,0,0,0.55)" }}
                      >
                        <button
                          onClick={() => { setToolsMenuOpen(false); void withActionFeedback("EXPORT", () => exportSnapshot()); }}
                          disabled={isBusy("EXPORT")}
                          className="flex items-center gap-2 px-4 py-2.5 text-[10px] font-bold tracking-widest transition-all hover:bg-white/5 disabled:opacity-40 text-left"
                          style={{ color: actionStatus["EXPORT"] === "success" ? "hsl(142 71% 62%)" : actionStatus["EXPORT"] === "error" ? "hsl(355 80% 62%)" : "hsl(142 71% 62%)" }}
                        >
                          {isBusy("EXPORT") ? <RefreshCw className="w-3 h-3 animate-spin" /> : btnIcon("EXPORT") ?? <Download className="w-3 h-3" />}
                          EXPORT SNAPSHOT
                        </button>
                        <button
                          onClick={() => {
                            setToolsMenuOpen(false);
                            void withActionFeedback("CLEARTASKS", async () => {
                              const r = await fetch(`${BASE}api/dev/tasks`, { method: "DELETE" });
                              const d = await r.json() as { ok: boolean; cleared: number };
                              if (!d.ok) throw new Error("Clear failed");
                            });
                          }}
                          disabled={isBusy("CLEARTASKS")}
                          className="flex items-center gap-2 px-4 py-2.5 text-[10px] font-bold tracking-widest transition-all hover:bg-white/5 disabled:opacity-40 text-left"
                          style={{ color: actionStatus["CLEARTASKS"] === "success" ? "hsl(142 71% 62%)" : actionStatus["CLEARTASKS"] === "error" ? "hsl(355 80% 62%)" : "hsl(355 60% 55%)" }}
                        >
                          {isBusy("CLEARTASKS") ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                          CLEAR OLD TASKS
                        </button>
                        <button
                          onClick={() => {
                            setToolsMenuOpen(false);
                            void withActionFeedback("REFRESH", async () => {
                              if      (devSection === "build")     await runDevBuild(true);
                              else if (devSection === "diag")      await runDevDiag();
                              else if (devSection === "logs")      await loadDevLogs();
                              else if (devSection === "patches")   { await fetchPendingPatches().then(setPendingPatches); }
                              else if (devSection === "checklist") await runAllChecks();
                              else { await Promise.all([loadDevProjectMemory(), fetchPendingPatches().then(setPendingPatches).catch(() => {})]); }
                            });
                          }}
                          disabled={isBusy("REFRESH") || devBuildLoading || devDiagLoading || devLogsLoading}
                          className="flex items-center gap-2 px-4 py-2.5 text-[10px] font-bold tracking-widest transition-all hover:bg-white/5 disabled:opacity-40 text-left"
                          style={{ color: actionStatus["REFRESH"] === "success" ? "hsl(142 71% 62%)" : actionStatus["REFRESH"] === "error" ? "hsl(355 80% 62%)" : "hsl(196 30% 52%)" }}
                        >
                          {isBusy("REFRESH") ? <RefreshCw className="w-3 h-3 animate-spin" /> : btnIcon("REFRESH") ?? <RefreshCw className="w-3 h-3" />}
                          REFRESH CURRENT
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
            {/* Helper text */}
            <div className="flex-shrink-0 px-4 pb-1 text-[9px] font-medium tracking-widest" style={{ color: "hsl(196 20% 32%)" }}>
              ACTIONS RUN TOOLS · TABS SHOW RESULTS
            </div>

            {/* ── Sub-tab bar (mobile-first: flex-wrap) ── */}
            <div className="flex-shrink-0 flex flex-wrap gap-1 px-4 pt-2 pb-1">
              {(["chat", "patches", "build", "diag", "logs", "checklist"] as const).map((sec) => {
                const isActive = devSection === sec;
                const labels: Record<typeof sec, string> = {
                  chat:      "CHAT",
                  patches:   pendingPatches.length ? `PATCHES (${pendingPatches.length})` : "PATCHES",
                  build:     "BUILD",
                  diag:      "DIAG",
                  logs:      "LOGS",
                  checklist: "✓ CHECKLIST",
                };
                const colors: Record<typeof sec, { active: string; border: string; bg: string }> = {
                  chat:      { active: "hsl(194 100% 70%)", border: "hsl(194 100% 55% / 0.45)", bg: "hsl(194 100% 55% / 0.14)" },
                  patches:   { active: "hsl(142 70% 65%)",  border: "hsl(142 60% 45% / 0.45)", bg: "hsl(142 60% 45% / 0.12)" },
                  build:     { active: "hsl(38  100% 70%)", border: "hsl(38  100% 55% / 0.45)", bg: "hsl(38  100% 55% / 0.12)" },
                  diag:      { active: "hsl(264 80%  72%)", border: "hsl(264 80%  55% / 0.45)", bg: "hsl(264 80%  55% / 0.12)" },
                  logs:      { active: "hsl(196 80%  68%)", border: "hsl(196 80%  55% / 0.45)", bg: "hsl(196 80%  55% / 0.12)" },
                  checklist: { active: "hsl(142 71%  62%)", border: "hsl(142 60%  45% / 0.45)", bg: "hsl(142 60%  45% / 0.14)" },
                };
                const c = colors[sec];
                return (
                  <button
                    key={sec}
                    onClick={() => {
                      setDevSection(sec);
                      if (sec === "build"     && !devBuildResult)        void runDevBuild();
                      if (sec === "diag"      && !devDiagReport)         void runDevDiag();
                      if (sec === "logs"      && devLogs.length === 0)   void loadDevLogs();
                    }}
                    className="px-3 py-1 rounded-lg text-[10px] font-bold tracking-widest transition-all active:scale-95"
                    style={{
                      background: isActive ? c.bg : "transparent",
                      border:     `1px solid ${isActive ? c.border : "hsl(210 15% 22%)"}`,
                      color:      isActive ? c.active : "hsl(196 20% 38%)",
                    }}
                  >
                    {labels[sec]}
                  </button>
                );
              })}
            </div>

            {/* ══════════════════ CHAT ══════════════════ */}
            {devSection === "chat" && (
              <>
                {/* Project Memory — collapsible panel */}
                <div className="flex-shrink-0 mx-4 mb-1">
                  <button
                    onClick={() => {
                      setDevMemoryOpen(!devMemoryOpen);
                      if (devProjectMemory.length === 0) void loadDevProjectMemory();
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-[10px] font-bold tracking-widest transition-all"
                    style={{
                      background: devMemoryOpen ? "hsl(194 100% 55% / 0.08)" : "transparent",
                      border:     `1px solid ${devMemoryOpen ? "hsl(194 100% 55% / 0.30)" : "hsl(210 15% 20%)"}`,
                      color:      devMemoryOpen ? "hsl(194 100% 65%)" : "hsl(196 25% 40%)",
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Brain className="w-3 h-3" />
                      PROJECT MEMORY
                      {devProjectMemory.length > 0 && (
                        <span style={{ color: "hsl(194 100% 50%)" }}>({devProjectMemory.length})</span>
                      )}
                    </div>
                    <span>{devMemoryOpen ? "▲" : "▼"}</span>
                  </button>

                  {devMemoryOpen && (
                    <div
                      className="mt-1.5 rounded-2xl overflow-hidden border"
                      style={{ background: "hsl(210 15% 6%)", borderColor: "hsl(210 15% 14%)" }}
                    >
                      {devProjectMemory.length === 0 ? (
                        <div className="px-4 py-3 text-xs" style={{ color: "hsl(196 25% 38%)" }}>Loading project memory…</div>
                      ) : (
                        <div className="divide-y max-h-64 overflow-y-auto scrollbar-thin" style={{ borderColor: "hsl(210 15% 12%)" }}>
                          {(["architecture","known-bugs","coding-rules","deployment","file-map","ui-conventions","general"] as const)
                            .filter(cat => devProjectMemory.some(e => e.category === cat))
                            .map(cat => {
                              const catColor: Record<string, string> = {
                                "architecture":   "hsl(194 100% 60%)",
                                "known-bugs":     "hsl(355 80%  64%)",
                                "coding-rules":   "hsl(142 70%  60%)",
                                "deployment":     "hsl(38  100% 65%)",
                                "file-map":       "hsl(264 80%  72%)",
                                "ui-conventions": "hsl(194 80%  70%)",
                                "general":        "hsl(196 30%  55%)",
                              };
                              return (
                                <div key={cat} className="px-4 py-2.5">
                                  <div className="text-[9px] font-bold tracking-widest mb-1.5 uppercase" style={{ color: catColor[cat] }}>
                                    {cat.replace(/-/g, " ")}
                                  </div>
                                  {devProjectMemory.filter(e => e.category === cat).map(entry => (
                                    <div key={entry.id} className="mb-2 last:mb-0">
                                      <div className="text-xs font-semibold mb-0.5" style={{ color: "hsl(196 50% 75%)" }}>{entry.title}</div>
                                      <div className="text-xs leading-relaxed" style={{ color: "hsl(196 20% 50%)" }}>{entry.content}</div>
                                    </div>
                                  ))}
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Dev chat messages */}
                <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 flex flex-col gap-3">
                  {devMessages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3 py-16">
                      <Code2 className="w-10 h-10" style={{ color: "hsl(194 100% 38%)" }} />
                      <p className="text-sm tracking-wide" style={{ color: "hsl(196 25% 40%)" }}>Engineering assistant</p>
                      <p className="text-xs text-center max-w-xs leading-relaxed" style={{ color: "hsl(196 20% 30%)" }}>
                        Separate history from main chat. Knows project architecture, bugs, and build state.
                      </p>
                    </div>
                  ) : devMessages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div
                        className="max-w-[90%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed"
                        style={msg.role === "user"
                          ? { background: "hsl(194 100% 55% / 0.13)", border: "1px solid hsl(194 100% 55% / 0.32)", color: "hsl(194 100% 90%)" }
                          : { background: "hsl(210 15% 8%)", border: "1px solid hsl(210 15% 16%)", color: "hsl(196 35% 80%)", whiteSpace: "pre-wrap" }
                        }
                      >
                        {msg.content || (devSending && msg.role === "assistant"
                          ? <span className="inline-block animate-pulse" style={{ color: "hsl(194 100% 55%)" }}>▋</span>
                          : null
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={devChatEndRef} />
                </div>

                {/* Dev input bar */}
                <div
                  className="flex-shrink-0 px-4 pb-4 pt-2 border-t border-border/30"
                  style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom, 0px))" }}
                >
                  <div className="flex gap-2 items-end max-w-2xl mx-auto">
                    <textarea
                      value={devInput}
                      onChange={(e) => setDevInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendDevMessage(devInput); }
                      }}
                      placeholder="Ask about the codebase, request a fix, or describe a change…"
                      rows={2}
                      className="flex-1 resize-none rounded-2xl border bg-transparent px-4 py-2.5 text-sm outline-none"
                      style={{ borderColor: "hsl(210 15% 22%)", color: "hsl(196 40% 80%)" }}
                    />
                    <button
                      onClick={() => void sendDevMessage(devInput)}
                      disabled={!devInput.trim() || devSending}
                      className="flex-shrink-0 w-10 h-10 rounded-2xl flex items-center justify-center transition-all active:scale-95 disabled:opacity-40"
                      style={{ background: "hsl(194 100% 55% / 0.18)", border: "1px solid hsl(194 100% 55% / 0.45)" }}
                      aria-label="Send"
                    >
                      {devSending
                        ? <RefreshCw className="w-4 h-4 animate-spin" style={{ color: "hsl(194 100% 65%)" }} />
                        : <Send className="w-4 h-4" style={{ color: "hsl(194 100% 65%)" }} />
                      }
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* ══════════════════ PATCHES ══════════════════ */}
            {devSection === "patches" && (
              <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4">
                <div
                  className="mx-auto max-w-2xl mb-4 flex items-center gap-2 flex-wrap px-4 py-2.5 rounded-2xl text-xs"
                  style={{ background: "hsl(210 15% 6%)", border: "1px solid hsl(210 15% 14%)", color: "hsl(196 30% 48%)" }}
                >
                  <span style={{ color: "hsl(194 100% 60%)" }}>Generate</span>
                  <span>→</span><span>Review</span><span>→</span><span>Accept</span><span>→</span>
                  <span style={{ color: "hsl(38 100% 65%)" }}>Build/Test</span>
                  <span>→</span>
                  <span style={{ color: "hsl(142 70% 60%)" }}>Deploy</span>
                </div>
                {pendingPatches.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <ShieldCheck className="w-10 h-10" style={{ color: "hsl(142 60% 30%)" }} />
                    <p className="text-sm tracking-wide" style={{ color: "hsl(196 25% 40%)" }}>No pending patches</p>
                    <p className="text-xs text-center max-w-xs leading-relaxed" style={{ color: "hsl(196 20% 30%)" }}>
                      Use PATCH or ask Jarvis to propose a fix in the Chat tab.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 max-w-2xl mx-auto">
                    {pendingPatches.map((patch) => (
                      <PatchCard
                        key={patch.patchId}
                        patch={patch}
                        onRemove={(id) => setPendingPatches((prev) => prev.filter((p) => p.patchId !== id))}
                        onAcceptedGoToBuild={() => setDevSection("build")}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ══════════════════ BUILD / TEST ══════════════════ */}
            {devSection === "build" && (
              <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4">
                <div className="max-w-2xl mx-auto flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold tracking-widest" style={{ color: "hsl(38 100% 70%)" }}>BUILD / TEST</h2>
                    <button
                      onClick={() => void runDevBuild(true)}
                      disabled={devBuildLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40"
                      style={{ background: "hsl(38 100% 55% / 0.12)", border: "1px solid hsl(38 100% 55% / 0.45)", color: "hsl(38 100% 70%)" }}
                    >
                      <RefreshCw className={`w-3 h-3 ${devBuildLoading ? "animate-spin" : ""}`} />
                      RUN CHECK
                    </button>
                  </div>

                  {!devBuildResult && !devBuildLoading && (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                      <Activity className="w-10 h-10" style={{ color: "hsl(38 100% 32%)" }} />
                      <p className="text-sm" style={{ color: "hsl(196 25% 38%)" }}>Click RUN CHECK to inspect TypeScript health</p>
                    </div>
                  )}
                  {devBuildLoading && (
                    <div className="flex items-center gap-3 py-8 justify-center">
                      <RefreshCw className="w-5 h-5 animate-spin" style={{ color: "hsl(38 100% 60%)" }} />
                      <span className="text-sm" style={{ color: "hsl(196 25% 45%)" }}>Running TypeScript checks…</span>
                    </div>
                  )}

                  {devBuildResult && !devBuildLoading && (() => {
                    const fe    = devBuildResult.frontend ?? { errorCount: 0, errors: [] };
                    const be    = devBuildResult.backend  ?? { errorCount: 0, errors: [] };
                    const score = devBuildResult.score ?? 0;
                    const lbl   = devBuildResult.label ?? "critical";
                    const allErrors = [...fe.errors, ...be.errors];
                    return (
                      <>
                        <div
                          className="rounded-2xl p-5 flex items-center gap-4"
                          style={{ background: "hsl(210 15% 7%)", border: "1px solid hsl(210 15% 15%)" }}
                        >
                          <div
                            className="w-16 h-16 rounded-2xl flex items-center justify-center font-bold text-2xl flex-shrink-0"
                            style={{
                              background: score >= 90 ? "hsl(142 60% 40% / 0.2)" : score >= 70 ? "hsl(38 100% 55% / 0.2)" : "hsl(355 80% 40% / 0.2)",
                              border:     `2px solid ${score >= 90 ? "hsl(142 60% 50%)" : score >= 70 ? "hsl(38 100% 60%)" : "hsl(355 80% 50%)"}`,
                              color:      score >= 90 ? "hsl(142 71% 65%)" : score >= 70 ? "hsl(38 100% 70%)" : "hsl(355 80% 65%)",
                            }}
                          >
                            {score}
                          </div>
                          <div className="flex flex-col gap-1 flex-1">
                            <div className="text-sm font-bold tracking-widest uppercase"
                              style={{ color: score >= 90 ? "hsl(142 71% 62%)" : score >= 70 ? "hsl(38 100% 68%)" : "hsl(355 80% 62%)" }}>
                              {lbl}
                            </div>
                            <div className="text-xs" style={{ color: "hsl(196 25% 45%)" }}>
                              Frontend: {fe.errorCount} error(s) · Backend: {be.errorCount} error(s)
                            </div>
                          </div>
                          {allErrors.length > 0 && <CopyButton text={allErrors.join("\n")} label="COPY ERRORS" />}
                        </div>

                        {[
                          { label: "FRONTEND (jarvas)",    errors: fe.errors },
                          { label: "BACKEND (api-server)", errors: be.errors },
                        ].map(({ label: pkg, errors }) => errors.length > 0 && (
                          <div key={pkg} className="rounded-2xl overflow-hidden" style={{ border: "1px solid hsl(355 80% 25%)" }}>
                            <div className="px-4 py-2 text-[10px] font-bold tracking-widest flex items-center justify-between"
                              style={{ background: "hsl(355 80% 14%)", color: "hsl(355 80% 64%)" }}>
                              {pkg}
                              <CopyButton text={errors.join("\n")} />
                            </div>
                            <div className="p-4 font-mono text-[11px] leading-relaxed flex flex-col gap-1" style={{ background: "hsl(210 15% 6%)" }}>
                              {errors.slice(0, 20).map((line, i) => (
                                <div key={i} style={{ color: "hsl(355 80% 64%)", wordBreak: "break-all" }}>{line}</div>
                              ))}
                              {errors.length > 20 && <div style={{ color: "hsl(196 25% 38%)" }}>…and {errors.length - 20} more</div>}
                            </div>
                          </div>
                        ))}

                        {fe.errorCount === 0 && be.errorCount === 0 && (
                          <div className="rounded-2xl px-4 py-3 text-sm text-center"
                            style={{ background: "hsl(142 60% 12%)", border: "1px solid hsl(142 60% 24%)", color: "hsl(142 71% 65%)" }}>
                            ✓ No TypeScript errors — build is clean
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* ══════════════════ DIAG ══════════════════ */}
            {devSection === "diag" && (
              <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4">
                <div className="max-w-2xl mx-auto flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold tracking-widest" style={{ color: "hsl(264 80% 72%)" }}>DIAGNOSTICS</h2>
                    <div className="flex items-center gap-2">
                      {devDiagReport && <CopyButton text={JSON.stringify(devDiagReport, null, 2)} label="COPY JSON" />}
                      <button
                        onClick={() => void runDevDiag()}
                        disabled={devDiagLoading}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40"
                        style={{ background: "hsl(264 80% 55% / 0.12)", border: "1px solid hsl(264 80% 55% / 0.45)", color: "hsl(264 80% 72%)" }}
                      >
                        <RefreshCw className={`w-3 h-3 ${devDiagLoading ? "animate-spin" : ""}`} />
                        REFRESH
                      </button>
                    </div>
                  </div>

                  {!devDiagReport && !devDiagLoading && (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                      <Activity className="w-10 h-10" style={{ color: "hsl(264 80% 40%)" }} />
                      <p className="text-sm" style={{ color: "hsl(196 25% 38%)" }}>Click REFRESH to run a full system diagnostic</p>
                    </div>
                  )}
                  {devDiagLoading && (
                    <div className="flex items-center gap-3 py-8 justify-center">
                      <RefreshCw className="w-5 h-5 animate-spin" style={{ color: "hsl(264 80% 65%)" }} />
                      <span className="text-sm" style={{ color: "hsl(196 25% 45%)" }}>Running diagnostics…</span>
                    </div>
                  )}

                  {devDiagReport && !devDiagLoading && (
                    <>
                      <div
                        className="rounded-2xl p-4 flex items-center gap-4"
                        style={{ background: "hsl(210 15% 7%)", border: `1px solid ${devDiagReport.ok ? "hsl(142 60% 24%)" : "hsl(355 80% 25%)"}` }}
                      >
                        <div
                          className="text-2xl w-10 h-10 flex items-center justify-center rounded-2xl flex-shrink-0 font-bold"
                          style={{ background: devDiagReport.ok ? "hsl(142 60% 40% / 0.2)" : "hsl(355 80% 40% / 0.2)", color: devDiagReport.ok ? "hsl(142 71% 62%)" : "hsl(355 80% 64%)" }}
                        >
                          {devDiagReport.ok ? "✓" : "✖"}
                        </div>
                        <div className="flex-1">
                          <div className="text-sm font-bold" style={{ color: devDiagReport.ok ? "hsl(142 71% 62%)" : "hsl(355 80% 64%)" }}>
                            {devDiagReport.ok ? "All checks passed" : `${devDiagReport.errorCount} error(s) · ${devDiagReport.warnCount} warning(s)`}
                          </div>
                          <div className="text-xs mt-0.5" style={{ color: "hsl(196 25% 42%)" }}>
                            {devDiagReport.runtimeInfo.nodeVersion} · uptime {Math.round(devDiagReport.runtimeInfo.uptimeSeconds / 60)}m · {new Date(devDiagReport.checkedAt).toLocaleTimeString()}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        {Object.entries(devDiagReport.checks).map(([key, result]) => {
                          const col = result === "pass" ? "hsl(142 71% 60%)" : result === "fail" ? "hsl(355 80% 62%)" : result === "warn" ? "hsl(38 100% 65%)" : "hsl(196 25% 45%)";
                          return (
                            <div key={key} className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "hsl(210 15% 7%)", border: "1px solid hsl(210 15% 14%)" }}>
                              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: col }} />
                              <span className="text-xs truncate" style={{ color: "hsl(196 30% 55%)" }}>{key.replace(/_/g, " ")}</span>
                              <span className="text-[9px] font-bold ml-auto uppercase" style={{ color: col }}>{result}</span>
                            </div>
                          );
                        })}
                      </div>

                      {devDiagReport.issues.length > 0 && (
                        <div className="flex flex-col gap-2">
                          {devDiagReport.issues.map((issue, i) => {
                            const sevColor = issue.severity === "error" ? "hsl(355 80% 62%)" : issue.severity === "warning" ? "hsl(38 100% 65%)" : "hsl(196 60% 60%)";
                            const issueText = `${issue.likelyCause}\n\nFix: ${issue.suggestedFix}${issue.detail ? `\n\nDetail: ${issue.detail}` : ""}`;
                            return (
                              <div key={i} className="rounded-2xl p-4 flex flex-col gap-2" style={{ background: "hsl(210 15% 7%)", border: `1px solid ${sevColor}33` }}>
                                <div className="flex items-start justify-between gap-2">
                                  <span className="text-xs font-semibold leading-snug flex-1" style={{ color: "hsl(196 50% 78%)" }}>{issue.likelyCause}</span>
                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <CopyButton text={issueText} />
                                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase"
                                      style={{ background: `${sevColor}20`, color: sevColor, border: `1px solid ${sevColor}44` }}>
                                      {issue.severity}
                                    </span>
                                  </div>
                                </div>
                                <div className="text-xs" style={{ color: "hsl(196 25% 45%)" }}>{issue.suggestedFix}</div>
                                {issue.detail && <div className="text-[10px] font-mono" style={{ color: "hsl(196 20% 36%)" }}>{issue.detail}</div>}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ══════════════════ LOGS ══════════════════ */}
            {devSection === "logs" && (
              <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4">
                <div className="max-w-2xl mx-auto flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold tracking-widest" style={{ color: "hsl(196 80% 68%)" }}>LOGS</h2>
                    <div className="flex items-center gap-2">
                      {devLogs.length > 0 && <CopyButton text={devLogs.join("\n")} label="COPY ALL" />}
                      <button
                        onClick={() => void loadDevLogs()}
                        disabled={devLogsLoading}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40"
                        style={{ background: "hsl(196 80% 55% / 0.12)", border: "1px solid hsl(196 80% 55% / 0.45)", color: "hsl(196 80% 68%)" }}
                      >
                        <RefreshCw className={`w-3 h-3 ${devLogsLoading ? "animate-spin" : ""}`} />
                        REFRESH
                      </button>
                    </div>
                  </div>

                  {!devLogsLoading && devLogs.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                      <Activity className="w-10 h-10" style={{ color: "hsl(196 80% 28%)" }} />
                      <p className="text-sm" style={{ color: "hsl(196 25% 38%)" }}>Click REFRESH to load server logs</p>
                    </div>
                  )}
                  {devLogsLoading && (
                    <div className="flex items-center gap-3 py-8 justify-center">
                      <RefreshCw className="w-5 h-5 animate-spin" style={{ color: "hsl(196 80% 60%)" }} />
                      <span className="text-sm" style={{ color: "hsl(196 25% 45%)" }}>Loading logs…</span>
                    </div>
                  )}
                  {!devLogsLoading && devLogs.length > 0 && (
                    <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid hsl(210 15% 16%)" }}>
                      <div className="px-4 py-2 text-[10px] font-bold tracking-widest"
                        style={{ background: "hsl(210 15% 10%)", color: "hsl(196 30% 50%)" }}>
                        SERVER LOGS — {devLogs.length} lines
                      </div>
                      <div className="p-4 font-mono text-[11px] leading-relaxed flex flex-col gap-0.5 max-h-[60vh] overflow-y-auto scrollbar-thin"
                        style={{ background: "hsl(210 15% 5%)" }}>
                        {devLogs.map((line, i) => {
                          const isErr  = /error|fail|exception/i.test(line);
                          const isWarn = /warn|warning/i.test(line);
                          return (
                            <div key={i} style={{ color: isErr ? "hsl(355 80% 64%)" : isWarn ? "hsl(38 100% 65%)" : "hsl(196 25% 50%)", wordBreak: "break-all" }}>
                              {line}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ══════════════════ CHECKLIST ══════════════════ */}
            {devSection === "checklist" && (() => {
              const fe       = devBuildResult?.frontend ?? { errorCount: 0 };
              const be       = devBuildResult?.backend  ?? { errorCount: 0 };
              const score    = devBuildResult?.score ?? null;
              const portOk   = devDiagReport ? devDiagReport.checks["port_binding"] !== "fail" : null;
              const aiKeyOk  = devDiagReport ? devDiagReport.checks["env_var_AI_INTEGRATIONS_ANTHROPIC_API_KEY"] === "pass" : null;
              const autoItems: Array<{ label: string; ok: boolean | null; detail?: string }> = [
                { label: "API server online",           ok: true,          detail: "Server is responding" },
                { label: "npm run typecheck (frontend)", ok: fe.errorCount === 0, detail: devBuildResult ? `${fe.errorCount} errors` : "Run Build first" },
                { label: "npm run typecheck (backend)",  ok: be.errorCount === 0, detail: devBuildResult ? `${be.errorCount} errors` : "Run Build first" },
                { label: "Health score ≥ 90",           ok: score !== null ? score >= 90 : null, detail: score !== null ? `Score: ${score}` : "Run Build first" },
                { label: "PORT env var set",            ok: portOk,        detail: devDiagReport ? undefined : "Run Diag first" },
                { label: "Anthropic API key set",       ok: aiKeyOk,       detail: devDiagReport ? undefined : "Run Diag first" },
              ];
              const snapshotJson = JSON.stringify({ timestamp: new Date().toISOString(), projectMemory: devProjectMemory, diagnostics: devDiagReport, buildResult: devBuildResult, pendingPatches }, null, 2);
              return (
                <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4">
                  <div className="max-w-2xl mx-auto flex flex-col gap-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <h2 className="text-sm font-bold tracking-widest" style={{ color: "hsl(142 71% 62%)" }}>LEAVE REPLIT CHECKLIST</h2>
                      <div className="flex items-center gap-2">
                        <CopyButton text={snapshotJson} label="COPY SNAPSHOT" />
                        <button
                          onClick={() => void exportSnapshot()}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold tracking-widest transition-all active:scale-95"
                          style={{ background: "hsl(142 60% 40% / 0.12)", border: "1px solid hsl(142 60% 40% / 0.40)", color: "hsl(142 71% 62%)" }}
                        >
                          <Download className="w-3 h-3" />
                          EXPORT JSON
                        </button>
                      </div>
                    </div>

                    {/* Auto-detected */}
                    <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid hsl(210 15% 16%)" }}>
                      <div className="px-4 py-2 text-[10px] font-bold tracking-widest" style={{ background: "hsl(210 15% 10%)", color: "hsl(196 30% 50%)" }}>
                        AUTO-DETECTED
                      </div>
                      <div className="divide-y" style={{ borderColor: "hsl(210 15% 12%)" }}>
                        {autoItems.map(({ label, ok, detail }) => {
                          const col  = ok === null ? "hsl(196 25% 45%)" : ok ? "hsl(142 71% 62%)" : "hsl(355 80% 62%)";
                          const icon = ok === null ? "?" : ok ? "✓" : "✖";
                          return (
                            <div key={label} className="flex items-center gap-3 px-4 py-3">
                              <span className="text-sm font-bold w-4 flex-shrink-0" style={{ color: col }}>{icon}</span>
                              <span className="text-xs flex-1" style={{ color: "hsl(196 35% 65%)" }}>{label}</span>
                              {detail && <span className="text-[10px]" style={{ color: "hsl(196 20% 38%)" }}>{detail}</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <button
                      onClick={() => void runAllChecks()}
                      disabled={devBuildLoading || devDiagLoading}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-xs font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40"
                      style={{ background: "hsl(38 100% 55% / 0.12)", border: "1px solid hsl(38 100% 55% / 0.45)", color: "hsl(38 100% 70%)" }}
                    >
                      <RefreshCw className={`w-4 h-4 ${(devBuildLoading || devDiagLoading) ? "animate-spin" : ""}`} />
                      RUN ALL CHECKS TO UPDATE STATUS
                    </button>

                    <ManualChecklist />

                    <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: "hsl(210 15% 7%)", border: "1px solid hsl(210 15% 15%)" }}>
                      <div className="text-[10px] font-bold tracking-widest" style={{ color: "hsl(196 30% 50%)" }}>PROJECT SNAPSHOT</div>
                      <div className="text-xs" style={{ color: "hsl(196 25% 45%)" }}>
                        Exports project memory, diagnostics, build result, and pending patches as JSON.
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => void exportSnapshot()}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold tracking-widest transition-all active:scale-95"
                          style={{ background: "hsl(142 60% 40% / 0.15)", border: "1px solid hsl(142 60% 40% / 0.40)", color: "hsl(142 71% 62%)" }}
                        >
                          <Download className="w-3.5 h-3.5" />
                          DOWNLOAD SNAPSHOT
                        </button>
                        <CopyButton text={snapshotJson} label="COPY AS JSON" />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

          </div>
        </DevErrorBoundary>
      )}

      <ChatMessageList
        activeTab={activeTab}
        messages={messages}
        memory={memory}
        isLoadingHistory={isLoadingHistory}
        isStreaming={isStreaming}
        streamingMsgId={streamingMsgId}
        isTyping={isTyping}
        agentStatus={agentStatus}
        debugMode={debugMode}
        speech={speech}
        messagesEndRef={messagesEndRef}
        onOpenMemory={() => setPanelOpen(true)}
      />

      {/* ── Pending patch notification bar — dev tools only ─────────────── */}
      {DEV_TOOLS_ENABLED && (
      <PatchNotificationBar
        patches={pendingPatches.filter(p => !dismissedIds.has(p.patchId))}
        approvingId={approvingPatchId}
        errorMessage={patchBarError}
        serverStatus={serverStatus}
        onApprove={handleApprovePatch}
        onReject={handleRejectPatch}
      />
      )}

      <ChatInput
        activeTab={activeTab}
        input={input}
        isTyping={isTyping}
        isStreaming={isStreaming}
        autoPlannerEnabled={autoPlannerEnabled}
        onToggleAutoPlanner={() => setAutoPlannerEnabled(v => { const n = !v; setAutoPlannerEnabledStorage(n); return n; })}
        speechInput={speechInput}
        textareaRef={textareaRef}
        handleInputChange={handleInputChange}
        handleKeyDown={handleKeyDown}
        onToggleMic={toggleMic}
        onSendPlan={sendPlan}
        onSend={sendMessage}
      />

      {/* Runtime inspector — visible when debug mode is on */}
      {debugMode && <RuntimeInspector />}

      {/* In-app notification toasts (always active) */}
      <NotificationToast />

      {/* Live plan panel — shows while a plan is running */}
      {activePlan && activePlan.status === "running" && (
        <PlannerPanel
          plan={activePlan}
          onCancel={() => {
            setActivePlan(null);
            setIsStreaming(false);
            setStreamingMsgId(null);
            setAgentStatus("idle");
            clearSavedPlan(sessionId);
          }}
        />
      )}

      {/* Jarvis Tasks panel */}
      <JarvisTasksPanel
        isOpen={tasksPanelOpen}
        onClose={() => { setTasksPanelOpen(false); setActiveTab("chat"); }}
        apiBase={BASE}
      />

      {/* Diagnostics panel */}
      <DiagnosticsPanel
        isOpen={diagPanelOpen}
        onClose={() => { setDiagPanelOpen(false); setActiveTab("chat"); }}
        apiBase={BASE}
      />

      {/* System Status panel */}
      <SystemStatusPanel
        isOpen={statusPanelOpen}
        onClose={() => { setStatusPanelOpen(false); setActiveTab("chat"); }}
        apiBase={BASE}
      />

      {/* Activity Log panel */}
      <ActivityLogPanel
        isOpen={logsPanelOpen}
        onClose={() => setLogsPanelOpen(false)}
        apiBase={BASE}
      />

      {/* Agent Actions panel */}
      <AgentActionsPanel
        isOpen={actionsPanelOpen}
        onClose={() => setActionsPanelOpen(false)}
        apiBase={BASE}
      />

      {/* Checkpoints panel */}
      <CheckpointsPanel
        isOpen={checkpointsPanelOpen}
        onClose={() => setCheckpointsPanelOpen(false)}
        apiBase={BASE}
      />

      {/* Executions panel */}
      <ExecutionsPanel
        isOpen={executionsPanelOpen}
        onClose={() => setExecutionsPanelOpen(false)}
        apiBase={BASE}
      />

      {/* Auto Loop panel */}
      <AutoLoopPanel
        isOpen={autoLoopPanelOpen}
        onClose={() => setAutoLoopPanelOpen(false)}
        apiBase={BASE}
      />

      {/* Plans panel */}
      <PlansPanel
        isOpen={plansPanelOpen}
        onClose={() => setPlansPanelOpen(false)}
        apiBase={BASE}
      />

      {/* Priority panel */}
      <PriorityPanel
        isOpen={priorityPanelOpen}
        onClose={() => setPriorityPanelOpen(false)}
        apiBase={BASE}
      />

      {/* Workspace panel */}
      <WorkspacePanel
        isOpen={workspacePanelOpen}
        onClose={() => setWorkspacePanelOpen(false)}
        apiBase={BASE}
      />

      {/* Repo reasoning panel */}
      <ReasonPanel
        isOpen={reasonPanelOpen}
        onClose={() => setReasonPanelOpen(false)}
        apiBase={BASE}
      />

      {/* Agents panel */}
      <AgentsPanel
        isOpen={agentsPanelOpen}
        onClose={() => setAgentsPanelOpen(false)}
        apiBase={BASE}
      />

      {/* Collaboration panel */}
      <CollabPanel
        isOpen={collabPanelOpen}
        onClose={() => setCollabPanelOpen(false)}
        apiBase={BASE}
      />

      {/* Work orders panel */}
      <WorkOrdersPanel
        isOpen={workOrdersPanelOpen}
        onClose={() => setWorkOrdersPanelOpen(false)}
        apiBase={BASE}
      />

      {/* Improvement analysis panel */}
      <ImprovementPanel
        isOpen={improvementPanelOpen}
        onClose={() => setImprovementPanelOpen(false)}
        apiBase={BASE}
      />

      {/* Dev Agent panel — dev tools only */}
      {DEV_TOOLS_ENABLED && devPanelOpen && (
        <DevAgentPanel onClose={() => setDevPanelOpen(false)} />
      )}

      {/* Memory panel */}
      <MemoryPanel
        isOpen={panelOpen}
        onClose={() => setPanelOpen(false)}
        sessionId={sessionId}
        memory={memory}
        onMemoryCleared={handleMemoryCleared}
        onNewSession={handleNewSession}
        onPreferencesSaved={handlePreferencesSaved}
        apiBase={BASE}
      />

    </ChatPanel>
  );
}

