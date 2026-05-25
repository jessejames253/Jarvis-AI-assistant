/**
 * components/MemoryPanel.tsx — Slide-in memory & preferences panel
 *
 * Shows the user what Jarvis remembers about their session:
 *   - Total messages exchanged
 *   - Auto-generated summary of older conversations
 *   - Editable preferences (currently: name)
 *   - Clear memory button
 *   - New chat button (starts a fresh session)
 *
 * Opens from the right side on desktop, full-screen on mobile.
 * Triggered by the memory button (Brain icon) in the chat header.
 */

import { useState, useEffect, useRef } from "react";
import { X, Trash2, RotateCcw, ChevronDown, ChevronUp, Brain, Check } from "lucide-react";

export interface SessionMemory {
  sessionId: string;
  messages: Array<{ role: string; content: string; timestamp: string }>;
  summary: string | null;
  preferences: { name?: string; [key: string]: string | undefined };
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface MemoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  memory: SessionMemory | null;
  onMemoryCleared: () => void;       // Called after clearing — parent resets chat UI
  onNewSession: () => void;          // Called when user starts a fresh session
  onPreferencesSaved: (updated: SessionMemory) => void;
  apiBase: string;
}

export default function MemoryPanel({
  isOpen,
  onClose,
  sessionId,
  memory,
  onMemoryCleared,
  onNewSession,
  onPreferencesSaved,
  apiBase,
}: MemoryPanelProps) {
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [nameInput, setNameInput] = useState(memory?.preferences?.name ?? "");
  const [nameSaved, setNameSaved] = useState(false);
  const [isClearingMemory, setIsClearingMemory] = useState(false);
  const [isSavingName, setIsSavingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Sync nameInput when memory loads or changes
  useEffect(() => {
    setNameInput(memory?.preferences?.name ?? "");
  }, [memory?.preferences?.name]);

  // Focus name input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => nameInputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  /** Save user's name preference to the backend */
  async function saveName() {
    if (!nameInput.trim() && !memory?.preferences?.name) return;
    setIsSavingName(true);
    try {
      const res = await fetch(`${apiBase}api/memory/${sessionId}/prefs`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameInput.trim() || undefined }),
      });
      if (res.ok) {
        const updated = (await res.json()) as SessionMemory;
        onPreferencesSaved(updated);
        setNameSaved(true);
        setTimeout(() => setNameSaved(false), 2000);
      }
    } catch { /* silent fail */ }
    setIsSavingName(false);
  }

  /** Clear all messages, summary, and preferences for the current session */
  async function handleClearMemory() {
    if (!window.confirm("Clear all memory for this session? This cannot be undone.")) return;
    setIsClearingMemory(true);
    try {
      const res = await fetch(`${apiBase}api/memory/${sessionId}`, { method: "DELETE" });
      if (res.ok) {
        onMemoryCleared();
        onClose();
      }
    } catch { /* silent fail */ }
    setIsClearingMemory(false);
  }

  /** Format an ISO date string to a readable local date */
  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        month: "short", day: "numeric", year: "numeric",
      });
    } catch {
      return iso;
    }
  }

  return (
    <>
      {/* Backdrop — clicking it closes the panel */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Panel */}
      <div
        className={`fixed right-0 top-0 bottom-0 z-50 w-full sm:w-80 flex flex-col
          bg-card border-l border-border/60 shadow-2xl
          transition-transform duration-300 ease-in-out
          ${isOpen ? "translate-x-0" : "translate-x-full"}`}
        data-testid="memory-panel"
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4" style={{ color: "hsl(194 100% 55%)" }} />
            <span className="font-display text-sm font-semibold tracking-wider"
              style={{ color: "hsl(194 100% 60%)" }}>
              MEMORY
            </span>
          </div>
          <button
            onClick={onClose}
            data-testid="button-close-memory"
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors"
            aria-label="Close memory panel"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* ── Scrollable content ── */}
        <div className="flex-1 overflow-y-auto scrollbar-thin p-5 flex flex-col gap-6">

          {/* Session stats */}
          <section>
            <p className="text-xs tracking-wider font-medium mb-3" style={{ color: "hsl(196 40% 50%)" }}>
              SESSION INFO
            </p>
            <div className="bg-background/60 rounded-xl border border-border/40 p-3 flex flex-col gap-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Session ID</span>
                <span className="text-xs font-mono" style={{ color: "hsl(194 100% 55%)" }}>
                  {sessionId.slice(0, 8)}…
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Started</span>
                <span className="text-xs" style={{ color: "hsl(196 80% 80%)" }}>
                  {memory ? formatDate(memory.createdAt) : "—"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Total messages</span>
                <span className="text-xs font-semibold" style={{ color: "hsl(194 100% 60%)" }}>
                  {memory?.messageCount ?? 0}
                </span>
              </div>
            </div>
          </section>

          {/* Auto-summary (collapsible) */}
          {memory?.summary && (
            <section>
              <button
                className="w-full flex items-center justify-between mb-3"
                onClick={() => setSummaryExpanded((v) => !v)}
                data-testid="button-toggle-summary"
              >
                <p className="text-xs tracking-wider font-medium" style={{ color: "hsl(196 40% 50%)" }}>
                  CONVERSATION SUMMARY
                </p>
                {summaryExpanded
                  ? <ChevronUp className="w-3 h-3 text-muted-foreground" />
                  : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
              </button>
              {summaryExpanded && (
                <div className="bg-background/60 rounded-xl border border-border/40 p-3">
                  <p className="text-xs leading-relaxed whitespace-pre-line"
                    style={{ color: "hsl(196 60% 70%)" }}>
                    {memory.summary}
                  </p>
                </div>
              )}
              {!summaryExpanded && (
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                  {memory.summary.split("\n")[0]}
                </p>
              )}
            </section>
          )}

          {!memory?.summary && (
            <section>
              <p className="text-xs tracking-wider font-medium mb-3" style={{ color: "hsl(196 40% 50%)" }}>
                CONVERSATION SUMMARY
              </p>
              <div className="bg-background/60 rounded-xl border border-border/40 p-3">
                <p className="text-xs text-muted-foreground text-center py-2">
                  Auto-summary appears after longer conversations.
                </p>
              </div>
            </section>
          )}

          {/* Preferences */}
          <section>
            <p className="text-xs tracking-wider font-medium mb-3" style={{ color: "hsl(196 40% 50%)" }}>
              PREFERENCES
            </p>
            <div className="bg-background/60 rounded-xl border border-border/40 p-3 flex flex-col gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">
                  Your name (optional)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    ref={nameInputRef}
                    type="text"
                    data-testid="input-name-preference"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveName()}
                    placeholder="e.g. Alex"
                    maxLength={40}
                    className="flex-1 bg-card border border-border rounded-lg px-3 py-1.5 text-xs outline-none focus:border-primary/60 transition-colors"
                    style={{ color: "hsl(196 80% 80%)" }}
                  />
                  <button
                    onClick={saveName}
                    disabled={isSavingName}
                    data-testid="button-save-name"
                    className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors disabled:opacity-40"
                    style={{
                      background: nameSaved ? "hsl(142 71% 45% / 0.2)" : "hsl(194 100% 50% / 0.15)",
                      border: `1px solid ${nameSaved ? "hsl(142 71% 45% / 0.4)" : "hsl(194 100% 50% / 0.3)"}`,
                    }}
                    aria-label="Save name"
                  >
                    <Check className="w-3.5 h-3.5"
                      style={{ color: nameSaved ? "hsl(142 71% 60%)" : "hsl(194 100% 60%)" }} />
                  </button>
                </div>
                {nameSaved && (
                  <p className="text-xs mt-1.5" style={{ color: "hsl(142 71% 60%)" }}>
                    Saved — Jarvis will use your name in conversations.
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>

        {/* ── Actions footer ── */}
        <div className="flex-shrink-0 border-t border-border/60 p-4 flex flex-col gap-2">
          {/* New session */}
          <button
            onClick={() => { onNewSession(); onClose(); }}
            data-testid="button-new-session"
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-border/60 text-xs font-medium transition-colors hover:bg-white/5"
            style={{ color: "hsl(196 80% 75%)" }}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            New Session
          </button>

          {/* Clear memory */}
          <button
            onClick={handleClearMemory}
            disabled={isClearingMemory}
            data-testid="button-clear-memory"
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-destructive/30 bg-destructive/5 text-xs font-medium transition-colors hover:bg-destructive/10 disabled:opacity-40"
            style={{ color: "hsl(0 72% 65%)" }}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {isClearingMemory ? "Clearing…" : "Clear Memory"}
          </button>
        </div>
      </div>
    </>
  );
}
