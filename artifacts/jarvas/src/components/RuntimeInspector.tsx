/**
 * components/RuntimeInspector.tsx — Jarvis runtime debug panel.
 *
 * Shown when debug mode is active. Floating panel, bottom-right.
 *
 * Collapsed: 5 subsystem health dots + RUNTIME label.
 * Expanded:  health grid + live event timeline (last 25 events).
 *
 * Takes no props — subscribes to JarvisRuntime directly.
 */

import { useState } from "react";
import { useRuntime, useRuntimeLog } from "@/hooks/useRuntime";
import type { SubsystemId, HealthStatus, RuntimeEvent } from "@/lib/runtime/types";

// ── Styling maps ──────────────────────────────────────────────────────────────

const HEALTH_COLOR: Record<HealthStatus, string> = {
  healthy:  "hsl(142 71% 52%)",
  degraded: "hsl(38 100% 60%)",
  error:    "hsl(355 80% 60%)",
  offline:  "hsl(210 20% 38%)",
  unknown:  "hsl(210 20% 30%)",
};

const HEALTH_BG: Record<HealthStatus, string> = {
  healthy:  "hsl(142 71% 40% / 0.12)",
  degraded: "hsl(38 100% 40% / 0.12)",
  error:    "hsl(355 80% 40% / 0.12)",
  offline:  "hsl(210 20% 15% / 0.4)",
  unknown:  "hsl(210 20% 12% / 0.4)",
};

const HEALTH_BORDER: Record<HealthStatus, string> = {
  healthy:  "hsl(142 71% 40% / 0.3)",
  degraded: "hsl(38 100% 40% / 0.3)",
  error:    "hsl(355 80% 40% / 0.35)",
  offline:  "hsl(210 20% 20%)",
  unknown:  "hsl(210 20% 18%)",
};

