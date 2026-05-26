/**
 * lib/dev/snapshotStore.ts — File-level snapshots before patch apply.
 *
 * Before every approved patch, a snapshot captures the file's previous
 * content. Snapshots survive restarts and can be restored on demand.
 * Stored at /tmp/jarvis_snapshots.json.
 */

import { readFileSync, writeFileSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { PROJECT_ROOT } from "./tools";

const SNAP_FILE = "/tmp/jarvis_snapshots.json";

export interface FileSnapshot {
  id: string;
  taskId?: string;
  patchId: string;
  file: string;
  previousContent: string;
  createdAt: number;
  restored: boolean;
}

let snapshots: FileSnapshot[] = [];

function load(): void {
  try {
    snapshots = JSON.parse(readFileSync(SNAP_FILE, "utf8")) as FileSnapshot[];
  } catch { snapshots = []; }
}

function save(): void {
  try {
    const trimmed = snapshots.slice(-200); // keep last 200 snapshots
    writeFileSync(SNAP_FILE, JSON.stringify(trimmed, null, 2), "utf8");
    snapshots = trimmed;
  } catch { /* non-fatal */ }
}

load();

export function getSnapshots(taskId?: string): FileSnapshot[] {
  return taskId ? snapshots.filter(s => s.taskId === taskId) : snapshots;
}

export function getSnapshot(id: string): FileSnapshot | undefined {
  return snapshots.find(s => s.id === id);
}

export async function createSnapshot(params: {
  patchId: string;
  file: string;
  taskId?: string;
}): Promise<FileSnapshot> {
  const abs = path.resolve(PROJECT_ROOT, params.file);
  let previousContent = "";
  try { previousContent = await fs.readFile(abs, "utf8"); } catch { /* new file */ }

  const snap: FileSnapshot = {
    id: crypto.randomUUID(),
    taskId: params.taskId,
    patchId: params.patchId,
    file: params.file,
    previousContent,
    createdAt: Date.now(),
    restored: false,
  };
  snapshots.push(snap);
  save();
  return snap;
}

export async function restoreSnapshot(id: string): Promise<{ ok: boolean; error?: string }> {
  const snap = snapshots.find(s => s.id === id);
  if (!snap) return { ok: false, error: "Snapshot not found" };

  const abs = path.resolve(PROJECT_ROOT, snap.file);
  try {
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, snap.previousContent, "utf8");
    snap.restored = true;
    save();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
