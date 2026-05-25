/**
 * lib/runtime/index.ts — JarvisRuntime singleton.
 *
 * The central orchestration layer. Coordinates all subsystems through
 * typed events on the bus. Has no React dependency — survives re-renders,
 * route changes, and component unmounts.
 *
 * Bridges:
 *   SpeechManager  → speech:* events (state change only, not heartbeat noise)
 *   window.online  → network:* events
 *   visibilitychange → device:* events
 *
 * Responsibilities:
 *   - Subsystem health tracking
 *   - Notification lifecycle (auto-dismiss timers)
 *   - Structured logging (every bus event goes through RuntimeLogger)
 *   - React subscriber notifications (snapshot pattern)
 *   - Fatal error containment (all bridges wrapped in try/catch)
 */

import { EventBus } from "./eventBus";
import { RuntimeLogger } from "./logger";
import type {
  SubsystemHealth,
  SubsystemId,
  HealthStatus,
  Notification,
  NotificationLevel,
  RuntimeSnapshot,
  RuntimeEvent,
} from "./types";
import { SpeechManager } from "../speechManager";

// ── Constants ─────────────────────────────────────────────────────────────────

const SUBSYSTEM_LABELS: Record<SubsystemId, string> = {
  speech:  "Speech",
  stream:  "Stream",
  memory:  "Memory",
  tools:   "Tools",
  network: "Network",
};

const DEFAULT_NOTIFY_MS = 5_000;

// ── JarvisRuntime ─────────────────────────────────────────────────────────────

export class JarvisRuntime {
  private static _instance: JarvisRuntime | null = null;

  static getInstance(): JarvisRuntime {
    if (!JarvisRuntime._instance) {
      JarvisRuntime._instance = new JarvisRuntime();
    }
    return JarvisRuntime._instance;
  }

  readonly bus: EventBus;
  readonly log: RuntimeLogger;
  readonly startedAt: number;

  private _health: Record<SubsystemId, SubsystemHealth>;
  private _notifications: Notification[] = [];
  private _dismissTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private _isOnline: boolean;
  private _isVisible: boolean;
  private _subs = new Set<(snap: RuntimeSnapshot) => void>();