// Event namespace → display color
function eventColor(type: string): string {
  if (type.startsWith("speech"))  return "hsl(142 60% 52%)";
  if (type.startsWith("stream"))  return "hsl(194 100% 60%)";
  if (type.startsWith("tool"))    return "hsl(38 100% 62%)";
  if (type.startsWith("memory"))  return "hsl(264 70% 68%)";
  if (type.startsWith("network")) return "hsl(25 100% 60%)";
  if (type.startsWith("device"))  return "hsl(196 50% 55%)";
  if (type.startsWith("runtime")) return "hsl(210 20% 50%)";
  return "hsl(210 20% 45%)";
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtAge(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`;
}

function eventLabel(e: RuntimeEvent): string {
  switch (e.type) {
    case "speech:state":   return `speech → ${e.state}`;
    case "speech:started": return `speaking: ${e.msgId.slice(0, 12)}`;
    case "speech:ended":   return `speech done`;
    case "speech:error":   return `speech err: ${e.error}`;
    case "stream:start":   return `stream start`;
    case "stream:done":    return `stream done (${e.durationMs}ms, ${e.tokens} tok)`;
    case "stream:error":   return `stream error`;
    case "tool:start":     return `tool: ${e.tool}`;
    case "tool:done":      return `✓ ${e.tool} (${e.durationMs}ms)`;
    case "tool:error":     return `✕ ${e.tool}: ${e.error.slice(0, 30)}`;
    case "memory:loaded":  return `memory loaded (${e.messageCount} msgs)`;
    case "memory:error":   return `memory error`;
    case "network:online": return `network online`;
    case "network:offline":return `network OFFLINE`;
    case "device:visible": return `tab visible`;
    case "device:hidden":  return `tab hidden`;
    case "runtime:notify": return `notify: ${e.notification.message.slice(0, 30)}`;
    case "runtime:dismiss":return `dismissed ${e.notificationId.slice(0, 8)}`;
    case "runtime:health": return `health[${e.subsystem}] → ${e.status}`;
    case "runtime:recover":return `recover: ${e.subsystem}`;
    default:               return (e as RuntimeEvent).type;
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HealthDot({ id, status, pulse }: { id: string; status: HealthStatus; pulse?: boolean }) {
  return (
    <div title={`${id}: ${status}`}>
      <div
        className={`w-2 h-2 rounded-full ${pulse && status !== "unknown" && status !== "offline" ? "animate-pulse" : ""}`}
        style={{ background: HEALTH_COLOR[status] }}
      />
    </div>
  );
}

function HealthChip({
  id,
  status,
  errorCount,
  meta,
}: {
  id: SubsystemId;
  status: HealthStatus;
  errorCount: number;
  meta: Record<string, string>;
}) {
  const color  = HEALTH_COLOR[status];
  const bg     = HEALTH_BG[status];
  const border = HEALTH_BORDER[status];
  const metaStr = Object.entries(meta)
    .map(([k, v]) => `${k}:${v}`)
    .join(" · ")
    .slice(0, 40);

  return (
    <div
      className="flex flex-col gap-0.5 px-2 py-1.5 rounded-lg border"
      style={{ background: bg, borderColor: border }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-mono font-bold tracking-wider" style={{ color }}>
          {id.toUpperCase()}
        </span>
        {errorCount > 0 && (
          <span className="text-xs font-mono" style={{ color: "hsl(355 80% 60%)" }}>
            ×{errorCount}
          </span>
        )}
      </div>
      <span className="text-xs font-mono" style={{ color: "hsl(196 30% 45%)" }}>
        {status}
        {metaStr ? ` · ${metaStr}` : ""}
      </span>
    </div>
  );
}

function EventRow({ event }: { event: RuntimeEvent }) {
  const color = eventColor(event.type);
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="flex-shrink-0 text-xs font-mono opacity-40" style={{ color: "hsl(196 30% 50%)", fontSize: "10px" }}>
        {fmtTime(event.ts)}
      </span>
      <span className="text-xs font-mono truncate" style={{ color }}>
        {eventLabel(event)}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RuntimeInspector() {
  const [expanded, setExpanded] = useState(false);
  const { health, isOnline, isVisible, startedAt, clearLog } = useRuntime();
  const events = useRuntimeLog(25);

  const subsystems = Object.values(health) as Array<typeof health[SubsystemId]>;
  const hasError = subsystems.some(s => s.status === "error");
  const hasDegraded = subsystems.some(s => s.status === "degraded");
  const uptime = fmtAge(startedAt);

  return (
    <div
      className="fixed bottom-24 right-3 z-50 select-none"
      style={{ fontFamily: "'Courier New', Courier, monospace", maxWidth: 280 }}
    >
      <div
        className="rounded-xl border overflow-hidden shadow-2xl"
        style={{
          background: "hsl(220 20% 5% / 0.93)",
          borderColor: hasError
            ? "hsl(355 80% 40% / 0.45)"
            : hasDegraded
              ? "hsl(38 100% 40% / 0.4)"
              : "hsl(210 15% 18%)",
          backdropFilter: "blur(10px)",
        }}
      >
        {/* ── Header (always visible) ── */}
        <button
          className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-white/5 transition-colors"
          onClick={() => setExpanded(v => !v)}
        >
          <span className="text-xs font-mono tracking-widest" style={{ color: "hsl(196 40% 38%)" }}>
            RUNTIME
          </span>

          {/* Subsystem health dots */}
          <div className="flex items-center gap-1 flex-1">
            {subsystems.map(s => (
              <HealthDot
                key={s.id}
                id={s.id}
                status={s.status}
                pulse={s.status === "degraded" || s.status === "error"}
              />
            ))}
          </div>

          {/* Indicators */}
          {!isOnline && (
            <span className="text-xs font-mono px-1 rounded" style={{ background: "hsl(355 80% 40% / 0.2)", color: "hsl(355 80% 65%)" }}>
              OFFLINE
            </span>
          )}
          {!isVisible && (
            <span className="text-xs" style={{ color: "hsl(210 20% 38%)" }}>bg</span>
          )}
          <span className="text-xs" style={{ color: "hsl(210 20% 32%)" }}>
            {expanded ? "▼" : "▲"}
          </span>
        </button>

        {/* ── Expanded ── */}
        {expanded && (
          <>
            <div style={{ height: 1, background: "hsl(210 15% 12%)" }} />

            {/* Subsystem health grid */}
            <div className="p-2 grid grid-cols-2 gap-1.5">
              {subsystems.map(s => (
                <HealthChip
                  key={s.id}
                  id={s.id as SubsystemId}
                  status={s.status}
                  errorCount={s.errorCount}
                  meta={s.meta}
                />
              ))}
            </div>

            <div style={{ height: 1, background: "hsl(210 15% 12%)" }} />

            {/* Event timeline */}
            <div className="px-2.5 py-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs tracking-wider" style={{ color: "hsl(196 40% 35%)", fontSize: "10px" }}>
                  EVENT LOG · {events.length} recent
                </span>
                <button
                  onClick={e => { e.stopPropagation(); clearLog(); }}
                  className="text-xs opacity-40 hover:opacity-80 transition-opacity"
                  style={{ color: "hsl(196 40% 50%)", fontSize: "10px" }}
                >
                  CLEAR
                </button>
              </div>

              {events.length === 0 ? (
                <p className="text-xs" style={{ color: "hsl(210 20% 30%)" }}>No events yet</p>
              ) : (
                <div className="flex flex-col" style={{ maxHeight: 180, overflowY: "auto" }}>
                  {[...events].reverse().map((e, i) => (
                    <EventRow key={i} event={e} />
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ height: 1, background: "hsl(210 15% 12%)" }} />
            <div className="flex items-center gap-3 px-2.5 py-1.5">
              <span className="text-xs font-mono" style={{ color: "hsl(196 30% 32%)", fontSize: "10px" }}>
                UP {uptime}
              </span>
              <span className="text-xs font-mono" style={{ color: isOnline ? "hsl(142 60% 40%)" : "hsl(355 80% 50%)", fontSize: "10px" }}>
                {isOnline ? "● ONLINE" : "● OFFLINE"}
              </span>
              {!isVisible && (
                <span className="text-xs font-mono" style={{ color: "hsl(38 60% 45%)", fontSize: "10px" }}>
                  BG
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
