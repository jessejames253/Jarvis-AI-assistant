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
} from "lucide-react";
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
}

// ─── Session management ───────────────────────────────────────────────────────

const SESSION_KEY = "jarvas_session_id";
const DEBUG_KEY = "jarvas_debug_mode";

function getOrCreateSessionId(): string {
  const existing = localStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, id);
  return id;
}

function createNewSessionId(): string {
  const id = crypto.randomUUID();
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
  }, [input, isTyping, isStreaming, sessionId, flushTokenBuffer]);

  // ── Plan execution ──────────────────────────────────────────────────────────

  const sendPlan = useCallback(async () => {
    const goal = input.trim();
    console.log("[Planner] sendPlan entered — goal:", JSON.stringify(goal), "isTyping:", isTyping, "isStreaming:", isStreaming);
    if (!goal || isTyping || isStreaming) return;
    console.log("[Planner] calling callPlanStream →", `${BASE}api/plan/stream`);

    speech.unlock();
    responseContentRef.current = "";
    setInput("");

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: `⚡ Plan: ${goal}`,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
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
            s.id === payload.stepId ? { ...s, status: "complete" as const, durationMs: payload.durationMs } : s,
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

      {/* ── Input bar ── */}
      <footer className="relative z-10 flex-shrink-0 border-t border-border/60 bg-background/90 backdrop-blur-sm px-3 sm:px-8 pt-3 pb-safe"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end gap-2.5 bg-card border border-border rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3 focus-within:border-primary/60 focus-within:glow-primary transition-all duration-200">
            <textarea
              ref={textareaRef}
              data-testid="input-message"
              className="flex-1 bg-transparent resize-none outline-none text-sm leading-relaxed placeholder:text-muted-foreground min-h-[24px] max-h-[120px] scrollbar-thin"
              style={{ color: "hsl(196 80% 85%)" }}
              placeholder="Ask Jarvis anything…"
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

            {/* ── Plan button ─────────────────────────────────────── */}
            <button
              data-testid="button-plan"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                console.log("[Planner] checklist clicked — input:", input.trim(), "isTyping:", isTyping, "isStreaming:", isStreaming);
                sendPlan();
              }}
              disabled={!input.trim() || isTyping || isStreaming}
              title="Autonomous multi-step plan"
              aria-label="Create plan"
              className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                border: "1px solid hsl(194 100% 40% / 0.5)",
                background: "hsl(194 100% 50% / 0.08)",
              }}
            >
              <ListChecks className="w-4 h-4" style={{ color: "hsl(194 100% 60%)" }} />
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

