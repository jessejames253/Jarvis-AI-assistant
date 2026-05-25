/**
 * lib/runtime/types.ts — Typed contract for the Jarvis runtime layer.
 *
 * Every subsystem communicates exclusively through these types.
 * No subsystem imports another subsystem directly — only the event bus.
 */

// ── Subsystems ────────────────────────────────────────────────────────────────

export type SubsystemId = "speech" | "stream" | "memory" | "tools" | "network";

export type HealthStatus =
  | "healthy"    // operating normally
  | "degraded"   // working but with errors
  | "error"      // critically failed, needs recovery
  | "offline"    // device capability absent (e.g. no mic)
  | "unknown";   // not yet initialized

export interface SubsystemHealth {
  id: SubsystemId;
  label: string;
  status: HealthStatus;
  lastUpdated: number;
  errorCount: number;
  lastError: string | null;
  /** Arbitrary key/value pairs for display in the inspector */
  meta: Record<string, string>;
}

// ── Notifications ─────────────────────────────────────────────────────────────

export type NotificationLevel = "info" | "success" | "warn" | "error";

export interface Notification {
  id: string;
  message: string;
  level: NotificationLevel;
  ts: number;
  autoDismissMs: number;
}

// ── Typed event catalog ───────────────────────────────────────────────────────
// Each event must carry `ts: number` (Date.now()).
// Namespaced by subsystem: "speech:*" "stream:*" "tool:*" "memory:*" "network:*" "device:*" "runtime:*"

export type RuntimeEvent =
  // Speech
  | { type: "speech:state";   state: string; prevState: string; ts: number }
  | { type: "speech:started"; msgId: string; ts: number }
  | { type: "speech:ended";   msgId: string; ts: number }
  | { type: "speech:error";   error: string; ts: number }
  | { type: "speech:queued";  msgId: string; priority: number; ts: number }
  // Stream
  | { type: "stream:start";   sessionId: string; ts: number }
  | { type: "stream:done";    sessionId: string; durationMs: number; tokens: number; ts: number }
  | { type: "stream:error";   error: string; ts: number }
  | { type: "stream:recover"; attempt: number; ts: number }
  // Tools
  | { type: "tool:start"; tool: string; label: string; ts: number }
  | { type: "tool:done";  tool: string; durationMs: number; ts: number }
  | { type: "tool:error"; tool: string; error: string; ts: number }
  // Memory
  | { type: "memory:loaded";  sessionId: string; messageCount: number; ts: number }
  | { type: "memory:updated"; ts: number }
  | { type: "memory:error";   error: string; ts: number }
  // Network / Device
  | { type: "network:online";  ts: number }
  | { type: "network:offline"; ts: number }
  | { type: "device:visible";  ts: number }
  | { type: "device:hidden";   ts: number }
  // Runtime meta
  | { type: "runtime:notify";  notification: Notification; ts: number }
  | { type: "runtime:dismiss"; notificationId: string; ts: number }
  | { type: "runtime:health";  subsystem: SubsystemId; status: HealthStatus; ts: number }
  | { type: "runtime:recover"; subsystem: SubsystemId; ts: number };

// ── Snapshot (what React subscribes to) ──────────────────────────────────────

export interface RuntimeSnapshot {
  health: Record<SubsystemId, SubsystemHealth>;
  notifications: Notification[];
  isOnline: boolean;
  isVisible: boolean;
  startedAt: number;
}
