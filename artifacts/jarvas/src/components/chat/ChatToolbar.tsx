import { Brain, Volume2, VolumeX } from "lucide-react";
import { type AgentStatus, STATUS_CONFIG } from "@/components/chat/chat.types";
import type { SessionMemory } from "@/components/MemoryPanel";

type ActiveTab = "chat" | "tasks" | "diag" | "status" | "debug" | "dev";

interface SpeechSession {
  isSupported: boolean;
  autoSpeak: boolean;
  setAutoSpeak: (v: boolean) => void;
  unlock: () => void;
}

interface ChatToolbarProps {
  agentStatus: AgentStatus;
  memory: SessionMemory | null;
  speech: SpeechSession;
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  setTasksPanelOpen: (v: boolean) => void;
  setDiagPanelOpen: (v: boolean) => void;
  setStatusPanelOpen: (v: boolean) => void;
  onOpenMemory: () => void;
}

export function ChatToolbar({
  agentStatus,
  memory,
  speech,
  activeTab,
  setActiveTab,
  setTasksPanelOpen,
  setDiagPanelOpen,
  setStatusPanelOpen,
  onOpenMemory,
}: ChatToolbarProps) {
  return (
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
          <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-full border border-primary/30 bg-primary/5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs font-medium tracking-wider" style={{ color: "hsl(142 71% 60%)" }}>ONLINE</span>
          </div>

          {speech.isSupported && (
            <button
              onClick={() => { speech.unlock(); speech.setAutoSpeak(!speech.autoSpeak); }}
              className="w-8 h-8 rounded-xl border flex items-center justify-center transition-all duration-200 active:scale-95"
              style={{
                background: speech.autoSpeak ? "hsl(142 60% 40% / 0.15)" : "transparent",
                borderColor: speech.autoSpeak ? "hsl(142 60% 40% / 0.45)" : "hsl(210 15% 25%)",
              }}
              aria-label={speech.autoSpeak ? "Disable auto-speak" : "Enable auto-speak"}
            >
              {speech.autoSpeak
                ? <Volume2 className="w-4 h-4" style={{ color: "hsl(142 71% 60%)" }} />
                : <VolumeX className="w-4 h-4" style={{ color: "hsl(196 40% 40%)" }} />
              }
            </button>
          )}

          <button
            onClick={onOpenMemory}
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

      {/* Tab bar */}
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
  );
}
