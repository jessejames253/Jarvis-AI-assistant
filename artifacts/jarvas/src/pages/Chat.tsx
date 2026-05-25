/**
 * pages/Chat.tsx — Main Jarvas chat interface with persistent memory
 *
 * Session lifecycle:
 *   1. On mount, read (or generate) a UUID from localStorage → sessionId
 *   2. Fetch GET /api/memory/:sessionId to restore stored messages
 *   3. Show restored messages in the chat immediately
 *   4. Every message sent is persisted server-side via POST /api/chat?sessionId=...
 *   5. The memory panel lets users view session stats, set their name, and clear memory
 *
 * State:
 *   messages     — conversation displayed in the UI
 *   input        — current textarea value
 *   isTyping     — whether Jarvas is "thinking" (shows indicator)
 *   isSearching  — whether a web search is running
 *   memory       — the SessionMemory object from the backend
 *   sessionId    — UUID stored in localStorage, identifies this browser's session
 *   panelOpen    — whether the memory side panel is visible
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Search, ExternalLink, Brain } from "lucide-react";
import MemoryPanel, { type SessionMemory } from "@/components/MemoryPanel";

// ─── Types ────────────────────────────────────────────────────────────────────

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
}

// ─── Session management ───────────────────────────────────────────────────────

const SESSION_KEY = "jarvas_session_id";

/** Gets the current session ID from localStorage, or creates and stores a new one */
function getOrCreateSessionId(): string {
  const existing = localStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, id);
  return id;
}

/** Replaces the session with a new UUID (starts a fresh conversation) */
function createNewSessionId(): string {
  const id = crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, id);
  return id;
}

// ─── Web search trigger detection ─────────────────────────────────────────────

const SEARCH_TRIGGERS = [
  /\b(latest|current|recent|today|right now|this year|this week|this month)\b/i,
  /\b(news|breaking|just announced|just released|just launched)\b/i,
  /\b(weather|stock price|score|live results|election results)\b/i,
  /\bsearch (?:for |the web for |online for )?(.+)/i,
];

function needsWebSearch(text: string): boolean {
  return SEARCH_TRIGGERS.some((re) => re.test(text));
}

// ─── API helpers ──────────────────────────────────────────────────────────────

