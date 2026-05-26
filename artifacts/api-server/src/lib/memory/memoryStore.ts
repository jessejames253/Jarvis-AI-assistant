/**
 * lib/memory/memoryStore.ts — Phase 5 generic persistent typed store.
 *
 * A simple append-friendly key/value store backed by a JSON file in /tmp.
 * Each Phase 5 subsystem (architectureGraph, projectHistory, etc.) uses its
 * own file path so stores remain fully independent.
 *
 * Design rules:
 *  - Max item cap enforced on every write (oldest evicted first).
 *  - Only items with { id: string } are stored.
 *  - All writes are synchronous to keep the API simple.
 *  - No item can be silently mutated — set() always replaces by id.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname }                                 from "path";

export class PersistentStore<T extends { id: string }> {
  private items: Map<string, T> = new Map();

  constructor(
    private readonly filePath: string,
    private readonly maxItems: number = 1000,
  ) {
    this.load();
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private load(): void {
    try {
      const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as Array<[string, T]>;
      this.items = new Map(raw);
    } catch { this.items = new Map(); }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(Array.from(this.items.entries())), "utf8");
    } catch { /* non-fatal */ }
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────

  set(item: T): T {
    this.items.set(item.id, item);
    // Evict oldest entries if cap exceeded
    if (this.items.size > this.maxItems) {
      const surplus = this.items.size - this.maxItems;
      const keys    = Array.from(this.items.keys()).slice(0, surplus);
      for (const k of keys) this.items.delete(k);
    }
    this.save();
    return item;
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  delete(id: string): boolean {
    const had = this.items.has(id);
    this.items.delete(id);
    if (had) this.save();
    return had;
  }

  all(): T[] {
    return Array.from(this.items.values());
  }

  filter(pred: (item: T) => boolean): T[] {
    return Array.from(this.items.values()).filter(pred);
  }

  count(): number {
    return this.items.size;
  }

  /** Remove all items and persist the empty state. */
  clear(): number {
    const n = this.items.size;
    this.items.clear();
    this.save();
    return n;
  }

  /**
   * Update a subset of fields on an existing item.
   * Returns null if the id is not found.
   */
  patch(id: string, update: Partial<Omit<T, "id">>): T | null {
    const existing = this.items.get(id);
    if (!existing) return null;
    const merged = { ...existing, ...update };
    this.items.set(id, merged);
    this.save();
    return merged;
  }
}
