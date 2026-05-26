/**
 * lib/checkpoints.ts — Checkpoint metadata manager
 *
 * Stores and retrieves checkpoint records in:
 *   {PROJECT_ROOT}/.jarvas-data/checkpoints/checkpoints.json
 *
 * Safety rules:
 *   - Checkpoint records are NEVER deleted — status transitions only.
 *   - Writes are atomic: build full list in memory, then serialise.
 *   - `createCheckpoint` captures live git metadata where available,
 *     falling back gracefully when git is absent or the repo is clean.
 *   - No files are modified, checked out, or deleted by this module.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import path from "path";
import { randomUUID } from "crypto";
import { PROJECT_ROOT } from "./dev/tools";

// ─── File path ────────────────────────────────────────────────────────────────

const CP_DIR  = path.join(PROJECT_ROOT, ".jarvas-data", "checkpoints");
const CP_FILE = path.join(CP_DIR, "checkpoints.json");

// ─── Types ────────────────────────────────────────────────────────────────────

export type CheckpointStatus = "active" | "restored" | "archived";

export interface Checkpoint {
  id:           string;
  timestamp:    string;
  description:  string;
  commitHash?:  string;
  branch?:      string;
  changedFiles: string[];
  status:       CheckpointStatus;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function ensureDir(): void {
  if (!existsSync(CP_DIR)) {
    mkdirSync(CP_DIR, { recursive: true });
  }
}

function readRaw(): Checkpoint[] {
  ensureDir();
  if (!existsSync(CP_FILE)) return [];
  try {
    const raw = readFileSync(CP_FILE, "utf-8").trim();
    if (!raw) return [];
    return JSON.parse(raw) as Checkpoint[];
  } catch {
    return [];
  }
}

function writeRaw(cps: Checkpoint[]): void {
  ensureDir();
  writeFileSync(CP_FILE, JSON.stringify(cps, null, 2) + "\n", "utf-8");
}

function git(cmd: string): string {
  return execSync(cmd, {
    cwd:     PROJECT_ROOT,
    timeout: 6000,
    stdio:   "pipe",
  })
    .toString()
    .trim();
}

function tryGit(cmd: string): string | undefined {
  try { return git(cmd); }
  catch { return undefined; }
}

// ─── Git metadata capture ─────────────────────────────────────────────────────

interface GitSnapshot {
  commitHash?:  string;
  branch?:      string;
  changedFiles: string[];
}

function captureGitSnapshot(): GitSnapshot {
  const commitHash  = tryGit('git log -1 --format=%H HEAD');
  const branch      = tryGit('git rev-parse --abbrev-ref HEAD');

  // Files modified but not staged, staged, and untracked
  const statusOut   = tryGit('git status --porcelain') ?? "";
  const changedFiles = statusOut
    .split("\n")
    .map(l => l.slice(3).trim())            // strip XY status prefix
    .filter(f => f.length > 0 && !f.startsWith('"')); // skip quoted paths (edge case)

  return { commitHash: commitHash || undefined, branch: branch || undefined, changedFiles };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * List all checkpoints, newest first.
 */
export function listCheckpoints(): Checkpoint[] {
  return [...readRaw()].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

/**
 * Return a single checkpoint by id.
 */
export function getCheckpoint(id: string): Checkpoint | undefined {
  return readRaw().find(c => c.id === id);
}

/**
 * Create a new checkpoint, capturing live git state.
 * Throws if a checkpoint with the same id already exists.
 */
export function createCheckpoint(data: {
  id?:          string;
  description:  string;
}): Checkpoint {
  const all = readRaw();
  const id  = data.id ?? randomUUID();

  if (all.some(c => c.id === id)) {
    throw new Error(`Checkpoint "${id}" already exists.`);
  }

  const snap = captureGitSnapshot();
  const cp: Checkpoint = {
    id,
    timestamp:    new Date().toISOString(),
    description:  data.description.trim() || "Manual checkpoint",
    commitHash:   snap.commitHash,
    branch:       snap.branch,
    changedFiles: snap.changedFiles,
    status:       "active",
  };

  writeRaw([...all, cp]);
  return cp;
}

/**
 * Transition a checkpoint's status (active → restored | archived).
 * Throws if not found.
 */
export function updateCheckpointStatus(id: string, status: CheckpointStatus): Checkpoint {
  const all = readRaw();
  const idx = all.findIndex(c => c.id === id);
  if (idx === -1) throw new Error(`Checkpoint "${id}" not found.`);

  const updated = { ...all[idx], status, updatedAt: new Date().toISOString() };
  writeRaw(all.map((c, i) => (i === idx ? updated : c)));
  return updated;
}
