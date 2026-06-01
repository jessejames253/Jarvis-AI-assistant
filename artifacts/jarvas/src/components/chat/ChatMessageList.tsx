import { type RefObject } from "react";
import { Brain, Search, ExternalLink, Volume2, VolumeX } from "lucide-react";
import { type AgentStatus, STATUS_CONFIG, type Source, type Message } from "@/components/chat/chat.types";
import type { SessionMemory } from "@/components/MemoryPanel";
import MarkdownContent from "@/components/MarkdownContent";
import ToolStatusBubble from "@/components/ToolStatusBubble";
import PlanCard from "@/components/PlanCard";
import DebugPanel from "@/components/DebugPanel";
import ChatPatchProposal from "@/components/ChatPatchProposal";

// ── TypingIndicator ────────────────────────────────────────────────────────────

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

// ── SourceCard ─────────────────────────────────────────────────────────────────

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
        <p className="text-xs font-mono" style={{ color: "hsl(194 100% 45%)" }}>
          {hostname}
        </p>
      </div>
    </a>
  );
}

// ── MessageBubble ──────────────────────────────────────────────────────────────

interface MessageBubbleProps {
  message: Message;
  showDebug: boolean;
  isStreaming: boolean;
  isSpeaking: boolean;
  onSpeak: () => void;
  onStopSpeak: () => void;
}

function MessageBubble({ message, showDebug, isStreaming, isSpeaking, onSpeak, onStopSpeak }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const timeStr = message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (isUser) {
    return (
      <div className="flex items-end gap-3 justify-end message-enter" data-testid={`message-user-${message.id}`}>
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
            <p className="text-sm leading-relaxed" style={{ color: "hsl(196 100% 85%)" }}>
              {message.content}
            </p>
          </div>
          <span className="text-xs text-muted-foreground px-1">{timeStr}</span>
        </div>
        <div className="w-8 h-8 rounded-full bg-accent/20 border border-accent/50 flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-semibold font-display" style={{ color: "hsl(264 80% 80%)" }}>U</span>
        </div>
      </div>
    );
  }

  const toolCalls = message.toolCalls ?? [];

  return (
    <div className="flex items-start gap-3 message-enter" data-testid={`message-assistant-${message.id}`}>
      <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/40 flex items-center justify-center flex-shrink-0 pulse-glow mt-0.5">
        <span className="font-display text-primary text-xs font-bold">J</span>
      </div>
      <div className="flex flex-col gap-2 max-w-[85%] sm:max-w-[80%] min-w-0">
        {message.isSearch && (
          <div className="flex items-center gap-1.5 px-1">
            <Search className="w-3 h-3" style={{ color: "hsl(194 100% 55%)" }} />
            <span className="text-xs tracking-wider font-medium" style={{ color: "hsl(194 100% 55%)" }}>
              {message.isFakeSearch ? "DEMO SEARCH" : "WEB SEARCH"}
            </span>
          </div>
        )}

        {toolCalls.length > 0 && <ToolStatusBubble calls={toolCalls} />}
        {message.plan && <PlanCard plan={message.plan} />}

        {(message.content || isStreaming) && (
          <div className="bg-card border border-card-border rounded-2xl rounded-tl-sm px-4 py-3 min-w-0">
            <MarkdownContent content={message.content} />
            {isStreaming && <span className="streaming-cursor" aria-hidden="true" />}
          </div>
        )}

        {message.sources && message.sources.length > 0 && (
          <div className="flex flex-col gap-2 px-1" data-testid="search-sources">
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
              {isSpeaking ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>

        {message.patchProposal && <ChatPatchProposal proposal={message.patchProposal} />}
        {showDebug && message.debug && <DebugPanel debug={message.debug} />}
      </div>
    </div>
  );
}

// ── ChatMessageList ────────────────────────────────────────────────────────────

interface SpeechControls {
  isSpeakingMsg: (id: string) => boolean;
  toggle: (id: string, content: string) => void;
  stop: () => void;
}

interface ChatMessageListProps {
  messages: Message[];
  streamingMsgId: string | null;
  isTyping: boolean;
  isStreaming: boolean;
  agentStatus: AgentStatus;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  memory: SessionMemory | null;
  isLoadingHistory: boolean;
  onOpenMemory: () => void;
  debugMode: boolean;
  speech: SpeechControls;
  activeTab: string;
}

export function ChatMessageList({
  messages,
  streamingMsgId,
  isTyping,
  isStreaming,
  agentStatus,
  messagesEndRef,
  memory,
  isLoadingHistory,
  onOpenMemory,
  debugMode,
  speech,
  activeTab,
}: ChatMessageListProps) {
  return (
    <main
      className={`relative z-10 overflow-y-auto scrollbar-thin px-4 sm:px-8 py-6 ${activeTab === "debug" || activeTab === "dev" ? "hidden" : "flex-1"}`}
      data-testid="chat-messages"
    >
      <div className="max-w-3xl mx-auto flex flex-col gap-5">
        {memory?.summary && !isLoadingHistory && (
          <div className="flex items-center gap-2 py-2 px-3 rounded-xl bg-primary/5 border border-primary/20">
            <Brain className="w-3 h-3 flex-shrink-0" style={{ color: "hsl(194 100% 55%)" }} />
            <p className="text-xs" style={{ color: "hsl(194 100% 55%)" }}>
              Older messages are summarized in memory.{" "}
              <button className="underline hover:no-underline" onClick={onOpenMemory}>
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
  );
}
