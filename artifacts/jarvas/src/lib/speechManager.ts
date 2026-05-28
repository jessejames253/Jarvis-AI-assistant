import { generateId } from "./uuid";

/**
 * lib/speechManager.ts — Global singleton speech manager
 *
 * Owns ALL SpeechSynthesis interaction. Lives outside React so it survives
 * re-renders, route changes, and component unmounts.
 *
 * State machine:
 *   idle ──► preparing ──► speaking ──► idle
 *                              │
 *                              ├──► paused ──► speaking  (visibilitychange)
 *                              ├──► interrupted ──► preparing  (new item)
 *                              └──► recovering ──► idle | error
 *
 * iOS resilience:
 *   • 150 ms cancel→speak gap (iOS drops utterance if too fast)
 *   • 5 s heartbeat resume() loop (iOS stalls synth mid-sentence)
 *   • visibilitychange resume on tab-return
 *   • watchdog timer resets state if onend never fires
 *   • audio unlock on first user gesture
 */

export type SpeechState =
  | "idle"
  | "preparing"
  | "speaking"
  | "paused"
  | "interrupted"
  | "recovering"
  | "error";

export interface QueueItem {
  id: string;
  msgId: string;
  text: string;
  priority: number;
  enqueuedAt: number;
}

export interface SpeechSnapshot {
  state: SpeechState;
  currentMsgId: string | null;
  queueDepth: number;
  speakStartTime: number | null;
  lastError: string | null;
  watchdogActive: boolean;
  heartbeatTick: number;
  utteranceCount: number;
  audioUnlocked: boolean;
  autoSpeak: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────

const CANCEL_GAP_MS       = 150;
const HEARTBEAT_MS        = 5_000;
const WATCHDOG_BUFFER_MS  = 8_000;
const WORDS_PER_MIN       = 140;
const ERROR_COOLDOWN_MS   = 2_000;
const AUTOSPEAK_KEY       = "jarvas_autospeak";

function slog(event: string, ...rest: unknown[]): void {
  console.debug("[Speech]", event, ...rest);
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "code block omitted")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/>\s+/gm, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .trim();
}

// ── SpeechManager singleton ────────────────────────────────────────────────

export class SpeechManager {
  private static _instance: SpeechManager | null = null;

  static getInstance(): SpeechManager {
    if (!SpeechManager._instance) {
      SpeechManager._instance = new SpeechManager();
    }
    return SpeechManager._instance;
  }

  // ── State ────────────────────────────────────────────────────────────────

  private _state: SpeechState = "idle";
  private _queue: QueueItem[] = [];
  private _currentItem: QueueItem | null = null;
  private _speakStartTime: number | null = null;
  private _lastError: string | null = null;
  private _watchdogActive = false;
  private _heartbeatTick = 0;
  private _utteranceCount = 0;
  private _audioUnlocked = false;
  private _autoSpeak: boolean;

  // ── Timers (all named to allow targeted cancellation) ────────────────────

  private _gapId: ReturnType<typeof setTimeout> | null = null;
  private _watchdogId: ReturnType<typeof setTimeout> | null = null;
  private _heartbeatId: ReturnType<typeof setInterval> | null = null;
  private _cooldownId: ReturnType<typeof setTimeout> | null = null;
  private _nextGapId: ReturnType<typeof setTimeout> | null = null;

  // ── Active utterance (must hold ref to prevent GC before onend) ──────────

  private _utterance: SpeechSynthesisUtterance | null = null;

  // ── Subscribers ──────────────────────────────────────────────────────────

  private _subs = new Set<(snap: SpeechSnapshot) => void>();

  // ── Constructor ──────────────────────────────────────────────────────────

  private constructor() {
    try {
      this._autoSpeak = localStorage.getItem(AUTOSPEAK_KEY) === "true";
    } catch {
      this._autoSpeak = false;
    }

    if (typeof window === "undefined" || !window.speechSynthesis) return;
    this._startHeartbeat();
    this._registerVisibilityHandler();
  }

  // ── Public getters ───────────────────────────────────────────────────────

  get isSupported(): boolean {
    return typeof window !== "undefined" && !!window.speechSynthesis;
  }

  get autoSpeak(): boolean {
    return this._autoSpeak;
  }

  getSnapshot(): SpeechSnapshot {
    return {
      state: this._state,
      currentMsgId: this._currentItem?.msgId ?? null,
      queueDepth: this._queue.length,
      speakStartTime: this._speakStartTime,
      lastError: this._lastError,
      watchdogActive: this._watchdogActive,
      heartbeatTick: this._heartbeatTick,
      utteranceCount: this._utteranceCount,
      audioUnlocked: this._audioUnlocked,
      autoSpeak: this._autoSpeak,
    };
  }

  // ── Subscriber pattern ───────────────────────────────────────────────────

