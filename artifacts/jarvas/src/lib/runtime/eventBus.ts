/**
 * lib/runtime/eventBus.ts — Typed pub/sub event bus.
 *
 * All handlers are wrapped in try/catch — a crashing handler
 * never interrupts other handlers or the emitter.
 */

import type { RuntimeEvent } from "./types";

type Handler<T> = (event: T) => void;
type AnyHandler = Handler<RuntimeEvent>;

export class EventBus {
  private _byType = new Map<string, Set<AnyHandler>>();
  private _wildcards = new Set<AnyHandler>();

  /** Emit an event to all registered handlers (type-specific + wildcard). */
  emit(event: RuntimeEvent): void {
    const typed = this._byType.get(event.type);
    if (typed) {
      for (const h of typed) {
        try { h(event); } catch (e) { console.error("[EventBus] handler error:", e); }
      }
    }
    for (const h of this._wildcards) {
      try { h(event); } catch (e) { console.error("[EventBus] wildcard error:", e); }
    }
  }

  /**
   * Subscribe to a specific event type.
   * Returns an unsubscribe function.
   */
  on<K extends RuntimeEvent["type"]>(
    type: K,
    handler: Handler<Extract<RuntimeEvent, { type: K }>>,
  ): () => void {
    if (!this._byType.has(type)) this._byType.set(type, new Set());
    const h = handler as AnyHandler;
    this._byType.get(type)!.add(h);
    return () => this._byType.get(type)?.delete(h);
  }

  /** Subscribe to every event (wildcard). Returns unsubscribe. */
  onAny(handler: AnyHandler): () => void {
    this._wildcards.add(handler);
    return () => this._wildcards.delete(handler);
  }

  /** Synchronously unsubscribe. */
  off<K extends RuntimeEvent["type"]>(
    type: K,
    handler: Handler<Extract<RuntimeEvent, { type: K }>>,
  ): void {
    this._byType.get(type)?.delete(handler as AnyHandler);
  }
}
