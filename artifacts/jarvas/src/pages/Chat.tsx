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
  Search,
  ExternalLink,
  Brain,
  Terminal,
  LayoutDashboard,
  BookOpen,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  ListChecks,
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
} from "lucide-react";
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

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentStatus = "idle" | "thinking" | "researching" | "processing" | "error";

const STATUS_CONFIG: Record<AgentStatus, { label: string; color: string; glow: string }> = {
  idle:        { label: "READY",         color: "hsl(194 100% 55%)", glow: "0 0 8px rgba(0,200,255,0.5), 0 0 24px rgba(0,200,255,0.2)" },
  thinking:    { label: "THINKING",      color: "hsl(264 80% 72%)",  glow: "0 0 12px rgba(140,80,255,0.6), 0 0 28px rgba(140,80,255,0.2)" },
  researching: { label: "SEARCHING WEB", color: "hsl(194 100% 70%)", glow: "0 0 16px rgba(0,220,255,0.7), 0 0 36px rgba(0,220,255,0.3)" },
  processing:  { label: "PROCESSING",    color: "hsl(38 100% 62%)",  glow: "0 0 12px rgba(255,160,0,0.55), 0 0 28px rgba(255,160,0,0.2)" },
  error:       { label: "ERROR",         color: "hsl(355 80% 62%)",  glow: "0 0 12px rgba(255,60,60,0.55), 0 0 28px rgba(255,60,60,0.2)" },
};

function inferStatus(message: string): AgentStatus {
  if (/\b(latest|current|recent|today|news|search|find|look up|weather|stock|price|happening)\b/i.test(message))
    return "researching";
  if (/\b(code|debug|function|bug|error|script|javascript|typescript|python|react|css|html|api|fix)\b/i.test(message))
    return "processing";
  return "thinking";
}

interface Source {
  title: string;
  url: string;
  description: string;
}

interface PatchProposalRef {
  patchId:     string;
  file:        string;
  description: string;
  riskLevel?:  "low" | "medium" | "high";
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  sources?: Source[];
  isSearch?: boolean;
  isFakeSearch?: boolean;
  debug?: DebugInfo;
  toolCalls?: ToolCallInfo[];
  plan?: FrontendPlan;
  autoRouted?: boolean;
  /** Set when Jarvis's propose_code_change tool queues a patch for approval */
  patchProposal?: PatchProposalRef;
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function TypingIndicator({ status }: { status: AgentStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.thinking;
  return (
    <div className="flex items-end gap-3 message-enter" data-testid="typing-indicator">
      <div
        className="w-8 h-8 rounded-full bg-primary/10 border border-primary/40 flex items-center justify-center flex-shrink-0 transition-all duration-500"
        style={{ boxShadow: cfg.glow }}
      >
        <span className="font-display text-xs font-bold transition-colors duration-500" style={{ color: cfg.color }}>J</span>
      </div>
      <div className="bg-card border border-card-border rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="typing-dot w-1.5 h-1.5 rounded-full transition-colors duration-500" style={{ background: cfg.color }} />
          <span className="typing-dot w-1.5 h-1.5 rounded-full transition-colors duration-500" style={{ background: cfg.color }} />
          <span className="typing-dot w-1.5 h-1.5 rounded-full transition-colors duration-500" style={{ background: cfg.color }} />
        </div>
        <span className="text-xs font-display tracking-widest transition-colors duration-500" style={{ color: cfg.color, opacity: 0.65 }}>
          {cfg.label}
        </span>
      </div>
    </div>
  );
}

function SourceCard({ source, index }: { source: Source; index: number }) {
  const hostname = (() => {
    try {
      return new URL(source.url).hostname.replace("www.", "");
    } catch {
      return source.url;
    }
  })();
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={`source-link-${index}`}
      className="flex items-start gap-3 p-3 rounded-xl border border-primary/20 bg-primary/5 hover:border-primary/40 hover:bg-primary/10 transition-all duration-200 group"
    >
      <div className="flex-shrink-0 mt-0.5 w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center">
        <span
          className="font-display text-xs font-bold"
          style={{ color: "hsl(194 100% 60%)" }}
        >
          {index + 1}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <p
            className="text-xs font-semibold truncate leading-tight"
            style={{ color: "hsl(194 100% 75%)" }}
          >
            {source.title}
          </p>
          <ExternalLink
            className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: "hsl(194 100% 60%)" }}
          />
        </div>
        <p
          className="text-xs mb-1 leading-snug line-clamp-2"
          style={{ color: "hsl(196 40% 55%)" }}
        >
          {source.description}
        </p>
        <p className="text-xs font-mono" style={{ color: "hsl(194 100% 45%)" }}>
          {hostname}
        </p>
      </div>
    </a>
  );
}

