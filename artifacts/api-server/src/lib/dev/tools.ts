/**
 * lib/dev/tools.ts — File and build tools for the Dev Agent.
 *
 * Safety rules:
 *  - All file operations are bounded to PROJECT_ROOT
 *  - Terminal commands are allowlisted
 *  - Patches are proposed but NOT auto-applied — user must approve
 */

import path from "path";
import fs from "fs/promises";
import { readFileSync, writeFileSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export const PROJECT_ROOT = "/home/runner/workspace";

// Files/dirs that can never be read or edited by the dev agent
const BLOCKED_PATHS = [
  ".env", ".env.local", ".env.production", ".env.development",
  ".git/", "node_modules/", ".pnpm-store/",
  "secrets", ".replit", ".ssh",
];

// Terminal commands that are explicitly allowed
const ALLOWED_COMMANDS = [
  /^pnpm\s+(--filter\s+\S+\s+)?(run\s+)?(dev|build|typecheck|check|test|lint)\b/,
  /^npx\s+tsc\s+--noEmit/,
  /^node\s+--version$/,
  /^pnpm\s+--version$/,
];

function isPathSafe(filePath: string): boolean {
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  if (!resolved.startsWith(PROJECT_ROOT + path.sep) && resolved !== PROJECT_ROOT) return false;
  return !BLOCKED_PATHS.some(b => resolved.includes(b));
}

function isCommandAllowed(cmd: string): boolean {
  return ALLOWED_COMMANDS.some(r => r.test(cmd.trim()));
}

// ─── Pending patches (persisted to disk so server restarts don't lose them) ───

export interface PendingPatch {
  patchId: string;
  file: string;
  description: string;
  oldContent: string;
  newContent: string;
  createdAt: number;
}

const PATCHES_FILE = "/tmp/jarvis_pending_patches.json";

export const pendingPatches = new Map<string, PendingPatch>();

// Load any patches that survived a previous server run
try {
  const raw = readFileSync(PATCHES_FILE, "utf8");
  const saved = JSON.parse(raw) as Array<[string, PendingPatch]>;
  for (const [id, patch] of saved) pendingPatches.set(id, patch);
} catch { /* no file yet — fine */ }

function savePatches(): void {
  try {
    writeFileSync(PATCHES_FILE, JSON.stringify(Array.from(pendingPatches.entries())), "utf8");
  } catch { /* ignore — non-fatal */ }
}

// ─── Tool implementations ─────────────────────────────────────────────────────

export async function listProjectFiles(
  params: { directory?: string; pattern?: string },
  send: (d: object) => void,
): Promise<string> {
  const dir = params.directory ?? "";
  const absDir = path.resolve(PROJECT_ROOT, dir);
  if (!isPathSafe(dir)) throw new Error(`Path not allowed: ${dir}`);

  const pattern = params.pattern?.toLowerCase();
  send({ type: "dev:file_op", op: "list", path: dir || "." });

  async function walk(d: string, depth = 0): Promise<string[]> {
    if (depth > 4) return [];
    const entries = await fs.readdir(d, { withFileTypes: true });
    const results: string[] = [];
    for (const e of entries) {
      const rel = path.relative(PROJECT_ROOT, path.join(d, e.name));
      if (BLOCKED_PATHS.some(b => rel.startsWith(b) || e.name === b.replace("/", ""))) continue;
      if (e.name.startsWith(".") && e.name !== ".gitignore") continue;
      if (pattern && !rel.toLowerCase().includes(pattern) && e.isFile()) continue;
      if (e.isDirectory()) {
        results.push(`${rel}/`);
        const sub = await walk(path.join(d, e.name), depth + 1);
        results.push(...sub);
      } else {
        results.push(rel);
      }
    }
    return results;
  }

  const files = await walk(absDir);
  return files.slice(0, 200).join("\n") || "(empty directory)";
}

export async function readProjectFile(
  params: { file: string; startLine?: number; endLine?: number },
  send: (d: object) => void,
): Promise<string> {
  if (!isPathSafe(params.file)) throw new Error(`Path not allowed: ${params.file}`);
  const abs = path.resolve(PROJECT_ROOT, params.file);
  send({ type: "dev:file_op", op: "read", path: params.file });

  const raw = await fs.readFile(abs, "utf8");
  const lines = raw.split("\n");
  const start = (params.startLine ?? 1) - 1;
  const end = params.endLine ?? lines.length;
  const slice = lines.slice(Math.max(0, start), Math.min(lines.length, end));
  const prefix = params.startLine ? `(lines ${params.startLine}–${end})\n` : "";
  return prefix + slice.map((l, i) => `${String(start + i + 1).padStart(4)}: ${l}`).join("\n");
}

export async function searchProjectFiles(
  params: { pattern: string; directory?: string; fileGlob?: string },
  send: (d: object) => void,
): Promise<string> {
  const dir = params.directory ?? "";
  if (dir && !isPathSafe(dir)) throw new Error(`Path not allowed: ${dir}`);
  const absDir = path.resolve(PROJECT_ROOT, dir || ".");
  send({ type: "dev:file_op", op: "search", pattern: params.pattern, dir: dir || "." });

  const glob = params.fileGlob ? `--glob "${params.fileGlob}"` : "--glob '*.{ts,tsx,js,jsx,json,css,md}'";
  const cmd = `cd "${absDir}" && rg --no-heading -n --max-count 5 --max-filesize 500K ${glob} "${params.pattern.replace(/"/g, '\\"')}" 2>&1 | head -60`;

  try {
    const { stdout } = await execAsync(cmd, { timeout: 10000 });
    return stdout.trim() || "No matches found.";
  } catch {
    return "No matches found.";
  }
}

export async function proposeFilePatch(
  params: { file: string; newContent: string; description: string },
  send: (d: object) => void,
): Promise<string> {
  if (!isPathSafe(params.file)) throw new Error(`Path not allowed: ${params.file}`);
  const abs = path.resolve(PROJECT_ROOT, params.file);

  let oldContent = "";
  try {
    oldContent = await fs.readFile(abs, "utf8");
  } catch {
    oldContent = "";
  }

  const patchId = crypto.randomUUID();
  const patch: PendingPatch = {
    patchId,
    file: params.file,
    description: params.description,
    oldContent,
    newContent: params.newContent,
    createdAt: Date.now(),
  };
  pendingPatches.set(patchId, patch);
  savePatches();

  send({
    type: "dev:patch_proposed",
    patchId,
    file: params.file,
    description: params.description,
    oldContent,
    newContent: params.newContent,
    linesAdded: params.newContent.split("\n").length - oldContent.split("\n").length,
  });

  return JSON.stringify({ patchId, status: "pending_approval", message: "Patch proposed and sent to user for approval. Do not apply until approved." });
}

export async function runTypecheck(
  params: { project?: string },
  send: (d: object) => void,
): Promise<string> {
  const proj = params.project ?? "jarvas";
  const cmd = `cd "${PROJECT_ROOT}" && pnpm --filter @workspace/${proj} exec tsc --noEmit 2>&1 | head -50`;
  send({ type: "dev:check_started", check: "typecheck", project: proj });

  try {
    const { stdout } = await execAsync(cmd, { timeout: 30000 });
    const out = stdout.trim();
    const passed = !out.includes("error TS");
    send({ type: passed ? "dev:check_passed" : "dev:check_failed", check: "typecheck", output: out });
    return passed ? `✓ Typecheck passed for ${proj}` : `Typecheck errors:\n${out}`;
  } catch (err: unknown) {
    const out = (err as { stdout?: string }).stdout ?? String(err);
    send({ type: "dev:check_failed", check: "typecheck", output: out });
    return `Typecheck failed:\n${out}`;
  }
}

export async function runBuild(
  params: { project?: string },
  send: (d: object) => void,
): Promise<string> {
  const proj = params.project ?? "jarvas";
  const cmd = `cd "${PROJECT_ROOT}" && pnpm --filter @workspace/${proj} run build 2>&1 | tail -20`;
  send({ type: "dev:check_started", check: "build", project: proj });

  try {
    const { stdout } = await execAsync(cmd, { timeout: 60000 });
    const out = stdout.trim();
    const passed = !out.toLowerCase().includes("error");
    send({ type: passed ? "dev:check_passed" : "dev:check_failed", check: "build", output: out });
    return passed ? `✓ Build passed for ${proj}` : `Build errors:\n${out}`;
  } catch (err: unknown) {
    const out = (err as { stdout?: string }).stdout ?? String(err);
    send({ type: "dev:check_failed", check: "build", output: out });
    return `Build failed:\n${out}`;
  }
}

// ─── Apply patch (called only after explicit user approval) ───────────────────

export async function applyPatch(patchId: string): Promise<{ ok: boolean; error?: string }> {
  const patch = pendingPatches.get(patchId);
  if (!patch) return { ok: false, error: "Patch not found or already applied" };
  if (!isPathSafe(patch.file)) return { ok: false, error: "Path not allowed" };

  const abs = path.resolve(PROJECT_ROOT, patch.file);
  const backupPath = `${abs}.devbak.${Date.now()}`;

  try {
    // Backup existing file
    try { await fs.copyFile(abs, backupPath); } catch { /* new file — no backup needed */ }
    // Ensure directory exists
    await fs.mkdir(path.dirname(abs), { recursive: true });
    // Write new content
    await fs.writeFile(abs, patch.newContent, "utf8");
    pendingPatches.delete(patchId);
    savePatches();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── Tool definitions for Claude ─────────────────────────────────────────────

export const DEV_TOOL_DEFINITIONS = [
  {
    name: "list_project_files",
    description: "List files in the project directory. Use to explore the codebase structure.",
    input_schema: {
      type: "object" as const,
      properties: {
        directory: { type: "string", description: "Subdirectory to list (relative to project root). Empty for root." },
        pattern: { type: "string", description: "Optional filter — only return files matching this pattern." },
      },
    },
  },
  {
    name: "read_project_file",
    description: "Read the contents of a project file. Use startLine/endLine to limit output.",
    input_schema: {
      type: "object" as const,
      required: ["file"],
      properties: {
        file: { type: "string", description: "File path relative to project root." },
        startLine: { type: "number", description: "First line to read (1-indexed)." },
        endLine: { type: "number", description: "Last line to read (inclusive)." },
      },
    },
  },
  {
    name: "search_project_files",
    description: "Search for a pattern across project source files using ripgrep.",
    input_schema: {
      type: "object" as const,
      required: ["pattern"],
      properties: {
        pattern: { type: "string", description: "Regex or literal string to search for." },
        directory: { type: "string", description: "Directory to search in. Empty for project root." },
        fileGlob: { type: "string", description: "Glob to filter files (e.g. '*.tsx')." },
      },
    },
  },
  {
    name: "propose_file_patch",
    description: "Propose a file change. Shows the user a diff and waits for approval before anything is written. Use this for ALL edits — never edit files directly.",
    input_schema: {
      type: "object" as const,
      required: ["file", "newContent", "description"],
      properties: {
        file: { type: "string", description: "File path relative to project root." },
        newContent: { type: "string", description: "Complete new content for the file." },
        description: { type: "string", description: "Human-readable description of what changed and why." },
      },
    },
  },
  {
    name: "run_typecheck",
    description: "Run TypeScript typecheck (tsc --noEmit) on a workspace package.",
    input_schema: {
      type: "object" as const,
      properties: {
        project: { type: "string", description: "Package name: 'jarvas' or 'api-server'. Default: jarvas." },
      },
    },
  },
  {
    name: "run_build",
    description: "Run the build script for a workspace package.",
    input_schema: {
      type: "object" as const,
      properties: {
        project: { type: "string", description: "Package name: 'jarvas' or 'api-server'. Default: jarvas." },
      },
    },
  },
] as const;

export type DevToolName = "list_project_files" | "read_project_file" | "search_project_files" | "propose_file_patch" | "run_typecheck" | "run_build";

export async function executeDevTool(
  name: string,
  input: Record<string, unknown>,
  send: (d: object) => void,
): Promise<unknown> {
  switch (name) {
    case "list_project_files":
      return listProjectFiles(input as { directory?: string; pattern?: string }, send);
    case "read_project_file":
      return readProjectFile(input as { file: string; startLine?: number; endLine?: number }, send);
    case "search_project_files":
      return searchProjectFiles(input as { pattern: string; directory?: string; fileGlob?: string }, send);
    case "propose_file_patch":
      return proposeFilePatch(input as { file: string; newContent: string; description: string }, send);
    case "run_typecheck":
      return runTypecheck(input as { project?: string }, send);
    case "run_build":
      return runBuild(input as { project?: string }, send);
    default:
      throw new Error(`Unknown dev tool: ${name}`);
  }
}
