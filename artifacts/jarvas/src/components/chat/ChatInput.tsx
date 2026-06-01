import { type RefObject } from "react";
import { Send, Mic, MicOff, ListChecks } from "lucide-react";

interface SpeechInputState {
  isSupported: boolean;
  isListening: boolean;
  permissionDenied: boolean;
}

interface ChatInputProps {
  input: string;
  handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  isTyping: boolean;
  isStreaming: boolean;
  onSend: () => void;
  onSendPlan: () => void;
  speechInput: SpeechInputState;
  onToggleMic: () => void;
  autoPlannerEnabled: boolean;
  onToggleAutoPlanner: () => void;
  activeTab: string;
}

export function ChatInput({
  input,
  handleInputChange,
  handleKeyDown,
  textareaRef,
  isTyping,
  isStreaming,
  onSend,
  onSendPlan,
  speechInput,
  onToggleMic,
  autoPlannerEnabled,
  onToggleAutoPlanner,
  activeTab,
}: ChatInputProps) {
  if (activeTab === "debug" || activeTab === "dev") return null;

  return (
    <footer
      className="relative z-10 flex-shrink-0 border-t border-border/60 bg-background/90 backdrop-blur-sm px-3 sm:px-8 pt-3 pb-safe"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
    >
      <div className="max-w-3xl mx-auto">
        {/* Auto-planner toggle row */}
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs" style={{ color: "hsl(196 20% 38%)" }}>Auto-route complex tasks to Planner</span>
          <button
            type="button"
            onClick={onToggleAutoPlanner}
            className="relative w-8 h-4 rounded-full transition-colors duration-200 flex-shrink-0"
            style={{
              background: autoPlannerEnabled ? "hsl(270 70% 50% / 0.7)" : "hsl(210 15% 20%)",
              border: `1px solid ${autoPlannerEnabled ? "hsl(270 100% 65% / 0.5)" : "hsl(210 15% 26%)"}`,
            }}
            aria-label={autoPlannerEnabled ? "Disable auto-planner" : "Enable auto-planner"}
            title={autoPlannerEnabled ? "Auto-Planner ON" : "Auto-Planner OFF"}
          >
            <span
              className="absolute top-0.5 w-3 h-3 rounded-full transition-all duration-200"
              style={{
                background: autoPlannerEnabled ? "hsl(270 100% 82%)" : "hsl(210 15% 42%)",
                left: autoPlannerEnabled ? "calc(100% - 13px)" : "1px",
              }}
            />
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

          {/* Mic button */}
          {speechInput.isSupported && (
            <div className="relative flex-shrink-0">
              {speechInput.isListening && (
                <span className="mic-recording-ring" aria-hidden="true" />
              )}
              <button
                data-testid="button-mic"
                onClick={onToggleMic}
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
                  background: speechInput.isListening ? "hsl(355 80% 28% / 0.4)" : "hsl(194 100% 55% / 0.12)",
                  border: `1px solid ${speechInput.isListening ? "hsl(355 80% 50%)" : "hsl(194 100% 55% / 0.3)"}`,
                  color: speechInput.isListening
                    ? "hsl(355 80% 62%)"
                    : speechInput.permissionDenied
                      ? "hsl(196 20% 35%)"
                      : "hsl(194 100% 55%)",
                }}
              >
                {speechInput.isListening
                  ? <MicOff className="w-4 h-4 mic-recording" />
                  : <Mic className="w-4 h-4" />
                }
              </button>
            </div>
          )}

          {/* Plan button */}
          <button
            data-testid="button-plan"
            type="button"
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); onSendPlan(); }}
            disabled={!input.trim() || isTyping || isStreaming}
            title="Run autonomous plan"
            aria-label="Run autonomous plan"
            className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ border: "2px solid hsl(270 100% 65%)", background: "hsl(270 80% 55% / 0.18)" }}
          >
            <ListChecks className="w-4 h-4" style={{ color: "hsl(270 100% 75%)" }} />
          </button>

          {/* Send button */}
          <button
            data-testid="button-send"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              console.log("[Chat] sendMessage entered from send button");
              onSend();
            }}
            disabled={!input.trim() || isTyping || isStreaming}
            className="flex-shrink-0 w-9 h-9 rounded-xl bg-primary flex items-center justify-center transition-all duration-200 hover:bg-primary/80 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed glow-primary"
            aria-label="Send message"
          >
            <Send className="w-4 h-4" style={{ color: "hsl(220 20% 6%)" }} />
          </button>
        </div>

        <p className="hidden sm:block text-center text-xs mt-2 tracking-wider" style={{ color: "hsl(196 30% 40%)" }}>
          Intent-routed · Web search · Persistent memory · Press ⌘ to toggle debug
        </p>
      </div>
    </footer>
  );
}
