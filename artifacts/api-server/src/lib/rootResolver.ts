/**
 * lib/rootResolver.ts — Single source of truth for the project root path.
 *
 * Never hardcodes a host-specific path. Resolution order:
 *   1. process.env.PROJECT_ROOT  (explicit override — always wins if valid)
 *   2. Walk up from process.cwd() until a directory contains both
 *      "artifacts/" and "package.json"
 *   3. Walk up from __dirname (handles the case where cwd is a sub-package)
 *   4. Generic container mount points (/workspace, /app, /srv) as last resort
 *
 * If no valid root is found the function falls back to process.cwd() and
 * emits a structured warning so the issue is immediately visible in logs.
 */

import path from "path";
import { accessSync } from "fs";

const ROOT_MARKERS = ["artifacts", "package.json"];

function isValidRoot(dir: string): boolean {
  return ROOT_MARKERS.every(m => {
    try { accessSync(path.join(dir, m)); return true; } catch { return false; }
  });
}

function walkUpToRoot(start: string, maxSteps = 12): string | null {
  let dir = start;
  for (let i = 0; i < maxSteps; i++) {
    if (isValidRoot(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolveProjectRoot(): string {
  const envRoot = process.env["PROJECT_ROOT"]?.trim();
  if (envRoot) {
    if (isValidRoot(envRoot)) return envRoot;
    console.warn(`[rootResolver] PROJECT_ROOT="${envRoot}" is set but missing artifacts/ or package.json.`);
  }

  const fromCwd = walkUpToRoot(process.cwd());
  if (fromCwd) return fromCwd;

  const fromDirname = walkUpToRoot(__dirname);
  if (fromDirname) return fromDirname;

  for (const known of ["/workspace", "/app", "/srv"]) {
    if (isValidRoot(known)) return known;
  }

  console.warn(
    `[rootResolver] Cannot resolve project root.\n` +
    `  cwd=${process.cwd()}  __dirname=${__dirname}\n` +
    `  Set the PROJECT_ROOT environment variable to fix this.`
  );
  return process.cwd();
}

/** Absolute path to the repo / workspace root. */
export const PROJECT_ROOT = resolveProjectRoot();

/** Resolve a data subdirectory relative to the project root. */
export function resolveDataDir(subdir: string): string {
  return path.join(PROJECT_ROOT, subdir);
}

console.log(`[rootResolver] PROJECT_ROOT=${PROJECT_ROOT}  (cwd=${process.cwd()})`);
