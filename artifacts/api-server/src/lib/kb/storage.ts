/**
 * lib/kb/storage.ts — Persistent file-based storage for the Knowledge Base
 *
 * One JSON file per session under .jarvas-data/kb/.
 * Mirrors the pattern from lib/tasks/storage.ts — swap implementations
 * here without touching anything else.
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import type { KBStore } from "./types";

const DATA_DIR = "/home/runner/workspace/.jarvas-data/kb";

async function ensureDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

function storePath(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9\-]/g, "").slice(0, 64);
  return path.join(DATA_DIR, `${safe}.json`);
}

export async function readKBStore(sessionId: string): Promise<KBStore | null> {
  await ensureDir();
  try {
    const raw = await readFile(storePath(sessionId), "utf-8");
    return JSON.parse(raw) as KBStore;
  } catch {
    return null;
  }
}

export async function writeKBStore(store: KBStore): Promise<void> {
  await ensureDir();
  store.updatedAt = new Date().toISOString();
  await writeFile(storePath(store.sessionId), JSON.stringify(store, null, 2), "utf-8");
}

export async function getOrCreateKBStore(sessionId: string): Promise<KBStore> {
  const existing = await readKBStore(sessionId);
  if (existing) return existing;

  const fresh: KBStore = {
    sessionId,
    notes: [],
    updatedAt: new Date().toISOString(),
  };
  await writeKBStore(fresh);
  return fresh;
}