function MessageBubble({
  message,
  showDebug,
  isStreaming,
  isSpeaking,
  onSpeak,
  onStopSpeak,
}: {
  message: Message;
  showDebug: boolean;
  isStreaming: boolean;
  isSpeaking: boolean;
  onSpeak: () => void;
  onStopSpeak: () => void;
}) {
  // nothing extra — patchProposal lives on message and ChatPatchProposal owns its state
  const isUser = message.role === "user";
  const timeStr = message.timestamp.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (isUser) {
    return (
      <div
        className="flex items-end gap-3 justify-end message-enter"
        data-testid={`message-user-${message.id}`}
      >
        <div className="flex flex-col items-end gap-1 max-w-[80%]">
          {message.autoRouted && (
            <span
              className="text-xs font-mono px-2 py-0.5 rounded-full mb-0.5"
              style={{ background: "hsl(270 80% 55% / 0.15)", color: "hsl(270 100% 78%)", border: "1px solid hsl(270 100% 65% / 0.3)" }}
            >
              ⚡ Auto-routed to Planner
            </span>
          )}
          <div className="bg-primary/15 border border-primary/30 rounded-2xl rounded-br-sm px-4 py-3 glow-primary">
            <p
              className="text-sm leading-relaxed"
              style={{ color: "hsl(196 100% 85%)" }}
            >
              {message.content}
            </p>
          </div>
          <span className="text-xs text-muted-foreground px-1">{timeStr}</span>
        </div>
        <div className="w-8 h-8 rounded-full bg-accent/20 border border-accent/50 flex items-center justify-center flex-shrink-0">
          <span
            className="text-xs font-semibold font-display"
            style={{ color: "hsl(264 80% 80%)" }}
          >
            U
          </span>
        </div>
      </div>
    );
  }

  const toolCalls = message.toolCalls ?? [];

  return (
    <div
      className="flex items-start gap-3 message-enter"
      data-testid={`message-assistant-${message.id}`}
    >
      <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/40 flex items-center justify-center flex-shrink-0 pulse-glow mt-0.5">
        <span className="font-display text-primary text-xs font-bold">J</span>
      </div>

      <div className="flex flex-col gap-2 max-w-[85%] sm:max-w-[80%] min-w-0">
        {/* Search / web badge */}
        {message.isSearch && (
          <div className="flex items-center gap-1.5 px-1">
            <Search
              className="w-3 h-3"
              style={{ color: "hsl(194 100% 55%)" }}
            />
            <span
              className="text-xs tracking-wider font-medium"
              style={{ color: "hsl(194 100% 55%)" }}
            >
              {message.isFakeSearch ? "DEMO SEARCH" : "WEB SEARCH"}
            </span>
          </div>
        )}

        {/* Tool status chips — shown above the main bubble */}
        {toolCalls.length > 0 && <ToolStatusBubble calls={toolCalls} />}

        {/* Plan card — shown for plan messages */}
        {message.plan && <PlanCard plan={message.plan} />}

        {/* Main bubble — only rendered when there's content OR streaming */}
        {(message.content || isStreaming) && (
          <div className="bg-card border border-card-border rounded-2xl rounded-tl-sm px-4 py-3 min-w-0">
            <MarkdownContent content={message.content} />
            {isStreaming && (
              <span className="streaming-cursor" aria-hidden="true" />
            )}
          </div>
        )}

        {/* Source cards */}
        {message.sources && message.sources.length > 0 && (
          <div
            className="flex flex-col gap-2 px-1"
            data-testid="search-sources"
          >
            {message.sources.map((s, i) => (
              <SourceCard key={i} source={s} index={i} />
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 px-1">
          <span className="text-xs text-muted-foreground">{timeStr}</span>
          {!isStreaming && message.content && (
            <button
              onClick={isSpeaking ? onStopSpeak : onSpeak}
              aria-label={isSpeaking ? "Stop speaking" : "Read aloud"}
              title={isSpeaking ? "Stop" : "Read aloud"}
              className="flex items-center justify-center w-5 h-5 rounded opacity-40 hover:opacity-100 transition-opacity duration-150"
              style={{ color: isSpeaking ? "hsl(355 80% 62%)" : "hsl(194 100% 55%)" }}
            >
              {isSpeaking
                ? <VolumeX className="w-3.5 h-3.5" />
                : <Volume2 className="w-3.5 h-3.5" />
              }
            </button>
          )}
        </div>

        {/* Patch proposal — real Approve/Reject buttons when Jarvis proposes a code change */}
        {message.patchProposal && (
          <ChatPatchProposal proposal={message.patchProposal} />
        )}

        {/* Debug panel — shown only when debug mode is on */}
        {showDebug && message.debug && <DebugPanel debug={message.debug} />}
      </div>
    </div>
  );
}

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

// ─── PatchCard ────────────────────────────────────────────────────────────────

function PatchCard({
  patch,
  onRemove,
}: {
  patch: PendingPatchSummary;
  onRemove: (id: string) => void;
}) {
  const [status, setStatus] = useState<"idle" | "applying" | "done" | "error">("idle");
  const [applyError, setApplyError] = useState<string | null>(null);

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
      setTimeout(() => onRemove(patch.patchId), 1400);
    } else {
      setStatus("error");
      setApplyError(result.error ?? "Apply failed");
    }
  };

  const handleDecline = async () => {
    await logRejectPatch(patch.patchId, patch.file);
    onRemove(patch.patchId);
  };

  return (
    <div
      className="rounded-2xl border flex flex-col gap-3 p-4"
      style={{ background: "hsl(210 15% 7%)", borderColor: "hsl(210 15% 16%)" }}
    >
      {/* Header row */}
      <div className="flex items-start gap-3">
        <p className="flex-1 text-sm font-semibold leading-snug" style={{ color: "hsl(196 80% 85%)" }}>
          {patch.description}
        </p>
        {patch.riskLevel && (
          <span
            className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border"
            style={{
              color: RISK_COLOR[patch.riskLevel] ?? "hsl(196 60% 60%)",
              borderColor: `${RISK_COLOR[patch.riskLevel] ?? "hsl(196 60% 60%)"}44`,
            }}
          >
            {patch.riskLevel.toUpperCase()}
          </span>
        )}
      </div>

      {/* File */}
      <div className="flex items-center gap-2">
        <Code2 className="w-3 h-3 flex-shrink-0" style={{ color: "hsl(196 40% 42%)" }} />
        <span className="text-xs font-mono truncate" style={{ color: "hsl(196 60% 58%)" }}>
          {patch.file}
        </span>
      </div>

      {/* Impact notes */}
      {(patch.uiImpact || patch.logicImpact) && (
        <div className="text-xs space-y-0.5" style={{ color: "hsl(196 25% 50%)" }}>
          {patch.uiImpact   && <div>UI: {patch.uiImpact}</div>}
          {patch.logicImpact && <div>Logic: {patch.logicImpact}</div>}
        </div>
      )}

      {/* Status feedback */}
      {status === "error" && applyError && (
        <div
          className="text-xs rounded-xl px-3 py-2"
          style={{ background: "hsl(355 80% 14%)", color: "hsl(355 80% 68%)", border: "1px solid hsl(355 80% 28%)" }}
        >
          ✖ {applyError}
        </div>
      )}
      {status === "done" && (
        <div
          className="text-xs rounded-xl px-3 py-2"
          style={{ background: "hsl(142 60% 11%)", color: "hsl(142 71% 62%)", border: "1px solid hsl(142 60% 22%)" }}
        >
          ✓ Applied successfully
        </div>
      )}

      {/* Action buttons */}
      {status !== "done" && (
        <div className="flex gap-2">
          <button
            onClick={handleAccept}
            disabled={status === "applying"}
            className="flex-1 py-2 rounded-xl text-xs font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40"
            style={{
              background: "hsl(142 60% 35% / 0.18)",
              border: "1px solid hsl(142 60% 38%)",
              color: "hsl(142 71% 62%)",
            }}
          >
            {status === "applying" ? "APPLYING…" : "✓  ACCEPT"}
          </button>
          <button
            onClick={handleDecline}
            disabled={status === "applying"}
            className="flex-1 py-2 rounded-xl text-xs font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40"
            style={{
              background: "hsl(355 80% 35% / 0.14)",
              border: "1px solid hsl(355 80% 38% / 0.6)",
              color: "hsl(355 80% 64%)",
            }}
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
  const [devSection,   setDevSection]   = useState<"chat"|"patches">("chat");
  const devChatEndRef = useRef<HTMLDivElement>(null);

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
    if (!trimmed || devSending) return;
    setDevMessages(prev => [...prev, { id: `du-${Date.now()}`, role: "user", content: trimmed }]);
    setDevInput("");
    setDevSending(true);
    setDevSection("chat");
    const assistantId = `da-${Date.now()}`;
    setDevMessages(prev => [...prev, { id: assistantId, role: "assistant", content: "" }]);
    try {
      const res = await fetch(`${BASE}api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, sessionId: `dev-${sessionId}` }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = (buf + decoder.decode(value, { stream: true })).split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === "[DONE]") continue;
          try {
            const evt = JSON.parse(raw) as { type: string; text?: string; content?: string };
            const piece = evt.type === "token" ? (evt.text ?? evt.content ?? "") : "";
            if (piece) setDevMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: m.content + piece } : m));
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      setDevMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, content: `⚠ ${String(err)}` } : m,
      ));
    } finally {
      setDevSending(false);
    }
  }, [BASE, sessionId, devSending]);

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
    <div className="flex flex-col h-[100dvh] w-full bg-background scan-overlay overflow-hidden">
      <div className="fixed inset-0 bg-grid opacity-60 pointer-events-none" />
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-96 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed bottom-24 right-8 w-64 h-64 bg-accent/5 rounded-full blur-3xl pointer-events-none" />

      {/* ── Header ── */}
      <header className="relative z-10 flex-shrink-0 border-b border-border/60 bg-background/90 backdrop-blur-sm">
        <div className="flex items-center justify-between px-4 sm:px-8 py-3 pt-safe">
        <div className="flex items-center gap-2.5">
          <div
            className="relative w-9 h-9 rounded-xl bg-primary/10 border border-primary/40 flex items-center justify-center flex-shrink-0 transition-all duration-700"
            style={{ boxShadow: STATUS_CONFIG[agentStatus].glow }}
          >
            <span
              className="font-display font-black text-base transition-colors duration-700"
              style={{ color: STATUS_CONFIG[agentStatus].color }}
            >J</span>
            <div
              className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full animate-pulse transition-colors duration-700"
              style={{ background: STATUS_CONFIG[agentStatus].color }}
            />
          </div>
          <div>
            <h1
              className="font-display font-bold text-lg sm:text-2xl tracking-widest glow-primary-text leading-none"
              style={{ color: "hsl(194 100% 60%)" }}
            >
              JARVIS
            </h1>
            <p
              className="hidden sm:block text-xs tracking-widest mt-0.5"
              style={{ color: "hsl(196 40% 50%)" }}
            >
              AGENT v2 · INTENT ROUTING · WEB SEARCH
            </p>
          </div>
        </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* ONLINE — compact, desktop only */}
            <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-full border border-primary/30 bg-primary/5">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs font-medium tracking-wider" style={{ color: "hsl(142 71% 60%)" }}>ONLINE</span>
            </div>
            {/* Auto-speak */}
            {speech.isSupported && (
              <button
                onClick={() => { speech.unlock(); speech.setAutoSpeak(!speech.autoSpeak); }}
                className="w-8 h-8 rounded-xl border flex items-center justify-center transition-all duration-200 active:scale-95"
                style={{ background: speech.autoSpeak ? "hsl(142 60% 40% / 0.15)" : "transparent", borderColor: speech.autoSpeak ? "hsl(142 60% 40% / 0.45)" : "hsl(210 15% 25%)" }}
                aria-label={speech.autoSpeak ? "Disable auto-speak" : "Enable auto-speak"}
              >
                {speech.autoSpeak ? <Volume2 className="w-4 h-4" style={{ color: "hsl(142 71% 60%)" }} /> : <VolumeX className="w-4 h-4" style={{ color: "hsl(196 40% 40%)" }} />}
              </button>
            )}
            {/* Memory */}
            <button
              onClick={() => setPanelOpen(true)}
              data-testid="button-open-memory"
              className="relative w-8 h-8 rounded-xl border border-border/60 bg-card flex items-center justify-center hover:border-primary/40 active:scale-95 transition-all"
              aria-label="Open memory panel"
            >
              <Brain className="w-4 h-4" style={{ color: "hsl(194 100% 55%)" }} />
              {(memory?.messageCount ?? 0) > 0 && (
                <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-primary rounded-full" />
              )}
            </button>
          </div>
        </div>

        {/* ── Tab bar — horizontally scrollable, 6 primary tabs ─────────── */}
        <div
          className="flex gap-1 px-3 pb-2 overflow-x-auto"
          style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" } as React.CSSProperties}
        >
          {(["chat", "tasks", "diag", "status", "debug", "dev"] as const).map((tab) => {
            const cfg = {
              chat:   { label: "CHAT",   active: "hsl(194 100% 65%)", border: "hsl(194 100% 55% / 0.55)", bg: "hsl(194 100% 55% / 0.12)" },
              tasks:  { label: "TASKS",  active: "hsl(150 70% 65%)",  border: "hsl(150 60% 45% / 0.55)", bg: "hsl(150 60% 45% / 0.12)" },
              diag:   { label: "DIAG",   active: "hsl(264 80% 72%)",  border: "hsl(264 80% 55% / 0.55)", bg: "hsl(264 80% 55% / 0.12)" },
              status: { label: "STATUS", active: "hsl(38 100% 70%)",  border: "hsl(38 100% 55% / 0.55)",  bg: "hsl(38 100% 55% / 0.12)" },
              debug:  { label: "DEBUG",  active: "hsl(196 100% 65%)", border: "hsl(196 100% 55% / 0.55)", bg: "hsl(196 100% 55% / 0.12)" },
              dev:    { label: "DEV",    active: "hsl(194 100% 65%)", border: "hsl(194 100% 50% / 0.55)", bg: "hsl(194 100% 50% / 0.12)" },
            }[tab];
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => {
                  setActiveTab(tab);
                  if (tab === "tasks")  setTasksPanelOpen(true);
                  if (tab === "diag")   setDiagPanelOpen(true);
                  if (tab === "status") setStatusPanelOpen(true);
                }}
                className="flex-shrink-0 px-3 py-1.5 rounded-xl text-[10px] font-bold tracking-widest transition-all duration-200 active:scale-95"
                style={{
                  whiteSpace: "nowrap",
                  background:  isActive ? cfg.bg    : "transparent",
                  border:      `1px solid ${isActive ? cfg.border : "hsl(210 15% 24%)"}`,
                  color:       isActive ? cfg.active : "hsl(196 20% 40%)",
                }}
              >
                {cfg.label}
              </button>
            );
          })}
        </div>
      </header>

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
        <div className="relative z-10 flex-1 flex flex-col overflow-hidden">

          {/* Action buttons strip */}
          <div
            className="flex-shrink-0 flex gap-1.5 px-4 py-2.5 border-b border-border/30 overflow-x-auto"
            style={{ scrollbarWidth: "none" } as React.CSSProperties}
          >
            {([
              { label: "SCAN PROJECT", prompt: "Scan this project's file structure, list all key components, API routes, and libraries used. Highlight any obvious quality issues or improvement areas." },
              { label: "PROPOSE FIX",  prompt: "Review the most recent debug logs and the current codebase state. Propose a specific, actionable code fix for the most critical issue you find." },
              { label: "BUILD/TEST",   prompt: "Check the TypeScript compilation status for both the api-server and jarvas packages. List any errors, warnings, or type issues." },
              { label: "CREATE PATCH", prompt: "Based on our conversation so far, create a concrete code patch for the most recently discussed fix and queue it for review." },
            ] as const).map(({ label, prompt }) => (
              <button
                key={label}
                onClick={() => sendDevMessage(prompt)}
                disabled={devSending}
                className="flex-shrink-0 px-3 py-1.5 rounded-xl text-[10px] font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40"
                style={{ background: "hsl(194 100% 55% / 0.10)", border: "1px solid hsl(194 100% 55% / 0.35)", color: "hsl(194 100% 68%)", whiteSpace: "nowrap" }}
              >
                {label}
              </button>
            ))}
            <button
              onClick={() => fetchPendingPatches().then(setPendingPatches)}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold tracking-widest transition-all active:scale-95"
              style={{ background: "transparent", border: "1px solid hsl(210 15% 24%)", color: "hsl(196 30% 44%)", whiteSpace: "nowrap" }}
            >
              <RefreshCw className="w-3 h-3" />
              REFRESH PATCHES
            </button>
          </div>

          {/* Sub-tab selector: CHAT | PATCHES */}
          <div className="flex-shrink-0 flex gap-1 px-4 pt-2 pb-1">
            {(["chat", "patches"] as const).map((sec) => {
              const isActive = devSection === sec;
              const label    = sec === "chat" ? "CHAT" : `PATCHES${pendingPatches.length ? ` (${pendingPatches.length})` : ""}`;
              return (
                <button
                  key={sec}
                  onClick={() => setDevSection(sec)}
                  className="px-3 py-1 rounded-lg text-[10px] font-bold tracking-widest transition-all"
                  style={{
                    background: isActive ? "hsl(194 100% 55% / 0.14)" : "transparent",
                    border:     `1px solid ${isActive ? "hsl(194 100% 55% / 0.45)" : "hsl(210 15% 22%)"}`,
                    color:      isActive ? "hsl(194 100% 70%)" : "hsl(196 20% 38%)",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* ── CHAT sub-section ── */}
          {devSection === "chat" && (
            <>
              <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 flex flex-col gap-3">
                {devMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 py-16">
                    <Code2 className="w-10 h-10" style={{ color: "hsl(194 100% 38%)" }} />
                    <p className="text-sm tracking-wide" style={{ color: "hsl(196 25% 40%)" }}>Dev coding assistant</p>
                    <p className="text-xs text-center max-w-xs leading-relaxed" style={{ color: "hsl(196 20% 30%)" }}>
                      Ask about the codebase, request bug fixes, or use the action buttons above.
                    </p>
                  </div>
                ) : (
                  devMessages.map((msg) => (
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
                  ))
                )}
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
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void sendDevMessage(devInput);
                      }
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

          {/* ── PATCHES sub-section ── */}
          {devSection === "patches" && (
            <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4">
              {pendingPatches.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <ShieldCheck className="w-10 h-10" style={{ color: "hsl(142 60% 30%)" }} />
                  <p className="text-sm tracking-wide" style={{ color: "hsl(196 25% 40%)" }}>No pending patches</p>
                  <p className="text-xs text-center max-w-xs leading-relaxed" style={{ color: "hsl(196 20% 30%)" }}>
                    Use the CREATE PATCH action or ask Jarvis to propose a fix in the chat tab.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-3 max-w-2xl mx-auto">
                  {pendingPatches.map((patch) => (
                    <PatchCard
                      key={patch.patchId}
                      patch={patch}
                      onRemove={(id) => setPendingPatches((prev) => prev.filter((p) => p.patchId !== id))}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Message list ── */}
      <main
        className={`relative z-10 overflow-y-auto scrollbar-thin px-4 sm:px-8 py-6 ${activeTab === "debug" || activeTab === "dev" ? "hidden" : "flex-1"}`}
        data-testid="chat-messages"
      >
        <div className="max-w-3xl mx-auto flex flex-col gap-5">
          {/* Summary badge */}
          {memory?.summary && !isLoadingHistory && (
            <div className="flex items-center gap-2 py-2 px-3 rounded-xl bg-primary/5 border border-primary/20">
              <Brain
                className="w-3 h-3 flex-shrink-0"
                style={{ color: "hsl(194 100% 55%)" }}
              />
              <p className="text-xs" style={{ color: "hsl(194 100% 55%)" }}>
                Older messages are summarized in memory.{" "}
                <button
                  className="underline hover:no-underline"
                  onClick={() => setPanelOpen(true)}
                >
                  View summary
                </button>
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              showDebug={debugMode}
              isStreaming={isStreaming && msg.id === streamingMsgId}
              isSpeaking={speech.isSpeakingMsg(msg.id)}
              onSpeak={() => speech.toggle(msg.id, msg.content)}
              onStopSpeak={speech.stop}
            />
          ))}

          {isTyping && <TypingIndicator status={agentStatus} />}
          <div ref={messagesEndRef} />
        </div>
      </main>

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

      {/* ── Input bar ── */}
      <footer className={`relative z-10 flex-shrink-0 border-t border-border/60 bg-background/90 backdrop-blur-sm px-3 sm:px-8 pt-3 pb-safe ${activeTab === "debug" || activeTab === "dev" ? "hidden" : ""}`}
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="max-w-3xl mx-auto">
          {/* Auto-planner toggle row */}
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-xs" style={{ color: "hsl(196 20% 38%)" }}>Auto-route complex tasks to Planner</span>
            <button
              type="button"
              onClick={() => setAutoPlannerEnabled(v => { const n = !v; setAutoPlannerEnabledStorage(n); return n; })}
              className="relative w-8 h-4 rounded-full transition-colors duration-200 flex-shrink-0"
              style={{ background: autoPlannerEnabled ? "hsl(270 70% 50% / 0.7)" : "hsl(210 15% 20%)", border: `1px solid ${autoPlannerEnabled ? "hsl(270 100% 65% / 0.5)" : "hsl(210 15% 26%)"}` }}
              aria-label={autoPlannerEnabled ? "Disable auto-planner" : "Enable auto-planner"}
              title={autoPlannerEnabled ? "Auto-Planner ON" : "Auto-Planner OFF"}
            >
              <span className="absolute top-0.5 w-3 h-3 rounded-full transition-all duration-200" style={{ background: autoPlannerEnabled ? "hsl(270 100% 82%)" : "hsl(210 15% 42%)", left: autoPlannerEnabled ? "calc(100% - 13px)" : "1px" }} />
            </button>
          </div>
          <div className="flex items-end gap-2.5 bg-card border border-border rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3 focus-within:border-primary/60 focus-within:glow-primary transition-all duration-200">
            <textarea
              ref={textareaRef}
              data-testid="input-message"
              className="flex-1 bg-transparent resize-none outline-none text-sm leading-relaxed placeholder:text-muted-foreground min-h-[24px] max-h-[120px] scrollbar-thin"
              style={{ color: "hsl(196 80% 85%)" }}
              placeholder="Message Jarvis… ask anything, search the web, build apps, or open DEV."
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              rows={1}
            />

            {/* Mic button — hidden if speech not supported */}
            {speechInput.isSupported && (
              <div className="relative flex-shrink-0">
                {speechInput.isListening && (
                  <span className="mic-recording-ring" aria-hidden="true" />
                )}
                <button
                  data-testid="button-mic"
                  onClick={toggleMic}
                  disabled={isTyping || isStreaming}
                  aria-label={speechInput.isListening ? "Stop recording" : "Voice input"}
                  title={
                    speechInput.permissionDenied
                      ? "Microphone access denied"
                      : speechInput.isListening
                        ? "Stop recording"
                        : "Voice input"
                  }
                  className="w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{
                    background: speechInput.isListening
                      ? "hsl(355 80% 28% / 0.4)"
                      : "hsl(194 100% 55% / 0.12)",
                    border: `1px solid ${speechInput.isListening ? "hsl(355 80% 50%)" : "hsl(194 100% 55% / 0.3)"}`,
                    color: speechInput.isListening
                      ? "hsl(355 80% 62%)"
                      : speechInput.permissionDenied
                        ? "hsl(196 20% 35%)"
                        : "hsl(194 100% 55%)",
                  }}
                >
                  {speechInput.isListening
                    ? <MicOff className={`w-4 h-4 mic-recording`} />
                    : <Mic className="w-4 h-4" />
                  }
                </button>
              </div>
            )}

            {/* ── Plan button (BRIGHT PURPLE = planner path) ───────── */}
            <button
              data-testid="button-plan"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                console.log("[Planner] BUTTON CLICKED — input:", JSON.stringify(input.trim()), "isTyping:", isTyping, "isStreaming:", isStreaming);
                sendPlan();
              }}
              disabled={!input.trim() || isTyping || isStreaming}
              title="Run autonomous plan"
              aria-label="Run autonomous plan"
              className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                border: "2px solid hsl(270 100% 65%)",
                background: "hsl(270 80% 55% / 0.18)",
              }}
            >
              <ListChecks className="w-4 h-4" style={{ color: "hsl(270 100% 75%)" }} />
            </button>

            {/* ── Send button ──────────────────────────────────────── */}
            <button
              data-testid="button-send"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                console.log("[Chat] sendMessage entered from send button");
                sendMessage();
              }}
              disabled={!input.trim() || isTyping || isStreaming}
              className="flex-shrink-0 w-9 h-9 rounded-xl bg-primary flex items-center justify-center transition-all duration-200 hover:bg-primary/80 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed glow-primary"
              aria-label="Send message"
            >
              <Send className="w-4 h-4" style={{ color: "hsl(220 20% 6%)" }} />
            </button>
          </div>
          {/* Footer hint — desktop only */}
          <p className="hidden sm:block text-center text-xs mt-2 tracking-wider" style={{ color: "hsl(196 30% 40%)" }}>
            Intent-routed · Web search · Persistent memory · Press ⌘ to toggle debug
          </p>
        </div>
      </footer>

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

    </div>
  );
}

