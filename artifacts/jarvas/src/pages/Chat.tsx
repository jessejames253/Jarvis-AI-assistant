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
  Map,
  Users,
  Network,
  ClipboardList,
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
  onError: () => void,
  onToolEvent?: (event: ToolSSEEvent) => void,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${base}api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sessionId }),
    });
  } catch {
    onError();
    return;
  }

  if (!res.ok || !res.body) { onError(); return; }

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
          const event = JSON.parse(jsonStr) as Record<string, unknown>;
          const evType = event.type as string;
          if (evType === "token" && typeof event.text === "string") {
            onToken(event.text);
          } else if (evType === "done") {
            onDone(event as unknown as StreamDonePayload);
          } else if (evType === "error") {
            onError();
          } else if (
            (evType === "tool_start" || evType === "tool_done" || evType === "tool_error") &&
            onToolEvent
          ) {
            onToolEvent(event as unknown as ToolSSEEvent);
          }
        } catch { /* ignore malformed SSE lines */ }
      }
    }
  } catch {
    onError();
  }
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

const BASE = import.meta.env.BASE_URL;
console.log("[Jarvis] Chat module loaded v2 — BASE:", BASE);

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

  useEffect(() => {
    localStorage.setItem(DEV_PANEL_KEY, String(devPanelOpen));
  }, [devPanelOpen]);

  // Poll server status every 30 s to detect restarts and recover patch records.
  useEffect(() => {
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
  useEffect(() => {
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
    // Persistently delete from server queue (async, non-blocking)
    void logRejectPatch(patch.patchId, patch.file);
    setDismissedIds(prev => new Set([...prev, patch.patchId]));
    setPendingPatches(prev => prev.filter(p => p.patchId !== patch.patchId));
  }, []);

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
    console.log("[Chat] sendMessage entered — input:", JSON.stringify(input.trim()));
    const text = input.trim();
    if (!text || isTyping || isStreaming) return;

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

    speech.unlock();
    responseContentRef.current = "";

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);
    setAgentStatus(inferStatus(text));
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setMemory((prev) =>
      prev ? { ...prev, messageCount: prev.messageCount + 1 } : prev,
    );

    const msgId = `assistant-${Date.now()}`;
    let messageCreated = false;
    // Keep a stable ref to msgId for the buffer flush callbacks
    const currentMsgId = msgId;

    // Accumulates tool calls during streaming (updated via setMessages)
    const pendingToolCalls = new Map<string, ToolCallInfo>();

    /** Create the assistant message in state if not yet created */
    function ensureMessageCreated(initialContent = "") {
      if (messageCreated) return;
      messageCreated = true;
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

    const streamStartTime = Date.now();
    _rt.bus.emit({ type: "stream:start", sessionId, ts: Date.now() });

    const handleError = () => {
      _rt.bus.emit({ type: "stream:error", error: "SSE stream failed", ts: Date.now() });
      if (messageCreated) {
        setIsStreaming(false);
        setStreamingMsgId(null);
        flushTokenBuffer(currentMsgId, true);
      } else {
        setIsTyping(false);
      }
      setAgentStatus("error");
      setTimeout(() => setAgentStatus("idle"), 2500);
      if (!messageCreated) {
        setMessages((prev) => [
          ...prev,
          { id: currentMsgId, role: "assistant", content: "Something went wrong on my end. Please try again.", timestamp: new Date() },
        ]);
      }
    };

    await callChatStream(
      text,
      sessionId,
      BASE,
      // onToken
      (tokenText) => {
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
        flushTokenBuffer(currentMsgId, true);
        _rt.bus.emit({ type: "stream:done", sessionId, durationMs: Date.now() - streamStartTime, tokens: responseContentRef.current.length, ts: Date.now() });
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
      <header
        className="relative z-10 flex-shrink-0 flex items-center justify-between px-4 sm:px-8 py-3 sm:py-4 border-b border-border/60 bg-background/90 backdrop-blur-sm pt-safe"
      >
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

        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* ONLINE badge — desktop only */}
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs font-medium tracking-wider" style={{ color: "hsl(142 71% 60%)" }}>
              ONLINE
            </span>
          </div>

          {/* Knowledge Base */}
          <button
            onClick={() => navigate("/kb")}
            title="Notes"
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl border border-border/60 bg-card flex items-center justify-center hover:border-primary/40 active:scale-95 transition-all"
            aria-label="Open Knowledge Base"
          >
            <BookOpen className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: "hsl(264 80% 70%)" }} />
          </button>

          {/* Dashboard */}
          <button
            onClick={() => navigate("/dashboard")}
            title="Dashboard"
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl border border-border/60 bg-card flex items-center justify-center hover:border-primary/40 active:scale-95 transition-all"
            aria-label="Open dashboard"
          >
            <LayoutDashboard className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: "hsl(194 100% 55%)" }} />
          </button>

          {/* Tasks panel — visible on all screen sizes */}
          <button
            onClick={() => setTasksPanelOpen(v => !v)}
            title="Jarvis task list"
            className="flex items-center gap-1 px-2 h-8 sm:h-9 rounded-xl border transition-all duration-200 active:scale-95"
            style={{
              background:  tasksPanelOpen ? "hsl(150 60% 45% / 0.12)" : "transparent",
              borderColor: tasksPanelOpen ? "hsl(150 60% 45% / 0.5)" : "hsl(210 15% 30%)",
            }}
            aria-label="Open task list"
          >
            <ListChecks className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: tasksPanelOpen ? "hsl(150 70% 65%)" : "hsl(196 60% 55%)" }} />
            <span className="text-[10px] sm:text-xs font-bold tracking-widest" style={{ color: tasksPanelOpen ? "hsl(150 70% 65%)" : "hsl(196 60% 55%)" }}>TASKS</span>
          </button>

          {/* Diagnostics */}
          <button
            onClick={() => setDiagPanelOpen(v => !v)}
            title="Build & system diagnostics"
            className="flex items-center gap-1 px-2 h-8 sm:h-9 rounded-xl border transition-all duration-200 active:scale-95"
            style={{
              background:  diagPanelOpen ? "hsl(264 80% 55% / 0.12)" : "transparent",
              borderColor: diagPanelOpen ? "hsl(264 80% 55% / 0.5)" : "hsl(210 15% 30%)",
            }}
            aria-label="Open diagnostics"
          >
            <Activity className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: diagPanelOpen ? "hsl(264 80% 72%)" : "hsl(196 60% 55%)" }} />
            <span className="text-[10px] sm:text-xs font-bold tracking-widest" style={{ color: diagPanelOpen ? "hsl(264 80% 72%)" : "hsl(196 60% 55%)" }}>DIAG</span>
          </button>

          {/* System Status */}
          <button
            onClick={() => setStatusPanelOpen(v => !v)}
            title="System status overview"
            className="flex items-center gap-1 px-2 h-8 sm:h-9 rounded-xl border transition-all duration-200 active:scale-95"
            style={{
              background:  statusPanelOpen ? "hsl(38 100% 55% / 0.12)" : "transparent",
              borderColor: statusPanelOpen ? "hsl(38 100% 55% / 0.5)" : "hsl(210 15% 30%)",
            }}
            aria-label="Open system status"
          >
            <Gauge className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: statusPanelOpen ? "hsl(38 100% 70%)" : "hsl(196 60% 55%)" }} />
            <span className="text-[10px] sm:text-xs font-bold tracking-widest" style={{ color: statusPanelOpen ? "hsl(38 100% 70%)" : "hsl(196 60% 55%)" }}>STATUS</span>
          </button>

          {/* Activity Logs */}
          <button
            onClick={() => setLogsPanelOpen(v => !v)}
            title="Activity logs"
            className="flex items-center gap-1 px-2 h-8 sm:h-9 rounded-xl border transition-all duration-200 active:scale-95"
            style={{
              background:  logsPanelOpen ? "hsl(196 100% 45% / 0.12)" : "transparent",
              borderColor: logsPanelOpen ? "hsl(196 100% 55% / 0.5)" : "hsl(210 15% 30%)",
            }}
            aria-label="Open activity logs"
          >
            <ScrollText className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: logsPanelOpen ? "hsl(196 100% 65%)" : "hsl(196 60% 55%)" }} />
            <span className="text-[10px] sm:text-xs font-bold tracking-widest" style={{ color: logsPanelOpen ? "hsl(196 100% 65%)" : "hsl(196 60% 55%)" }}>LOGS</span>
          </button>

          {/* Agent Actions */}
          <button
            onClick={() => setActionsPanelOpen(v => !v)}
            title="Agent action approvals"
            className="flex items-center gap-1 px-2 h-8 sm:h-9 rounded-xl border transition-all duration-200 active:scale-95"
            style={{
              background:  actionsPanelOpen ? "hsl(320 80% 55% / 0.12)" : "transparent",
              borderColor: actionsPanelOpen ? "hsl(320 80% 55% / 0.5)" : "hsl(210 15% 30%)",
            }}
            aria-label="Open agent actions"
          >
            <ShieldCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: actionsPanelOpen ? "hsl(320 80% 72%)" : "hsl(196 60% 55%)" }} />
            <span className="text-[10px] sm:text-xs font-bold tracking-widest" style={{ color: actionsPanelOpen ? "hsl(320 80% 72%)" : "hsl(196 60% 55%)" }}>ACTIONS</span>
          </button>

          {/* Checkpoints */}
          <button
            onClick={() => setCheckpointsPanelOpen(v => !v)}
            title="Checkpoint rollback & recovery"
            className="flex items-center gap-1 px-2 h-8 sm:h-9 rounded-xl border transition-all duration-200 active:scale-95"
            style={{
              background:  checkpointsPanelOpen ? "hsl(150 70% 45% / 0.12)" : "transparent",
              borderColor: checkpointsPanelOpen ? "hsl(150 70% 45% / 0.5)" : "hsl(210 15% 30%)",
            }}
            aria-label="Open checkpoints panel"
          >
            <History className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: checkpointsPanelOpen ? "hsl(150 70% 68%)" : "hsl(196 60% 55%)" }} />
            <span className="text-[10px] sm:text-xs font-bold tracking-widest" style={{ color: checkpointsPanelOpen ? "hsl(150 70% 68%)" : "hsl(196 60% 55%)" }}>CHECKPOINTS</span>
          </button>

          {/* Executions */}
          <button
            onClick={() => setExecutionsPanelOpen(v => !v)}
            title="Safe execution engine — queue and history"
            className="flex items-center gap-1 px-2 h-8 sm:h-9 rounded-xl border transition-all duration-200 active:scale-95"
            style={{
              background:  executionsPanelOpen ? "hsl(38 100% 55% / 0.12)" : "transparent",
              borderColor: executionsPanelOpen ? "hsl(38 100% 55% / 0.5)"  : "hsl(210 15% 30%)",
            }}
            aria-label="Open executions panel"
          >
            <Cpu className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: executionsPanelOpen ? "hsl(38 100% 72%)" : "hsl(196 60% 55%)" }} />
            <span className="text-[10px] sm:text-xs font-bold tracking-widest" style={{ color: executionsPanelOpen ? "hsl(38 100% 72%)" : "hsl(196 60% 55%)" }}>EXECUTIONS</span>
          </button>

          {/* Autonomous Dev Loop */}
          <button
            onClick={() => setAutoLoopPanelOpen(v => !v)}
            title="Autonomous Dev Loop — auto-execute approved low-risk actions"
            className="flex items-center gap-1 px-2 h-8 sm:h-9 rounded-xl border transition-all duration-200 active:scale-95"
            style={{
              background:  autoLoopPanelOpen ? "hsl(150 70% 50% / 0.12)" : "transparent",
              borderColor: autoLoopPanelOpen ? "hsl(150 70% 50% / 0.5)"  : "hsl(210 15% 30%)",
            }}
            aria-label="Open auto loop panel"
          >
            <Bot className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: autoLoopPanelOpen ? "hsl(150 70% 72%)" : "hsl(196 60% 55%)" }} />
            <span className="text-[10px] sm:text-xs font-bold tracking-widest" style={{ color: autoLoopPanelOpen ? "hsl(150 70% 72%)" : "hsl(196 60% 55%)" }}>AUTO</span>
          </button>

          {/* Plans */}
          <button
            onClick={() => setPlansPanelOpen(v => !v)}
            title="Planner Brain — generate and manage structured plans"
            className="flex items-center gap-1 px-2 h-8 sm:h-9 rounded-xl border transition-all duration-200 active:scale-95"
            style={{
              background:  plansPanelOpen ? "hsl(264 80% 65% / 0.12)" : "transparent",
              borderColor: plansPanelOpen ? "hsl(264 80% 65% / 0.5)"  : "hsl(210 15% 30%)",
            }}
            aria-label="Open plans panel"
          >
            <Layers className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: plansPanelOpen ? "hsl(264 80% 75%)" : "hsl(196 60% 55%)" }} />
            <span className="text-[10px] sm:text-xs font-bold tracking-widest" style={{ color: plansPanelOpen ? "hsl(264 80% 75%)" : "hsl(196 60% 55%)" }}>PLANS</span>
          </button>

          {/* Priority */}
          <button
            onClick={() => setPriorityPanelOpen(v => !v)}
            title="Task Prioritizer — AI-scored rankings and recommendations"
            className="flex items-center gap-1 px-2 h-8 sm:h-9 rounded-xl border transition-all duration-200 active:scale-95"
            style={{
              background:  priorityPanelOpen ? "hsl(175 70% 55% / 0.12)" : "transparent",
              borderColor: priorityPanelOpen ? "hsl(175 70% 55% / 0.5)"  : "hsl(210 15% 30%)",
            }}
            aria-label="Open priority panel"
          >
            <TrendingUp className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: priorityPanelOpen ? "hsl(175 70% 70%)" : "hsl(196 60% 55%)" }} />
            <span className="text-[10px] sm:text-xs font-bold tracking-widest" style={{ color: priorityPanelOpen ? "hsl(175 70% 70%)" : "hsl(196 60% 55%)" }}>PRIORITY</span>
          </button>

          {/* Workspace */}
          <button
            onClick={() => setWorkspacePanelOpen(v => !v)}
            title="Workspace Intelligence — repo map, routes, components"
            className="flex items-center gap-1 px-2 h-8 sm:h-9 rounded-xl border transition-all duration-200 active:scale-95"
            style={{
              background:  workspacePanelOpen ? "hsl(28 100% 62% / 0.12)" : "transparent",
              borderColor: workspacePanelOpen ? "hsl(28 100% 62% / 0.5)"  : "hsl(210 15% 30%)",
            }}
            aria-label="Open workspace panel"
          >
            <Map className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: workspacePanelOpen ? "hsl(28 100% 72%)" : "hsl(196 60% 55%)" }} />
            <span className="text-[10px] sm:text-xs font-bold tracking-widest" style={{ color: workspacePanelOpen ? "hsl(28 100% 72%)" : "hsl(196 60% 55%)" }}>WORKSPACE</span>
          </button>

          {/* Repo Reasoner */}
          <button
            onClick={() => setReasonPanelOpen(v => !v)}
            title="Repo Reasoning — AI analysis of where and how to make changes"
            className="flex items-center gap-1 px-2 h-8 sm:h-9 rounded-xl border transition-all duration-200 active:scale-95"
            style={{
              background:  reasonPanelOpen ? "hsl(264 80% 68% / 0.12)" : "transparent",
              borderColor: reasonPanelOpen ? "hsl(264 80% 68% / 0.5)"  : "hsl(210 15% 30%)",
            }}
            aria-label="Open repo reasoning panel"
          >
            <Brain className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: reasonPanelOpen ? "hsl(264 80% 80%)" : "hsl(196 60% 55%)" }} />
            <span className="text-[10px] sm:text-xs font-bold tracking-widest" style={{ color: reasonPanelOpen ? "hsl(264 80% 80%)" : "hsl(196 60% 55%)" }}>REASON</span>
          </button>

          {/* Agents */}
          <button
            onClick={() => setAgentsPanelOpen(v => !v)}
            title="Specialist Agents — assign the right agent to any task"
            className="flex items-center gap-1 px-2 h-8 sm:h-9 rounded-xl border transition-all duration-200 active:scale-95"
            style={{
              background:  agentsPanelOpen ? "hsl(185 75% 52% / 0.12)" : "transparent",
              borderColor: agentsPanelOpen ? "hsl(185 75% 52% / 0.5)"  : "hsl(210 15% 30%)",
            }}
            aria-label="Open agents panel"
          >
            <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: agentsPanelOpen ? "hsl(185 75% 65%)" : "hsl(196 60% 55%)" }} />
            <span className="text-[10px] sm:text-xs font-bold tracking-widest" style={{ color: agentsPanelOpen ? "hsl(185 75% 65%)" : "hsl(196 60% 55%)" }}>AGENTS</span>
          </button>

          {/* Collaboration */}
          <button
            onClick={() => setCollabPanelOpen(v => !v)}
            title="Agent Collaboration — plan multi-agent teamwork for a goal"
            className="flex items-center gap-1 px-2 h-8 sm:h-9 rounded-xl border transition-all duration-200 active:scale-95"
            style={{
              background:  collabPanelOpen ? "hsl(320 70% 62% / 0.12)" : "transparent",
              borderColor: collabPanelOpen ? "hsl(320 70% 62% / 0.5)"  : "hsl(210 15% 30%)",
            }}
            aria-label="Open collaboration panel"
          >
            <Network className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: collabPanelOpen ? "hsl(320 70% 75%)" : "hsl(196 60% 55%)" }} />
            <span className="text-[10px] sm:text-xs font-bold tracking-widest" style={{ color: collabPanelOpen ? "hsl(320 70% 75%)" : "hsl(196 60% 55%)" }}>COLLAB</span>
          </button>

          {/* Work Orders */}
          <button
            onClick={() => setWorkOrdersPanelOpen(v => !v)}
            title="Work Orders — assigned tasks from collaboration plans"
            className="flex items-center gap-1 px-2 h-8 sm:h-9 rounded-xl border transition-all duration-200 active:scale-95"
            style={{
              background:  workOrdersPanelOpen ? "hsl(43 100% 55% / 0.12)" : "transparent",
              borderColor: workOrdersPanelOpen ? "hsl(43 100% 55% / 0.5)"  : "hsl(210 15% 30%)",
            }}
            aria-label="Open work orders panel"
          >
            <ClipboardList className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: workOrdersPanelOpen ? "hsl(43 100% 68%)" : "hsl(196 60% 55%)" }} />
            <span className="text-[10px] sm:text-xs font-bold tracking-widest" style={{ color: workOrdersPanelOpen ? "hsl(43 100% 68%)" : "hsl(196 60% 55%)" }}>ORDERS</span>
          </button>

          {/* Improvement Analysis */}
          <button
            onClick={() => setImprovementPanelOpen(v => !v)}
            title="Self-Improvement Analysis — scan system and generate improvement suggestions"
            className="flex items-center gap-1 px-2 h-8 sm:h-9 rounded-xl border transition-all duration-200 active:scale-95"
            style={{
              background:  improvementPanelOpen ? "hsl(175 75% 52% / 0.12)" : "transparent",
              borderColor: improvementPanelOpen ? "hsl(175 75% 52% / 0.5)"  : "hsl(210 15% 30%)",
            }}
            aria-label="Open improvement analysis panel"
          >
            <Cpu className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: improvementPanelOpen ? "hsl(175 75% 65%)" : "hsl(196 60% 55%)" }} />
            <span className="text-[10px] sm:text-xs font-bold tracking-widest" style={{ color: improvementPanelOpen ? "hsl(175 75% 65%)" : "hsl(196 60% 55%)" }}>IMPROVE</span>
          </button>

          {/* Dev Agent — visible on all screen sizes */}
          <button
            onClick={() => setDevPanelOpen(true)}
            title="Dev Agent — inspect and edit project files"
            className="flex items-center gap-1 px-2 h-8 sm:h-9 rounded-xl border transition-all duration-200 active:scale-95"
            style={{
              background: devPanelOpen ? "hsl(194 100% 50% / 0.12)" : "transparent",
              borderColor: devPanelOpen ? "hsl(194 100% 50% / 0.5)" : "hsl(210 15% 30%)",
            }}
            aria-label="Open Dev Agent"
          >
            <Code2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: devPanelOpen ? "hsl(194 100% 65%)" : "hsl(196 60% 55%)" }} />
            <span className="text-[10px] sm:text-xs font-bold tracking-widest" style={{ color: devPanelOpen ? "hsl(194 100% 65%)" : "hsl(196 60% 55%)" }}>DEV</span>
          </button>

          {/* Debug — hidden on mobile to reduce clutter */}
          <button
            onClick={toggleDebug}
            data-testid="button-toggle-debug"
            title={debugMode ? "Hide debug" : "Show debug"}
            className="hidden sm:flex w-9 h-9 rounded-xl border items-center justify-center transition-all duration-200"
            style={{
              background: debugMode ? "hsl(38 100% 55% / 0.15)" : "transparent",
              borderColor: debugMode ? "hsl(38 100% 55% / 0.4)" : "hsl(210 15% 25%)",
            }}
            aria-label="Toggle debug mode"
          >
            <Terminal className="w-4 h-4" style={{ color: debugMode ? "hsl(38 100% 65%)" : "hsl(196 40% 45%)" }} />
          </button>

          {/* Auto-speak toggle */}
          {speech.isSupported && (
            <button
              onClick={() => { speech.unlock(); speech.setAutoSpeak(!speech.autoSpeak); }}
              title={speech.autoSpeak ? "Auto-speak on — click to disable" : "Auto-speak off — click to enable"}
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl border flex items-center justify-center transition-all duration-200 active:scale-95"
              style={{
                background: speech.autoSpeak ? "hsl(142 60% 40% / 0.15)" : "transparent",
                borderColor: speech.autoSpeak ? "hsl(142 60% 40% / 0.45)" : "hsl(210 15% 25%)",
              }}
              aria-label={speech.autoSpeak ? "Disable auto-speak" : "Enable auto-speak"}
            >
              {speech.autoSpeak
                ? <Volume2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: "hsl(142 71% 60%)" }} />
                : <VolumeX className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: "hsl(196 40% 40%)" }} />
              }
            </button>
          )}

          {/* Memory */}
          <button
            onClick={() => setPanelOpen(true)}
            data-testid="button-open-memory"
            className="relative w-8 h-8 sm:w-9 sm:h-9 rounded-xl border border-border/60 bg-card flex items-center justify-center hover:border-primary/40 active:scale-95 transition-all"
            aria-label="Open memory panel"
          >
            <Brain className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: "hsl(194 100% 55%)" }} />
            {(memory?.messageCount ?? 0) > 0 && (
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-primary rounded-full" />
            )}
          </button>
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

      {/* ── Message list ── */}
      <main
        className="relative z-10 flex-1 overflow-y-auto scrollbar-thin px-4 sm:px-8 py-6"
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

      {/* ── Pending patch notification bar ────────────────────────────────── */}
      <PatchNotificationBar
        patches={pendingPatches.filter(p => !dismissedIds.has(p.patchId))}
        approvingId={approvingPatchId}
        errorMessage={patchBarError}
        serverStatus={serverStatus}
        onApprove={handleApprovePatch}
        onReject={handleRejectPatch}
      />

      {/* ── Input bar ── */}
      <footer className="relative z-10 flex-shrink-0 border-t border-border/60 bg-background/90 backdrop-blur-sm px-3 sm:px-8 pt-3 pb-safe"
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
        onClose={() => setTasksPanelOpen(false)}
        apiBase={BASE}
      />

      {/* Diagnostics panel */}
      <DiagnosticsPanel
        isOpen={diagPanelOpen}
        onClose={() => setDiagPanelOpen(false)}
        apiBase={BASE}
      />

      {/* System Status panel */}
      <SystemStatusPanel
        isOpen={statusPanelOpen}
        onClose={() => setStatusPanelOpen(false)}
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

      {/* Dev Agent panel */}
      {devPanelOpen && (
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

