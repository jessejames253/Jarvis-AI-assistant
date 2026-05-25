/**
 * lib/runtime/logger.ts — Circular event log (200-entry ring buffer).
 *
 * All events flowing through the bus are recorded here.
 * Subscribers receive the full snapshot on every push — used by
 * RuntimeInspector to show a live event timeline.
 */

import type { RuntimeEvent } from "./types";

const MAX_ENTRIES = 200;

export class RuntimeLogger {
  private _events: RuntimeEvent[] = [];
  private _subs = new Set<(events: readonly RuntimeEvent[]) => void>();

  push(event: RuntimeEvent): void {
    this._events.push(event);
    if (this._events.length > MAX_ENTRIES) {
      this._events = this._events.slice(-MAX_ENTRIES);
    }
    this._notify();
  }

  get events(): readonly RuntimeEvent[] {
    return this._events;
  }

  get length(): number {
    return this._events.length;
  }

  subscribe(fn: (events: readonly RuntimeEvent[]) => void): () => void {
    this._subs.add(fn);
    fn(this._events);
    return () => this._subs.delete(fn);
  }

  clear(): void {
    this._events = [];
    this._notify();
  }

  private _notify(): void {
    const snap = this._events as readonly RuntimeEvent[];
    for (const fn of this._subs) {
      try { fn(snap); } catch { /* ignore */ }
    }
  }
}
