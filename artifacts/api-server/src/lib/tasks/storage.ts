/**
 * lib/tasks/storage.ts — Persistent file-based storage for tasks, projects, and goals
 *
 * Mirrors the pattern from lib/memory.ts:
 *   - One JSON file per session under .jarvas-data/tasks/
 *   - Keep function signatures stable so swapping to a DB is a one-file change
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import type { TaskStore } from "./types";

const DATA_DIR = "/home/runner/workspace/.jarvas-data/tasks";

async function ensureDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

function storePath(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9\-]/g, "").slice(0, 64);
  return path.join(DATA_DIR, `${safe}.json`);
}

export async function readStore(sessionId: string): Promise<TaskStore | null> {
  await ensureDir();
  try {
    const raw = await readFile(storePath(sessionId), "utf-8");
    return JSON.parse(raw) as TaskStore;
  } catch {
    return null;
  }
}

export async function writeStore(store: TaskStore): Promise<void> {
  await ensureDir();
  store.updatedAt = new Date().toISOString();
  await writeFile(storePath(store.sessionId), JSON.stringify(store, null, 2), "utf-8");
}

export async function getOrCreateStore(sessionId: string): Promise<TaskStore> {
  const existing = await readStore(sessionId);
  if (existing) return existing;

  const fresh: TaskStore = {
    sessionId,
    tasks: [],
    projects: [],
    goals: [],
    updatedAt: new Date().toISOString(),
  };
  await writeStore(fresh);
  return fresh;
}
