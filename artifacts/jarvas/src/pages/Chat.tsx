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
} from "lucide-react";
import { useLocation } from "wouter";
import MemoryPanel, { type SessionMemory } from "@/components/MemoryPanel";
import DebugPanel, { type DebugInfo } from "@/components/DebugPanel";
import MarkdownContent from "@/components/MarkdownContent";

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

interface ChatApiResponse {
  response: string;
  model: string;
  sources?: Source[];
  isSearch?: boolean;
  isFakeSearch?: boolean;
  debug: DebugInfo;
}

async function callChat(
  message: string,
  sessionId: string,
  base: string,
): Promise<ChatApiResponse> {
  const res = await fetch(`${base}api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, sessionId }),
  });
  if (!res.ok) throw new Error(`Chat API error: ${res.status}`);
  return res.json() as Promise<ChatApiResponse>;
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
}: {
  message: Message;
  showDebug: boolean;
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

        {/* Main bubble */}
        <div className="bg-card border border-card-border rounded-2xl rounded-tl-sm px-4 py-3 min-w-0">
          <MarkdownContent content={message.content} />
        </div>

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

        <span className="text-xs text-muted-foreground px-1">{timeStr}</span>

        {/* Debug panel — shown only when debug mode is on */}
        {showDebug && message.debug && <DebugPanel debug={message.debug} />}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL;

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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  // Load session on mount / session change
  useEffect(() => {
    let cancelled = false;
    setIsLoadingHistory(true);

    loadSession(sessionId, BASE)
      .then((session) => {
        if (cancelled) return;
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
        if (!cancelled) setMessages([WELCOME()]);
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

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isTyping) return;

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

    try {
      const data = await callChat(text, sessionId, BASE);
      setIsTyping(false);
      setAgentStatus("idle");

      const assistantMsg: Message = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.response,
        timestamp: new Date(),
        sources: data.sources,
        isSearch: data.isSearch,
        isFakeSearch: data.isFakeSearch,
        debug: data.debug,
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setMemory((prev) =>
        prev ? { ...prev, messageCount: prev.messageCount + 1 } : prev,
      );

      // If the memory tool updated a preference, refresh memory panel
      if (data.debug?.action === "preference_update") {
        loadSession(sessionId, BASE)
          .then(setMemory)
          .catch(() => {});
      }
    } catch {
      setIsTyping(false);
      setAgentStatus("error");
      setTimeout(() => setAgentStatus("idle"), 2500);
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: "Something went wrong on my end. Please try again.",
          timestamp: new Date(),
        },
      ]);
    }
  }, [input, isTyping, sessionId]);

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
            <MessageBubble key={msg.id} message={msg} showDebug={debugMode} />
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
            <button
              data-testid="button-send"
              onClick={sendMessage}
              disabled={!input.trim() || isTyping}
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