  private constructor() {
    this.bus     = new EventBus();
    this.log     = new RuntimeLogger();
    this.startedAt = Date.now();

    this._isOnline  = typeof navigator !== "undefined" ? navigator.onLine : true;
    this._isVisible = typeof document  !== "undefined" ? document.visibilityState !== "hidden" : true;

    // Initialise all subsystem health as "unknown"
    this._health = Object.fromEntries(
      (["speech", "stream", "memory", "tools", "network"] as SubsystemId[]).map(id => [
        id,
        {
          id,
          label: SUBSYSTEM_LABELS[id],
          status: "unknown" as HealthStatus,
          lastUpdated: Date.now(),
          errorCount: 0,
          lastError: null,
          meta: {},
        } satisfies SubsystemHealth,
      ]),
    ) as Record<SubsystemId, SubsystemHealth>;

    // Every bus event is logged
    this.bus.onAny(event => this.log.push(event));

    // Watch bus events for health tracking
    this._watchHealth();

    if (typeof window !== "undefined") {
      this._bridgeSpeech();
      this._bridgeNetwork();
      this._bridgeVisibility();
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  getSnapshot(): RuntimeSnapshot {
    return {
      health: { ...this._health },
      notifications: [...this._notifications],
      isOnline: this._isOnline,
      isVisible: this._isVisible,
      startedAt: this.startedAt,
    };
  }

  subscribe(fn: (snap: RuntimeSnapshot) => void): () => void {
    this._subs.add(fn);
    fn(this.getSnapshot());
    return () => this._subs.delete(fn);
  }

  /** Emit a user-visible notification (auto-dismisses after autoDismissMs). */
  notify(
    message: string,
    level: NotificationLevel = "info",
    autoDismissMs = DEFAULT_NOTIFY_MS,
  ): string {
    const id = crypto.randomUUID();
    const notification: Notification = { id, message, level, ts: Date.now(), autoDismissMs };
    this._notifications = [...this._notifications, notification];
    this.bus.emit({ type: "runtime:notify", notification, ts: Date.now() });
    this._scheduleAutoDismiss(id, autoDismissMs);
    this._notifyReact();
    return id;
  }

  dismiss(id: string): void {
    if (this._dismissTimers.has(id)) {
      clearTimeout(this._dismissTimers.get(id)!);
      this._dismissTimers.delete(id);
    }
    this._notifications = this._notifications.filter(n => n.id !== id);
    this.bus.emit({ type: "runtime:dismiss", notificationId: id, ts: Date.now() });
    this._notifyReact();
  }

  dismissAll(): void {
    for (const [id, timer] of this._dismissTimers) {
      clearTimeout(timer);
      this._dismissTimers.delete(id);
      this.bus.emit({ type: "runtime:dismiss", notificationId: id, ts: Date.now() });
    }
    this._notifications = [];
    this._notifyReact();
  }

  /** Forcefully update a subsystem's health (for external callers). */
  reportHealth(
    id: SubsystemId,
    status: HealthStatus,
    meta: Record<string, string> = {},
    error?: string,
  ): void {
    this._setHealth(id, status, error ?? null, meta);
    this.bus.emit({ type: "runtime:health", subsystem: id, status, ts: Date.now() });
  }

  // ── Health tracking from bus events ────────────────────────────────────────

  private _watchHealth(): void {
    // Speech
    this.bus.on("speech:state", e => {
      const status: HealthStatus =
        e.state === "error"      ? "error"   :
        e.state === "recovering" ? "degraded" :
        "healthy";
      this._setHealth("speech", status, null, { state: e.state });
    });
    this.bus.on("speech:error", e => {
      this._setHealth("speech", "error", e.error);
    });

    // Stream
    this.bus.on("stream:start", () => this._setHealth("stream", "healthy"));
    this.bus.on("stream:done",  e  => this._setHealth("stream", "healthy", null, { lastDuration: e.durationMs + "ms" }));
    this.bus.on("stream:error", e  => this._setHealth("stream", "degraded", e.error));

    // Tools
    this.bus.on("tool:start", e => this._setHealth("tools", "healthy", null, { lastTool: e.tool }));
    this.bus.on("tool:done",  e => this._setHealth("tools", "healthy", null, { lastTool: e.tool, lastDuration: e.durationMs + "ms" }));
    this.bus.on("tool:error", e => {
      this._setHealth("tools", "degraded", e.error, { lastTool: e.tool });
    });

    // Memory
    this.bus.on("memory:loaded",  e => this._setHealth("memory", "healthy", null, { messages: String(e.messageCount) }));
    this.bus.on("memory:updated", () => this._setHealth("memory", "healthy"));
    this.bus.on("memory:error",   e => this._setHealth("memory", "error", e.error));

    // Network
    this.bus.on("network:online",  () => { this._isOnline = true;  this._setHealth("network", "healthy"); this._notifyReact(); });
    this.bus.on("network:offline", () => { this._isOnline = false; this._setHealth("network", "error", "Device is offline"); this._notifyReact(); });
  }

  // ── Bridges ─────────────────────────────────────────────────────────────────

  private _bridgeSpeech(): void {
    try {
      let lastState = "";
      SpeechManager.getInstance().subscribe(snap => {
        try {
          if (snap.state === lastState) return;
          const prev = lastState;
          lastState = snap.state;
          this.bus.emit({ type: "speech:state", state: snap.state, prevState: prev, ts: Date.now() });
          if (snap.state === "speaking" && snap.currentMsgId) {
            this.bus.emit({ type: "speech:started", msgId: snap.currentMsgId, ts: Date.now() });
          }
          if (prev === "speaking" && snap.state === "idle" && snap.currentMsgId) {
            this.bus.emit({ type: "speech:ended", msgId: snap.currentMsgId, ts: Date.now() });
          }
          if (snap.state === "error" && snap.lastError) {
            this.bus.emit({ type: "speech:error", error: snap.lastError, ts: Date.now() });
          }
          // Keep speech health up to date
          if (snap.state === "error" && snap.lastError) {
            this.notify(`Speech error: ${snap.lastError}`, "warn", 4_000);
          }
        } catch { /* bridge errors must not crash subscriber iteration */ }
      });
    } catch (e) {
      console.error("[Runtime] speech bridge init failed:", e);
    }
  }

  private _bridgeNetwork(): void {
    try {
      // Set initial state
      this._setHealth("network", navigator.onLine ? "healthy" : "error", navigator.onLine ? null : "Offline");

      window.addEventListener("online", () => {
        this.bus.emit({ type: "network:online", ts: Date.now() });
        this.notify("Network connection restored", "success", 3_000);
      });
      window.addEventListener("offline", () => {
        this.bus.emit({ type: "network:offline", ts: Date.now() });
        this.notify("Network offline — messages may not send", "warn");
      });
    } catch (e) {
      console.error("[Runtime] network bridge init failed:", e);
    }
  }

  private _bridgeVisibility(): void {
    try {
      document.addEventListener("visibilitychange", () => {
        try {
          if (document.visibilityState === "hidden") {
            this._isVisible = false;
            this.bus.emit({ type: "device:hidden", ts: Date.now() });
          } else {
            this._isVisible = true;
            this.bus.emit({ type: "device:visible", ts: Date.now() });
          }
          this._notifyReact();
        } catch { /* ignore */ }
      });
    } catch (e) {
      console.error("[Runtime] visibility bridge init failed:", e);
    }
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private _setHealth(
    id: SubsystemId,
    status: HealthStatus,
    error: string | null = null,
    meta: Record<string, string> = {},
  ): void {
    const prev = this._health[id];
    const errorCount = error ? prev.errorCount + 1 : (status === "healthy" ? 0 : prev.errorCount);
    this._health = {
      ...this._health,
      [id]: {
        ...prev,
        status,
        lastUpdated: Date.now(),
        errorCount,
        lastError: error ?? (status === "healthy" ? null : prev.lastError),
        meta: { ...prev.meta, ...meta },
      },
    };
    this._notifyReact();
  }

  private _scheduleAutoDismiss(id: string, ms: number): void {
    const timer = setTimeout(() => {
      this._dismissTimers.delete(id);
      this._notifications = this._notifications.filter(n => n.id !== id);
      this.bus.emit({ type: "runtime:dismiss", notificationId: id, ts: Date.now() });
      this._notifyReact();
    }, ms);
    this._dismissTimers.set(id, timer);
  }

  private _notifyReact(): void {
    const snap = this.getSnapshot();
    for (const fn of this._subs) {
      try { fn(snap); } catch { /* subscriber errors must not crash runtime */ }
    }
  }
}

// Re-export everything consumers need from one import path
export type { RuntimeSnapshot, RuntimeEvent, SubsystemHealth, SubsystemId, HealthStatus, Notification };
export { EventBus } from "./eventBus";
export { RuntimeLogger } from "./logger";
