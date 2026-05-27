/**
 * lib/autonomy/queue.ts — Autonomy Queue v1
 *
 * Queue items are staging candidates created from open ImprovementSuggestions.
 * They must be explicitly approved by the user before converting to work orders.
 *
 * Status flow:
 *   queued → approved → converted
 *   queued → rejected
 *   approved → failed  (if work-order creation fails)
 *
 * Stored at .jarvas-data/autonomy/queue.json.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import path           from "path";
import { PROJECT_ROOT } from "../dev/tools";

// ─── Types ────────────────────────────────────────────────────────────────────

export type QueueStatus =
  | "queued"
  | "approved"
  | "rejected"
  | "converted"
  | "failed";

export interface QueueItem {
  id:               string;
  suggestionId:     string;
  title:            string;
  recommendedAgent: string;
  riskLevel:        "high" | "medium" | "low";
  status:           QueueStatus;
  createdAt:        string;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const AUTONOMY_DIR = path.join(PROJECT_ROOT, ".jarvas-data", "autonomy");
const QUEUE_FILE   = path.join(AUTONOMY_DIR, "queue.json");

function ensureDir(): void {
  if (!existsSync(AUTONOMY_DIR)) mkdirSync(AUTONOMY_DIR, { recursive: true });
}

export function loadQueue(): QueueItem[] {
  try { return JSON.parse(readFileSync(QUEUE_FILE, "utf-8")) as QueueItem[]; }
  catch { return []; }
}

export function saveQueue(items: QueueItem[]): void {
  ensureDir();
  writeFileSync(QUEUE_FILE, JSON.stringify(items, null, 2) + "\n", "utf-8");
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Add new queue items — skips duplicates by suggestionId.
 * Returns the newly added items only.
 */
export function addQueueItems(
  candidates: Omit<QueueItem, "id" | "status" | "createdAt">[],
): QueueItem[] {
  const existing   = loadQueue();
  const existingIds = new Set(existing.map(q => q.suggestionId));
  const fresh: QueueItem[] = candidates
    .filter(c => !existingIds.has(c.suggestionId))
    .map(c => ({
      ...c,
      id:        randomUUID(),
      status:    "queued" as QueueStatus,
      createdAt: new Date().toISOString(),
    }));
  if (fresh.length > 0) saveQueue([...existing, ...fresh]);
  return fresh;
}

/**
 * Update a single queue item by id. Returns the updated item or null.
 */
export function updateQueueItem(
  id:    string,
  patch: Partial<QueueItem>,
): QueueItem | null {
  const items = loadQueue();
  const idx   = items.findIndex(q => q.id === id);
  if (idx === -1) return null;
  items[idx] = { ...items[idx], ...patch };
  saveQueue(items);
  return items[idx];
}

/**
 * Get a single queue item by id.
 */
export function getQueueItem(id: string): QueueItem | null {
  return loadQueue().find(q => q.id === id) ?? null;
}
