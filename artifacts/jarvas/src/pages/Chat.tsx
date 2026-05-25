import { useState, useRef, useEffect, useCallback } from "react";
import { Send } from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const FAKE_RESPONSES = [
  "Processing your request through quantum neural pathways... I've analyzed the data streams and computed a high-probability solution for you.",
  "Accessing global knowledge matrix. My predictive algorithms suggest that the optimal approach involves cross-referencing multiple data points simultaneously.",
  "Neural link established. Based on 847 terabytes of synthesized intelligence, I recommend the following course of action for maximum efficiency.",
  "Quantum computation complete. The probability of success with my recommended approach is 97.3%. Shall I proceed with execution?",
  "Scanning encrypted data channels... My deep learning modules have identified 3 key patterns in your query that require strategic attention.",
  "Interfacing with distributed intelligence nodes. I've identified the core variables at play — let me synthesize a precise response for you.",
  "Initializing advanced reasoning protocols. Cross-dimensional analysis suggests multiple viable pathways. I'll outline the most optimal trajectory.",
  "System calibration complete. My heuristic models project a favorable outcome if we leverage the asymmetric data advantage I've identified.",
  "Engaging predictive synthesis engine. The temporal data patterns indicate a clear path forward — here's what my analysis reveals.",
  "Quantum-secure channel active. I've processed 2.4 million related data vectors to provide you with this high-confidence assessment.",
];

function getRandomResponse(): string {
  return FAKE_RESPONSES[Math.floor(Math.random() * FAKE_RESPONSES.length)];
}

function TypingIndicator() {
  return (
    <div className="flex items-end gap-3 message-enter" data-testid="typing-indicator">
      <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/40 flex items-center justify-center flex-shrink-0 glow-primary">
        <span className="font-display text-primary text-xs font-bold">J</span>
      </div>
      <div className="bg-card border border-card-border rounded-2xl rounded-bl-sm px-4 py-3">
        <div className="flex items-center gap-1.5 h-5">
          <span className="typing-dot w-1.5 h-1.5 bg-primary rounded-full" />
          <span className="typing-dot w-1.5 h-1.5 bg-primary rounded-full" />
          <span className="typing-dot w-1.5 h-1.5 bg-primary rounded-full" />
        </div>
      </div>
    </div>
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
            <p className="text-sm text-primary-foreground/90 leading-relaxed" style={{ color: 'hsl(196 100% 85%)' }}>{message.content}</p>
          </div>
          <span className="text-xs text-muted-foreground px-1">{timeStr}</span>
        </div>
        <div className="w-8 h-8 rounded-full bg-accent/20 border border-accent/50 flex items-center justify-center flex-shrink-0">
          <span className="text-accent-foreground text-xs font-semibold font-display" style={{ color: 'hsl(264 80% 80%)' }}>U</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-end gap-3 message-enter" data-testid={`message-assistant-${message.id}`}>
      <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/40 flex items-center justify-center flex-shrink-0 pulse-glow">
        <span className="font-display text-primary text-xs font-bold">J</span>
      </div>
      <div className="flex flex-col gap-1 max-w-[80%]">
        <div className="bg-card border border-card-border rounded-2xl rounded-bl-sm px-4 py-3">
          <p className="text-sm leading-relaxed" style={{ color: 'hsl(196 80% 80%)' }}>{message.content}</p>
        </div>
        <span className="text-xs text-muted-foreground px-1">{timeStr}</span>
      </div>
    </div>
  );
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "init",
      role: "assistant",
      content: "JARVAS online. Neural networks initialized. All systems operational. How may I assist you today?",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

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

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    const delay = 1200 + Math.random() * 1200;
    await new Promise((r) => setTimeout(r, delay));

    const assistantMsg: Message = {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: getRandomResponse(),
      timestamp: new Date(),
    };

    setIsTyping(false);
    setMessages((prev) => [...prev, assistantMsg]);
  }, [input, isTyping]);

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

  return (
    <div className="flex flex-col h-screen w-full bg-background scan-overlay overflow-hidden">
      {/* Background grid */}
      <div className="fixed inset-0 bg-grid opacity-60 pointer-events-none" />

      {/* Ambient glows */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-96 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed bottom-24 right-8 w-64 h-64 bg-accent/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 flex-shrink-0 flex items-center justify-between px-4 sm:px-8 py-4 border-b border-border/60 bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          {/* Logo mark */}
          <div className="relative w-10 h-10 rounded-xl bg-primary/10 border border-primary/40 flex items-center justify-center glow-primary">
            <span className="font-display text-primary font-black text-lg">J</span>
            <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-primary rounded-full animate-pulse" />
          </div>
          <div>
            <h1 className="font-display font-bold text-xl sm:text-2xl tracking-widest glow-primary-text" style={{ color: 'hsl(194 100% 60%)' }}>
              JARVAS
            </h1>
            <p className="text-xs tracking-widest" style={{ color: 'hsl(196 40% 50%)' }}>AI ASSISTANT · v7.4.1</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs font-medium tracking-wider" style={{ color: 'hsl(142 71% 60%)' }}>ONLINE</span>
          </div>
          <div className="flex sm:hidden items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          </div>
        </div>
      </header>

      {/* Messages area */}
      <main className="relative z-10 flex-1 overflow-y-auto scrollbar-thin px-4 sm:px-8 py-6" data-testid="chat-messages">
        <div className="max-w-3xl mx-auto flex flex-col gap-5">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          {isTyping && <TypingIndicator />}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input area */}
      <footer className="relative z-10 flex-shrink-0 border-t border-border/60 bg-background/80 backdrop-blur-sm px-4 sm:px-8 py-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end gap-3 bg-card border border-border rounded-2xl px-4 py-3 focus-within:border-primary/60 focus-within:glow-primary transition-all duration-200">
            <textarea
              ref={textareaRef}
              data-testid="input-message"
              className="flex-1 bg-transparent resize-none outline-none text-sm leading-relaxed placeholder:text-muted-foreground min-h-[24px] max-h-[120px] scrollbar-thin"
              style={{ color: 'hsl(196 80% 85%)' }}
              placeholder="Send a message to JARVAS..."
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
              <Send className="w-4 h-4" style={{ color: 'hsl(220 20% 6%)' }} />
            </button>
          </div>
          <p className="text-center text-xs mt-2 tracking-wider" style={{ color: 'hsl(196 30% 40%)' }}>
            JARVAS may produce inaccurate information · Neural link encrypted
          </p>
        </div>
      </footer>
    </div>
  );
}