/** Sends a message to the chat endpoint and returns Jarvas's reply */
async function callChat(
  message: string,
  sessionId: string,
  base: string
): Promise<{ response: string; model: string }> {
  const res = await fetch(`${base}api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, sessionId }),
  });
  if (!res.ok) throw new Error(`Chat API error: ${res.status}`);
  return res.json() as Promise<{ response: string; model: string }>;
}

/** Sends a search query and returns web results */
async function callSearch(
  query: string,
  base: string
): Promise<{ answer: string; results: Source[]; isFake: boolean }> {
  const res = await fetch(`${base}api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Search API error: ${res.status}`);
  return res.json() as Promise<{ answer: string; results: Source[]; isFake: boolean }>;
}

/** Loads a session from the backend (creates it if new) */
async function loadSession(sessionId: string, base: string): Promise<SessionMemory> {
  const res = await fetch(`${base}api/memory/${sessionId}`);
  if (!res.ok) throw new Error(`Memory API error: ${res.status}`);
  return res.json() as Promise<SessionMemory>;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TypingIndicator({ isSearching }: { isSearching?: boolean }) {
  return (
    <div className="flex items-end gap-3 message-enter" data-testid="typing-indicator">
      <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/40 flex items-center justify-center flex-shrink-0 glow-primary">
        <span className="font-display text-primary text-xs font-bold">J</span>
      </div>
      <div className="bg-card border border-card-border rounded-2xl rounded-bl-sm px-4 py-3">
        {isSearching ? (
          <div className="flex items-center gap-2">
            <Search className="w-3.5 h-3.5 animate-pulse" style={{ color: "hsl(194 100% 60%)" }} />
            <span className="text-xs tracking-wider" style={{ color: "hsl(194 100% 60%)" }}>
              SCANNING WEB...
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 h-5">
            <span className="typing-dot w-1.5 h-1.5 bg-primary rounded-full" />
            <span className="typing-dot w-1.5 h-1.5 bg-primary rounded-full" />
            <span className="typing-dot w-1.5 h-1.5 bg-primary rounded-full" />
          </div>
        )}
      </div>
    </div>
  );
}

function SourceCard({ source, index }: { source: Source; index: number }) {
  const hostname = (() => {
    try { return new URL(source.url).hostname.replace("www.", ""); }
    catch { return source.url; }
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
        <span className="font-display text-xs font-bold" style={{ color: "hsl(194 100% 60%)" }}>
          {index + 1}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <p className="text-xs font-semibold truncate leading-tight" style={{ color: "hsl(194 100% 75%)" }}>
            {source.title}
          </p>
          <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "hsl(194 100% 60%)" }} />
        </div>
        <p className="text-xs mb-1 leading-snug line-clamp-2" style={{ color: "hsl(196 40% 55%)" }}>
          {source.description}
        </p>
        <p className="text-xs font-mono" style={{ color: "hsl(194 100% 45%)" }}>{hostname}</p>
      </div>
    </a>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const timeStr = message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (isUser) {
    return (
      <div className="flex items-end gap-3 justify-end message-enter" data-testid={`message-user-${message.id}`}>
        <div className="flex flex-col items-end gap-1 max-w-[80%]">
          <div className="bg-primary/15 border border-primary/30 rounded-2xl rounded-br-sm px-4 py-3 glow-primary">
            <p className="text-sm leading-relaxed" style={{ color: "hsl(196 100% 85%)" }}>{message.content}</p>
          </div>
          <span className="text-xs text-muted-foreground px-1">{timeStr}</span>
        </div>
        <div className="w-8 h-8 rounded-full bg-accent/20 border border-accent/50 flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-semibold font-display" style={{ color: "hsl(264 80% 80%)" }}>U</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-end gap-3 message-enter" data-testid={`message-assistant-${message.id}`}>
      <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/40 flex items-center justify-center flex-shrink-0 pulse-glow">
        <span className="font-display text-primary text-xs font-bold">J</span>
      </div>
      <div className="flex flex-col gap-2 max-w-[85%] sm:max-w-[80%]">
        {message.isSearch && (
          <div className="flex items-center gap-1.5 px-1">
            <Search className="w-3 h-3" style={{ color: "hsl(194 100% 55%)" }} />
            <span className="text-xs tracking-wider font-medium" style={{ color: "hsl(194 100% 55%)" }}>
              {message.isFakeSearch ? "DEMO SEARCH" : "WEB SEARCH"}
            </span>
          </div>
        )}
        <div className="bg-card border border-card-border rounded-2xl rounded-bl-sm px-4 py-3">
          <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "hsl(196 80% 80%)" }}>
            {message.content}
          </p>
        </div>
        {message.sources && message.sources.length > 0 && (
          <div className="flex flex-col gap-2 px-1" data-testid="search-sources">
            {message.sources.map((source, i) => <SourceCard key={i} source={source} index={i} />)}
          </div>
        )}
        <span className="text-xs text-muted-foreground px-1">{timeStr}</span>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL;

const WELCOME_MESSAGE = (name?: string): Message => ({
  id: "init",
  role: "assistant",
  content: name
    ? `Hello, ${name}. I remember you. What can I help with today?`
    : "Hello. I'm Jarvas — ask me anything. I'll search the web when you need current information.",
  timestamp: new Date(),
});

export default function Chat() {
  // Session ID — unique per browser, persisted in localStorage
  const [sessionId, setSessionId] = useState<string>(() => getOrCreateSessionId());

  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE()]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
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

  // ── Load session on mount (or when session changes) ──────────────────────
  useEffect(() => {
    let cancelled = false;
    setIsLoadingHistory(true);

    loadSession(sessionId, BASE)
      .then((session) => {
        if (cancelled) return;
        setMemory(session);

        // Restore stored messages into the chat UI
        if (session.messages.length > 0) {
          const restored: Message[] = session.messages.map((m, i) => ({
            id: `restored-${i}`,
            role: m.role as "user" | "assistant",
            content: m.content,
            timestamp: new Date(m.timestamp),
          }));
          // Prepend welcome, then restored history
          setMessages([WELCOME_MESSAGE(session.preferences?.name), ...restored]);
        } else {
          setMessages([WELCOME_MESSAGE(session.preferences?.name)]);
        }
      })
      .catch(() => {
        if (!cancelled) setMessages([WELCOME_MESSAGE()]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingHistory(false);
      });

    return () => { cancelled = true; };
  }, [sessionId]);

  // ── Send message ─────────────────────────────────────────────────────────
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

    if (textareaRef.current) textareaRef.current.style.height = "auto";

    // Update local message count so the memory panel stays in sync
    setMemory((prev) => prev ? { ...prev, messageCount: prev.messageCount + 1 } : prev);

    // ── Web search path ──────────────────────────────────────────────────────
    if (needsWebSearch(text)) {
      setIsSearching(true);
      try {
        const data = await callSearch(text, BASE);
        setIsSearching(false);
        setIsTyping(false);
        const assistantMsg: Message = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: data.answer,
          timestamp: new Date(),
          sources: data.results,
          isSearch: true,
          isFakeSearch: data.isFake,
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setMemory((prev) => prev ? { ...prev, messageCount: prev.messageCount + 1 } : prev);
        return;
      } catch {
        setIsSearching(false);
        // fall through to chat path
      }
    }

    // ── Chat path (memory-backed) ────────────────────────────────────────────
    try {
      const data = await callChat(text, sessionId, BASE);
      setIsTyping(false);
      const assistantMsg: Message = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.response,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setMemory((prev) => prev ? { ...prev, messageCount: prev.messageCount + 1 } : prev);
    } catch {
      setIsTyping(false);
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
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };

  // ── Memory panel callbacks ───────────────────────────────────────────────
  const handleMemoryCleared = useCallback(() => {
    setMemory((prev) => prev
      ? { ...prev, messages: [], summary: null, preferences: {}, messageCount: 0 }
      : prev
    );
    setMessages([WELCOME_MESSAGE()]);
  }, []);

  const handleNewSession = useCallback(() => {
    const newId = createNewSessionId();
    setSessionId(newId);
    setMemory(null);
    setMessages([WELCOME_MESSAGE()]);
  }, []);

  const handlePreferencesSaved = useCallback((updated: SessionMemory) => {
    setMemory(updated);
    // Update the welcome message greeting if the user just set their name
    setMessages((prev) => {
      const rest = prev.filter((m) => m.id !== "init");
      return [WELCOME_MESSAGE(updated.preferences?.name), ...rest];
    });
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen w-full bg-background scan-overlay overflow-hidden">
      <div className="fixed inset-0 bg-grid opacity-60 pointer-events-none" />
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-96 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed bottom-24 right-8 w-64 h-64 bg-accent/5 rounded-full blur-3xl pointer-events-none" />

      {/* ── Header ── */}
      <header className="relative z-10 flex-shrink-0 flex items-center justify-between px-4 sm:px-8 py-4 border-b border-border/60 bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="relative w-10 h-10 rounded-xl bg-primary/10 border border-primary/40 flex items-center justify-center glow-primary">
            <span className="font-display text-primary font-black text-lg">J</span>
            <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-primary rounded-full animate-pulse" />
          </div>
          <div>
            <h1 className="font-display font-bold text-xl sm:text-2xl tracking-widest glow-primary-text"
              style={{ color: "hsl(194 100% 60%)" }}>
              JARVAS
            </h1>
            <p className="text-xs tracking-widest" style={{ color: "hsl(196 40% 50%)" }}>
              AI ASSISTANT · WEB SEARCH ENABLED
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs font-medium tracking-wider" style={{ color: "hsl(142 71% 60%)" }}>
              ONLINE
            </span>
          </div>

          {/* Memory button — opens the memory panel */}
          <button
            onClick={() => setPanelOpen(true)}
            data-testid="button-open-memory"
            className="relative w-9 h-9 rounded-xl border border-border/60 bg-card flex items-center justify-center hover:border-primary/40 transition-colors"
            aria-label="Open memory panel"
            title="Memory & Preferences"
          >
            <Brain className="w-4 h-4" style={{ color: "hsl(194 100% 55%)" }} />
            {/* Dot indicator: lit when session has messages saved */}
            {(memory?.messageCount ?? 0) > 0 && (
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-primary rounded-full" />
            )}
          </button>
        </div>
      </header>

      {/* ── Loading banner (shown while restoring history) ── */}
      {isLoadingHistory && (
        <div className="relative z-10 flex-shrink-0 flex items-center justify-center gap-2 py-2 bg-primary/5 border-b border-primary/20">
          <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
          <span className="text-xs tracking-wider" style={{ color: "hsl(194 100% 55%)" }}>
            RESTORING MEMORY...
          </span>
        </div>
      )}

      {/* ── Message list ── */}
      <main className="relative z-10 flex-1 overflow-y-auto scrollbar-thin px-4 sm:px-8 py-6" data-testid="chat-messages">
        <div className="max-w-3xl mx-auto flex flex-col gap-5">
          {/* Summary badge — shown when older messages have been compressed */}
          {memory?.summary && !isLoadingHistory && (
            <div className="flex items-center gap-2 py-2 px-3 rounded-xl bg-primary/5 border border-primary/20">
              <Brain className="w-3 h-3 flex-shrink-0" style={{ color: "hsl(194 100% 55%)" }} />
              <p className="text-xs" style={{ color: "hsl(194 100% 55%)" }}>
                Older messages have been summarized and stored in memory.{" "}
                <button
                  className="underline hover:no-underline"
                  onClick={() => setPanelOpen(true)}
                >
                  View summary
                </button>
              </p>
            </div>
          )}

          {messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}
          {isTyping && <TypingIndicator isSearching={isSearching} />}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* ── Input bar ── */}
      <footer className="relative z-10 flex-shrink-0 border-t border-border/60 bg-background/80 backdrop-blur-sm px-4 sm:px-8 py-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end gap-3 bg-card border border-border rounded-2xl px-4 py-3 focus-within:border-primary/60 focus-within:glow-primary transition-all duration-200">
            <textarea
              ref={textareaRef}
              data-testid="input-message"
              className="flex-1 bg-transparent resize-none outline-none text-sm leading-relaxed placeholder:text-muted-foreground min-h-[24px] max-h-[120px] scrollbar-thin"
              style={{ color: "hsl(196 80% 85%)" }}
              placeholder="Ask anything — Jarvas will search the web if needed..."
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              rows={1}
            />
            <button
              data-testid="button-send"
              onClick={sendMessage}
              disabled={!input.trim() || isTyping}
              className="flex-shrink-0 w-9 h-9 rounded-xl bg-primary flex items-center justify-center transition-all duration-200 hover:bg-primary/80 disabled:opacity-30 disabled:cursor-not-allowed glow-primary"
              aria-label="Send message"
            >
              <Send className="w-4 h-4" style={{ color: "hsl(220 20% 6%)" }} />
            </button>
          </div>
          <p className="text-center text-xs mt-2 tracking-wider" style={{ color: "hsl(196 30% 40%)" }}>
            Jarvas remembers your conversations · Web search enabled
          </p>
        </div>
      </footer>

      {/* ── Memory panel (slide in from right) ── */}
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
