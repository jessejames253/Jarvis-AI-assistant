/**
 * hooks/useRuntime.ts — React adapters for the JarvisRuntime singleton.
 *
 * useRuntime()     — health snapshot + notifications + controls
 * useRuntimeLog()  — live event timeline (for RuntimeInspector)
 * useRuntimeEvent() — subscribe to a specific event type in a component
 */

import { useState, useEffect, useCallback } from "react";
import { JarvisRuntime } from "@/lib/runtime";
import type { RuntimeSnapshot, RuntimeEvent } from "@/lib/runtime/types";

// ── useRuntime ────────────────────────────────────────────────────────────────

export interface RuntimeControls extends RuntimeSnapshot {
  notify: (message: string, level?: "info" | "success" | "warn" | "error", ms?: number) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
  clearLog: () => void;
}

export function useRuntime(): RuntimeControls {
  const rt = JarvisRuntime.getInstance();
  const [snap, setSnap] = useState<RuntimeSnapshot>(() => rt.getSnapshot());

  useEffect(() => rt.subscribe(setSnap), [rt]);

  const notify = useCallback(
    (msg: string, level?: "info" | "success" | "warn" | "error", ms?: number) =>
      rt.notify(msg, level, ms),
    [rt],
  );
  const dismiss    = useCallback((id: string) => rt.dismiss(id), [rt]);
  const dismissAll = useCallback(() => rt.dismissAll(), [rt]);
  const clearLog   = useCallback(() => rt.log.clear(), [rt]);

  return { ...snap, notify, dismiss, dismissAll, clearLog };
}

// ── useRuntimeLog ─────────────────────────────────────────────────────────────

export function useRuntimeLog(limit = 40): readonly RuntimeEvent[] {
  const rt = JarvisRuntime.getInstance();
  const [events, setEvents] = useState<readonly RuntimeEvent[]>(() => rt.log.events);

  useEffect(() => rt.log.subscribe(setEvents), [rt]);

  return limit > 0 ? events.slice(-limit) : events;
}

// ── useRuntimeEvent ───────────────────────────────────────────────────────────

export function useRuntimeEvent<K extends RuntimeEvent["type"]>(
  type: K,
  handler: (event: Extract<RuntimeEvent, { type: K }>) => void,
): void {
  useEffect(() => {
    return JarvisRuntime.getInstance().bus.on(type, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);
}
