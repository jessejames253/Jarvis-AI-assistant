/**
 * pages/Chat.tsx — The main Jarvas chat interface
 *
 * This is the only page in the app. It contains everything the user sees and
 * interacts with: the header, the message list, and the input bar.
 *
 * How a message flows through the app:
 *
 *   1. User types in the <textarea> and presses Enter or the send button
 *   2. sendMessage() is called
 *   3. The user's message is added to the messages list immediately
 *   4. The typing indicator appears
 *   5a. If the question needs web search → callSearch() hits POST /api/search
 *   5b. Otherwise                        → callChat()   hits POST /api/chat
 *   6. The response arrives and is added to the messages list
 *   7. The typing indicator disappears
 *
 * State managed in this component:
 *   messages     — the full conversation history (array of Message objects)
 *   input        — the current value of the textarea
 *   isTyping     — whether to show the animated typing indicator
 *   isSearching  — whether to show "SCANNING WEB..." instead of dots
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Search, ExternalLink } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single web search result returned by the backend */
interface Source {
  title: string;
  url: string;
  description: string;
}

/** One message in the conversation — either from the user or from Jarvas */
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  sources?: Source[];     // Only present on search result messages
  isSearch?: boolean;     // true → show the search badge above the bubble
  isFakeSearch?: boolean; // true → show "DEMO SEARCH" instead of "WEB SEARCH"
}

/** A history entry passed to the backend so it can understand conversation context */
interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
}

// ─── Search trigger detection ─────────────────────────────────────────────────

/**
 * These patterns identify messages that need live web data.
 * If any pattern matches the user's message, we call /api/search instead of /api/chat.
 *
 * Examples that trigger search:
 *   "What's the latest news on AI?"
 *   "What's the weather today?"
 *   "Search for the best laptops 2026"
 */
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
// These functions talk to the backend. They're kept simple and separate from
// the UI logic so they're easy to modify or mock during testing.

/**
 * callChat() — Sends a message to the backend and gets Jarvas's reply.
 * Calls POST /api/chat on the backend server (not the browser).
 */
async function callChat(
  message: string,
  history: HistoryEntry[]
): Promise<{ response: string; model: string }> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });
  if (!res.ok) throw new Error(`Chat API error: ${res.status}`);
  return res.json() as Promise<{ response: string; model: string }>;
}

/**
 * callSearch() — Sends a search query and gets web results.
 * Calls POST /api/search on the backend server.
 * Works in demo mode (fake results) if SEARCH_API_KEY is not set.
 */
