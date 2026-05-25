/**
 * components/SpeechDebugOverlay.tsx — Floating speech state machine HUD
 *
 * Visible only when debug mode is active. Collapses to a small badge
 * when idle. Shows live speaking duration, queue depth, watchdog status,
 * heartbeat activity, utterance count, and last error.
 */

import { useState, useEffect } from "react";
import type { SpeechSession } from "@/hooks/useSpeechSession";

interface Props {
  speech: SpeechSession;
}

const STATE_META: Record<
  string,
  { color: string; bg: string; border: string; pulse?: boolean }
> = {
  idle:        { color: "hsl(210 20% 45%)",   bg: "hsl(210 20% 8%)",         border: "hsl(210 20% 20%)" },
  preparing:   { color: "hsl(55 100% 60%)",   bg: "hsl(55 100% 40% / 0.1)",  border: "hsl(55 100% 40% / 0.35)", pulse: true },
  speaking:    { color: "hsl(142 71% 55%)",   bg: "hsl(142 71% 40% / 0.1)",  border: "hsl(142 71% 40% / 0.4)",  pulse: true },
  paused:      { color: "hsl(38 100% 60%)",   bg: "hsl(38 100% 40% / 0.1)",  border: "hsl(38 100% 40% / 0.35)" },
  interrupted: { color: "hsl(210 90% 65%)",   bg: "hsl(210 90% 55% / 0.1)",  border: "hsl(210 90% 55% / 0.35)", pulse: true },
  recovering:  { color: "hsl(38 100% 60%)",   bg: "hsl(38 100% 40% / 0.1)",  border: "hsl(38 100% 40% / 0.35)", pulse: true },
  error:       { color: "hsl(355 80% 62%)",   bg: "hsl(355 80% 40% / 0.1)",  border: "hsl(355 80% 40% / 0.35)" },
};

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m${s % 60}s` : `${s}s`;
}

function timeSince(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

export default function SpeechDebugOverlay({ speech }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [hbAge, setHbAge] = useState(0);

  // Live speaking duration counter
  useEffect(() => {
    if (!speech.speakStartTime) {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => {
      setElapsed(Date.now() - (speech.speakStartTime ?? Date.now()));
    }, 500);
    return () => clearInterval(id);
  }, [speech.speakStartTime]);

  // Heartbeat age counter
  useEffect(() => {
    const id = setInterval(() => setHbAge(Date.now()), 2000);
    return () => clearInterval(id);
  }, []);

  const meta = STATE_META[speech.state] ?? STATE_META.idle;
  const isIdle = speech.state === "idle";

  return (
    <div
      className="fixed bottom-24 right-3 z-50 select-none"
      style={{ fontFamily: "'Courier New', Courier, monospace" }}
    >
      <div
        className="rounded-xl border overflow-hidden shadow-2xl"
        style={{
          background: "hsl(220 20% 5% / 0.92)",
          borderColor: meta.border,
          backdropFilter: "blur(8px)",
          minWidth: collapsed ? 0 : 220,
        }}
      >
        {/* Header row — always visible */}
        <button
          className="w-full flex items-center gap-2 px-2.5 py-1.5 cursor-pointer"
          onClick={() => setCollapsed((v) => !v)}
        >
          {/* State dot */}
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.pulse ? "animate-pulse" : ""}`}
            style={{ background: meta.color }}
          />
          <span
            className="text-xs font-mono font-bold tracking-wider flex-1 text-left"
            style={{ color: meta.color }}
          >
            {speech.state.toUpperCase()}
          </span>
          {speech.state === "speaking" && elapsed > 0 && (
            <span className="text-xs font-mono" style={{ color: "hsl(142 60% 50%)" }}>
              {fmt(elapsed)}
            </span>
          )}
          {speech.queueDepth > 0 && (
            <span
              className="text-xs font-mono px-1 rounded"
              style={{ background: "hsl(38 100% 55% / 0.15)", color: "hsl(38 100% 65%)" }}
            >
              +{speech.queueDepth}
            </span>
          )}
          <span className="text-xs" style={{ color: "hsl(210 20% 35%)" }}>
            {collapsed ? "▲" : "▼"}
          </span>
        </button>

        {/* Expanded detail */}
        {!collapsed && !isIdle && (
          <>
            <div style={{ height: 1, background: "hsl(210 15% 12%)" }} />
            <div className="px-2.5 py-2 flex flex-col gap-1.5">

              {/* Current msg */}
              {speech.currentMsgId && (
                <Row label="MSG" value={speech.currentMsgId.slice(0, 18) + "…"} color="hsl(194 100% 55%)" />
              )}

              {/* Speaking duration */}
              {speech.state === "speaking" && (
                <Row label="DURATION" value={elapsed > 0 ? fmt(elapsed) : "—"} color="hsl(142 71% 55%)" />
              )}

              {/* Queue depth */}
              <Row
                label="QUEUE"
                value={speech.queueDepth === 0 ? "empty" : `${speech.queueDepth} item${speech.queueDepth > 1 ? "s" : ""}`}
                color={speech.queueDepth > 0 ? "hsl(38 100% 65%)" : "hsl(210 20% 40%)"}
              />

              {/* Watchdog */}
              <Row
                label="WATCHDOG"
                value={speech.watchdogActive ? "ACTIVE" : "idle"}
                color={speech.watchdogActive ? "hsl(55 100% 60%)" : "hsl(210 20% 40%)"}
              />

              {/* Heartbeat */}
              <Row
                label="HEARTBEAT"
                value={speech.heartbeatTick > 0 ? timeSince(speech.heartbeatTick) : "never"}
                color={speech.heartbeatTick > 0 && Date.now() - speech.heartbeatTick < HEARTBEAT_DISPLAY_MS
                  ? "hsl(142 71% 55%)"
                  : "hsl(210 20% 40%)"}
              />

              {/* Utterance count */}
              <Row label="TOTAL" value={`${speech.utteranceCount} utterances`} color="hsl(210 20% 50%)" />

              {/* Audio unlock */}
              <Row
                label="AUDIO"
                value={speech.audioUnlocked ? "unlocked" : "locked"}
                color={speech.audioUnlocked ? "hsl(142 71% 55%)" : "hsl(38 100% 60%)"}
              />

              {/* Auto-speak */}
              <Row
                label="AUTO"
                value={speech.autoSpeak ? "ON" : "OFF"}
                color={speech.autoSpeak ? "hsl(264 80% 70%)" : "hsl(210 20% 40%)"}
              />

              {/* Last error */}
              {speech.lastError && (
                <Row label="ERROR" value={speech.lastError} color="hsl(355 80% 62%)" />
              )}
            </div>
          </>
        )}

        {/* Idle expanded: just counts */}
        {!collapsed && isIdle && speech.utteranceCount > 0 && (
          <>
            <div style={{ height: 1, background: "hsl(210 15% 12%)" }} />
            <div className="px-2.5 py-2 flex flex-col gap-1.5">
              <Row label="TOTAL" value={`${speech.utteranceCount} utterances`} color="hsl(210 20% 50%)" />
              <Row label="AUDIO" value={speech.audioUnlocked ? "unlocked" : "locked"} color="hsl(210 20% 45%)" />
              <Row label="AUTO" value={speech.autoSpeak ? "ON" : "OFF"} color={speech.autoSpeak ? "hsl(264 80% 70%)" : "hsl(210 20% 40%)"} />
              {speech.lastError && (
                <Row label="LAST ERR" value={speech.lastError} color="hsl(355 80% 62%)" />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const HEARTBEAT_DISPLAY_MS = 12_000;

function Row({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-mono tracking-wider flex-shrink-0" style={{ color: "hsl(196 30% 38%)" }}>
        {label}
      </span>
      <span className="text-xs font-mono text-right truncate" style={{ color }}>
        {value}
      </span>
    </div>
  );
}