  subscribe(fn: (snap: SpeechSnapshot) => void): () => void {
    this._subs.add(fn);
    fn(this.getSnapshot());
    return () => this._subs.delete(fn);
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Unlock audio context on first user gesture (iOS requirement).
   * Safe to call multiple times — no-op after first unlock.
   */
  unlock(): void {
    if (this._audioUnlocked || !this.isSupported) return;
    try {
      const silent = new SpeechSynthesisUtterance("");
      silent.volume = 0;
      window.speechSynthesis.speak(silent);
      setTimeout(() => window.speechSynthesis.cancel(), 50);
      this._audioUnlocked = true;
      slog("audio unlocked");
      this._notify();
    } catch {
      /* ignore */
    }
  }

  /**
   * Enqueue text to speak.
   * - interrupt=true  → cancel current + flush queue, speak immediately (default)
   * - interrupt=false → add to priority queue; plays after current finishes
   */
  enqueue(
    msgId: string,
    rawText: string,
    opts: { interrupt?: boolean; priority?: number } = {},
  ): void {
    if (!this.isSupported) return;

    const { interrupt = true, priority = 0 } = opts;
    const text = stripMarkdown(rawText);
    if (!text.trim()) return;

    const item: QueueItem = {
      id: generateId(),
      msgId,
      text,
      priority,
      enqueuedAt: Date.now(),
    };

    if (interrupt) {
      this._interrupt(item);
    } else {
      this._queue.push(item);
      this._queue.sort((a, b) => b.priority - a.priority || a.enqueuedAt - b.enqueuedAt);
      slog("enqueued:", msgId, "depth:", this._queue.length);
      this._notify();
      if (this._state === "idle") this._processNext();
    }
  }

  /** Stop speaking immediately and flush the queue. */
  cancelAll(): void {
    slog("speech cancelled (cancelAll)");
    this._clearGap();
    this._clearWatchdog();
    this._clearNextGap();
    if (this._cooldownId !== null) {
      clearTimeout(this._cooldownId);
      this._cooldownId = null;
    }
    this._queue = [];
    this._currentItem = null;
    this._utterance = null;
    this._speakStartTime = null;
    if (this.isSupported) window.speechSynthesis.cancel();
    this._setState("idle");
  }

  setAutoSpeak(val: boolean): void {
    this._autoSpeak = val;
    try {
      localStorage.setItem(AUTOSPEAK_KEY, String(val));
    } catch {
      /* ignore */
    }
    slog("auto-speak:", val);
    this._notify();
  }

  // ── State machine ────────────────────────────────────────────────────────

  private _setState(s: SpeechState): void {
    if (this._state === s) return;
    slog("state:", this._state, "→", s);
    this._state = s;
    if (s !== "speaking" && s !== "paused") {
      this._speakStartTime = null;
    }
    if (s !== "speaking") {
      this._watchdogActive = false;
    }
    this._notify();
  }

  private _notify(): void {
    const snap = this.getSnapshot();
    for (const fn of this._subs) {
      try {
        fn(snap);
      } catch {
        /* subscriber errors must not crash the manager */
      }
    }
  }

  // ── Queue management ─────────────────────────────────────────────────────

  /**
   * Interrupt: cancel current utterance, discard old queue, enqueue new item.
   * The iOS cancel→speak gap is built in here — subsequent calls within the
   * gap cancel the previous pending speak (natural debounce via timer replacement).
   */
  private _interrupt(item: QueueItem): void {
    slog("interrupt:", item.msgId);
    this._clearGap();
    this._clearWatchdog();
    this._clearNextGap();
    this._queue = [item];
    this._currentItem = null;
    this._utterance = null;
    this._speakStartTime = null;
    if (this.isSupported) window.speechSynthesis.cancel();
    this._setState("interrupted");
    // The gap timer acts as a natural debounce: rapid calls clear & restart it
    this._gapId = setTimeout(() => {
      this._gapId = null;
      this._processNext();
    }, CANCEL_GAP_MS);
  }

  private _processNext(): void {
    if (this._queue.length === 0) {
      this._currentItem = null;
      this._setState("idle");
      return;
    }
    const item = this._queue.shift()!;
    this._currentItem = item;
    this._setState("preparing");
    this._doSpeak(item);
  }

  private _doSpeak(item: QueueItem): void {
    if (!this.isSupported) return;

    const utt = new SpeechSynthesisUtterance(item.text);
    utt.rate   = 1.05;
    utt.pitch  = 0.88;
    utt.volume = 1;

    const pickVoice = (): SpeechSynthesisVoice | null => {
      const voices = window.speechSynthesis.getVoices();
      return (
        voices.find(
          (v) =>
            /daniel|alex|samantha|google.*en|en-us/i.test(v.name) &&
            v.lang.startsWith("en"),
        ) ??
        voices.find((v) => v.lang.startsWith("en")) ??
        null
      );
    };

    const voice = pickVoice();
    if (voice) {
      utt.voice = voice;
    } else {
      const onChanged = () => {
        const v = pickVoice();
        if (v) utt.voice = v;
        window.speechSynthesis.removeEventListener("voiceschanged", onChanged);
        slog("voices loaded:", window.speechSynthesis.getVoices().length);
      };
      window.speechSynthesis.addEventListener("voiceschanged", onChanged);
    }

    utt.onstart = () => {
      // Guard: if we've already been cancelled while preparing, abandon
      if (this._currentItem?.id !== item.id) return;
      slog("speech started:", item.msgId);
      this._speakStartTime = Date.now();
      this._utteranceCount++;
      this._clearWatchdog();
      this._setState("speaking");

      // Start watchdog
      const words = item.text.split(/\s+/).length;
      const estimated = Math.max(12_000, Math.ceil((words / WORDS_PER_MIN) * 60_000)) + WATCHDOG_BUFFER_MS;
      this._watchdogActive = true;
      this._notify();
      this._watchdogId = setTimeout(() => {
        this._watchdogId = null;
        slog("watchdog fired — recovering");
        this._recover("watchdog timeout after " + estimated + "ms");
      }, estimated);
    };

    utt.onend = () => {
      if (this._currentItem?.id !== item.id) return;
      slog("speech ended:", item.msgId);
      this._clearWatchdog();
      this._utterance = null;

      if (this._state === "speaking" || this._state === "paused") {
        if (this._queue.length > 0) {
          this._setState("interrupted");
          this._nextGapId = setTimeout(() => {
            this._nextGapId = null;
            this._processNext();
          }, 50);
        } else {
          this._currentItem = null;
          this._setState("idle");
        }
      }
    };

    utt.onerror = (e: SpeechSynthesisErrorEvent) => {
      // iOS fires "interrupted"/"canceled" for intentional cancel() — not real errors
      if (e.error === "interrupted" || e.error === "canceled") {
        slog("speech cancelled/interrupted (expected):", e.error);
        return;
      }
      slog("speech error:", e.error);
      this._lastError = e.error;
      this._clearWatchdog();
      this._utterance = null;
      this._setState("error");
      this._notify();
      this._cooldownId = setTimeout(() => {
        this._cooldownId = null;
        this._currentItem = null;
        this._queue = [];
        this._setState("idle");
      }, ERROR_COOLDOWN_MS);
    };

    // Hold ref to prevent GC before onend fires
    this._utterance = utt;
    window.speechSynthesis.speak(utt);
    slog("speech queued:", item.msgId);
  }

  // ── Recovery ─────────────────────────────────────────────────────────────

  private _recover(reason: string): void {
    slog("recovery triggered:", reason);
    this._clearWatchdog();
    this._clearGap();
    this._clearNextGap();
    if (this.isSupported) window.speechSynthesis.cancel();
    this._utterance = null;
    this._speakStartTime = null;
    this._setState("recovering");
    this._notify();
    this._cooldownId = setTimeout(() => {
      this._cooldownId = null;
      this._currentItem = null;
      if (this._queue.length > 0) {
        this._processNext();
      } else {
        this._setState("idle");
      }
    }, 500);
  }

  // ── iOS resilience ───────────────────────────────────────────────────────

  private _startHeartbeat(): void {
    this._heartbeatId = setInterval(() => {
      if (!this.isSupported) return;
      const ss = window.speechSynthesis;
      if (ss.speaking && !ss.paused) {
        ss.resume();
        this._heartbeatTick = Date.now();
        this._notify();
      }
    }, HEARTBEAT_MS);
  }

  private _registerVisibilityHandler(): void {
    document.addEventListener("visibilitychange", () => {
      if (!this.isSupported) return;
      const ss = window.speechSynthesis;
      if (document.visibilityState === "visible") {
        if (ss.paused) {
          slog("tab visible — resuming paused synth");
          ss.resume();
          if (this._state === "paused") this._setState("speaking");
        }
      } else if (document.visibilityState === "hidden") {
        if (this._state === "speaking") {
          slog("tab hidden — synth may pause");
          this._setState("paused");
        }
      }
    });
  }

  // ── Timer helpers ────────────────────────────────────────────────────────

  private _clearGap(): void {
    if (this._gapId !== null) {
      clearTimeout(this._gapId);
      this._gapId = null;
    }
  }

  private _clearWatchdog(): void {
    if (this._watchdogId !== null) {
      clearTimeout(this._watchdogId);
      this._watchdogId = null;
    }
    this._watchdogActive = false;
  }

  private _clearNextGap(): void {
    if (this._nextGapId !== null) {
      clearTimeout(this._nextGapId);
      this._nextGapId = null;
    }
  }
}