async function callSearch(query: string): Promise<{
  answer: string;
  results: Source[];
  isFake: boolean;
}> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Search API error: ${res.status}`);
  return res.json() as Promise<{ answer: string; results: Source[]; isFake: boolean }>;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * TypingIndicator — Shown while waiting for Jarvas to respond.
 * Displays animated bouncing dots normally, or a "SCANNING WEB..." label
 * when a web search is in progress.
 */
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
          // Three dots that bounce one after another (animation defined in index.css)
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

/**
 * SourceCard — A clickable card linking to one web search result.
 * Shows the page title, a short description, and the domain name.
 * Opens the link in a new tab.
 */
function SourceCard({ source, index }: { source: Source; index: number }) {
  // Extract just the domain name for a clean display (e.g. "en.wikipedia.org")
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
      {/* Numbered circle */}
      <div className="flex-shrink-0 mt-0.5 w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center">
        <span className="font-display text-xs font-bold" style={{ color: "hsl(194 100% 60%)" }}>
          {index + 1}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        {/* Title row with external link icon (visible on hover) */}
        <div className="flex items-center gap-1.5 mb-0.5">
          <p className="text-xs font-semibold truncate leading-tight" style={{ color: "hsl(194 100% 75%)" }}>
            {source.title}
          </p>
          <ExternalLink
            className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: "hsl(194 100% 60%)" }}
          />
        </div>
        {/* Description — limited to 2 lines */}
        <p className="text-xs mb-1 leading-snug line-clamp-2" style={{ color: "hsl(196 40% 55%)" }}>
          {source.description}
        </p>
        {/* Domain name in monospace */}
        <p className="text-xs font-mono" style={{ color: "hsl(194 100% 45%)" }}>
          {hostname}
        </p>
      </div>
    </a>
  );
}

/**
 * MessageBubble — Renders one message in the chat.
 *
 * User messages appear on the RIGHT with a teal-tinted bubble.
 * Jarvas messages appear on the LEFT with a darker card bubble.
 * Search results show a badge and clickable source cards below the text.
 */
function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const timeStr = message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (isUser) {
    return (
      <div className="flex items-end gap-3 justify-end message-enter" data-testid={`message-user-${message.id}`}>
        <div className="flex flex-col items-end gap-1 max-w-[80%]">
          <div className="bg-primary/15 border border-primary/30 rounded-2xl rounded-br-sm px-4 py-3 glow-primary">
            <p className="text-sm leading-relaxed" style={{ color: "hsl(196 100% 85%)" }}>
              {message.content}
            </p>
          </div>
          <span className="text-xs text-muted-foreground px-1">{timeStr}</span>
        </div>
        {/* User avatar */}
        <div className="w-8 h-8 rounded-full bg-accent/20 border border-accent/50 flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-semibold font-display" style={{ color: "hsl(264 80% 80%)" }}>
            U
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-end gap-3 message-enter" data-testid={`message-assistant-${message.id}`}>
      {/* Jarvas avatar — glows with a pulsing animation (defined in index.css) */}
      <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/40 flex items-center justify-center flex-shrink-0 pulse-glow">
        <span className="font-display text-primary text-xs font-bold">J</span>
      </div>

      <div className="flex flex-col gap-2 max-w-[85%] sm:max-w-[80%]">
        {/* Search badge — shown only on messages that came from web search */}
        {message.isSearch && (
          <div className="flex items-center gap-1.5 px-1">
            <Search className="w-3 h-3" style={{ color: "hsl(194 100% 55%)" }} />
            <span className="text-xs tracking-wider font-medium" style={{ color: "hsl(194 100% 55%)" }}>
              {message.isFakeSearch ? "DEMO SEARCH" : "WEB SEARCH"}
            </span>
          </div>
        )}

        {/* Main message bubble */}
        <div className="bg-card border border-card-border rounded-2xl rounded-bl-sm px-4 py-3">
          {/* whitespace-pre-line preserves line breaks in multi-line responses */}
          <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "hsl(196 80% 80%)" }}>
            {message.content}
          </p>
        </div>

        {/* Source cards — only shown when the response includes web search results */}
        {message.sources && message.sources.length > 0 && (
          <div className="flex flex-col gap-2 px-1" data-testid="search-sources">
            {message.sources.map((source, i) => (
              <SourceCard key={i} source={source} index={i} />
            ))}
          </div>
        )}

        <span className="text-xs text-muted-foreground px-1">{timeStr}</span>
      </div>
    </div>
  );
}

// ─── Main page component ──────────────────────────────────────────────────────

export default function Chat() {
  // The full list of messages shown in the chat — starts with Jarvas's greeting
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "init",
      role: "assistant",
      content: "Hello. I'm Jarvas — ask me anything. I'll search the web when you need current information.",
      timestamp: new Date(),
    },
  ]);

  const [input, setInput] = useState("");         // Current text in the textarea
  const [isTyping, setIsTyping] = useState(false); // Whether Jarvas is "thinking"
  const [isSearching, setIsSearching] = useState(false); // Whether a web search is running

  // Refs let us interact with DOM elements directly (without re-rendering)
  const messagesEndRef = useRef<HTMLDivElement>(null); // Invisible div at the bottom of the chat
  const textareaRef = useRef<HTMLTextAreaElement>(null); // The input textarea

  /** Scrolls the chat to the bottom so the latest message is always visible */
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Scroll to bottom whenever messages change or typing starts/stops
  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  /**
   * buildHistory() — Converts the messages array into the format the backend expects.
   * Skips the initial greeting (id "init") since that's not part of the real conversation.
   */
  const buildHistory = useCallback(
    (currentMessages: Message[]): HistoryEntry[] =>
      currentMessages
        .filter((m) => m.id !== "init")
        .map((m) => ({ role: m.role, content: m.content })),
    []
  );

  /**
   * sendMessage() — The main handler for when the user sends a message.
   *
   * Steps:
   * 1. Validate input (not empty, not already waiting)
   * 2. Add the user message to the chat immediately (optimistic UI)
   * 3. Show the typing indicator
   * 4. Decide: search or chat?
   * 5. Call the appropriate backend endpoint
   * 6. Add Jarvas's response to the chat
   * 7. Hide the typing indicator
   */
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isTyping) return; // Don't send empty messages or while already waiting

    // Create the user message object
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date(),
    };

    // Add user message to chat and clear the input field
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    // Reset textarea height back to one line
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    // ── Web search path ──────────────────────────────────────────────────────
    if (needsWebSearch(text)) {
      setIsSearching(true);
      try {
        const data = await callSearch(text);
        setIsSearching(false);
        setIsTyping(false);
        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: data.answer,
            timestamp: new Date(),
            sources: data.results,
            isSearch: true,
            isFakeSearch: data.isFake,
          },
        ]);
        return; // Done — don't fall through to the chat path
      } catch {
        // If search fails, fall through to the regular chat response
        setIsSearching(false);
      }
    }

    // ── Chat path ────────────────────────────────────────────────────────────
    // We use setMessages with a callback here so we can read the current messages
    // to build the history, then immediately kick off the async API call.
    setMessages((prev) => {
      const history = buildHistory(prev);

      callChat(text, history)
        .then((data) => {
          setIsTyping(false);
          setMessages((latest) => [
            ...latest,
            {
              id: `assistant-${Date.now()}`,
              role: "assistant",
              content: data.response,
              timestamp: new Date(),
            },
          ]);
        })
        .catch(() => {
          // Show a friendly error if the API call fails
          setIsTyping(false);
          setMessages((latest) => [
            ...latest,
            {
              id: `assistant-${Date.now()}`,
              role: "assistant",
              content: "Something went wrong on my end. Please try again.",
              timestamp: new Date(),
            },
          ]);
        });

      return prev; // Don't change messages yet — the .then() above will handle it
    });
  }, [input, isTyping, buildHistory]);

  /** Send on Enter key (Shift+Enter inserts a newline instead) */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  /** Auto-resize the textarea as the user types (up to a maximum height) */
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto"; // Reset first so shrinking works
    el.style.height = Math.min(el.scrollHeight, 120) + "px"; // Grow up to 120px
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen w-full bg-background scan-overlay overflow-hidden">
      {/* Animated grid background (CSS defined in index.css) */}
      <div className="fixed inset-0 bg-grid opacity-60 pointer-events-none" />

      {/* Ambient glow blobs — decorative, pointer-events disabled so they don't block clicks */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-96 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed bottom-24 right-8 w-64 h-64 bg-accent/5 rounded-full blur-3xl pointer-events-none" />

      {/* ── Header ── */}
      <header className="relative z-10 flex-shrink-0 flex items-center justify-between px-4 sm:px-8 py-4 border-b border-border/60 bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          {/* Logo: "J" in a glowing rounded square, with a pulsing dot */}
          <div className="relative w-10 h-10 rounded-xl bg-primary/10 border border-primary/40 flex items-center justify-center glow-primary">
            <span className="font-display text-primary font-black text-lg">J</span>
            <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-primary rounded-full animate-pulse" />
          </div>
          <div>
            <h1
              className="font-display font-bold text-xl sm:text-2xl tracking-widest glow-primary-text"
              style={{ color: "hsl(194 100% 60%)" }}
            >
              JARVAS
            </h1>
            <p className="text-xs tracking-widest" style={{ color: "hsl(196 40% 50%)" }}>
              AI ASSISTANT · WEB SEARCH ENABLED
            </p>
          </div>
        </div>

        {/* Online badge — visible on desktop; just a dot on mobile */}
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs font-medium tracking-wider" style={{ color: "hsl(142 71% 60%)" }}>
              ONLINE
            </span>
          </div>
          <div className="flex sm:hidden">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          </div>
        </div>
      </header>

      {/* ── Message list ── */}
      {/* overflow-y-auto enables scrolling; scrollbar-thin styles it (defined in index.css) */}
      <main
        className="relative z-10 flex-1 overflow-y-auto scrollbar-thin px-4 sm:px-8 py-6"
        data-testid="chat-messages"
      >
        <div className="max-w-3xl mx-auto flex flex-col gap-5">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {/* Typing indicator appears at the bottom while waiting */}
          {isTyping && <TypingIndicator isSearching={isSearching} />}

          {/* Invisible anchor div — scrollIntoView() targets this to scroll to the bottom */}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* ── Input bar ── */}
      <footer className="relative z-10 flex-shrink-0 border-t border-border/60 bg-background/80 backdrop-blur-sm px-4 sm:px-8 py-4">
        <div className="max-w-3xl mx-auto">
          {/* The input container glows when focused (focus-within applies to focused children) */}
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
              rows={1} // Start at one line; grows via handleInputChange
            />

            {/* Send button — disabled while Jarvas is typing or input is empty */}
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
            Jarvas searches the web for current information · Responses are AI-generated
          </p>
        </div>
      </footer>
    </div>
  );
}
