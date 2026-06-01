/**
 * lib/dev/tools.ts — File and build tools for the Dev Agent.
 *
 * Safety rules:
 *  - All file operations bounded to PROJECT_ROOT
 *  - Terminal commands are allowlisted
 *  - Patches proposed but NOT auto-applied — user must approve
 *  - Backup created before every apply; rollback restores from backup
 *  - Pending patches persisted to disk so server restarts don't lose them
 */

import path from "path";
import fs from "fs/promises";
import { readFileSync, writeFileSync, mkdirSync, accessSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { PROJECT_ROOT, resolveDataDir } from "../rootResolver";

export { PROJECT_ROOT };

const execAsync = promisify(exec);

// ─── ripgrep resolver ─────────────────────────────────────────────────────────
// The rg binary lives in the Nix store and may not be on PATH for the server
// process. We resolve it once at startup (cached) and fall back to a pure-Node
// recursive search when rg cannot be found.

let _rgPath: string | null | undefined = undefined; // undefined = not yet resolved

async function findRg(): Promise<string | null> {
  if (_rgPath !== undefined) return _rgPath;

  // 1. Try PATH / well-known locations
  const candidates = [
    "rg",
    "/usr/bin/rg",
    "/usr/local/bin/rg",
  ];
  for (const c of candidates) {
    try {
      await execAsync(`"${c}" --version 2>/dev/null`, { timeout: 2000 });
      _rgPath = c;
      return _rgPath;
    } catch { /* try next */ }
  }

  // 2. Ask the shell (picks up Nix-managed PATH entries)
  try {
    const { stdout } = await execAsync(
      "which rg 2>/dev/null || command -v rg 2>/dev/null",
      { timeout: 3000, shell: "/bin/sh" },
    );
    const p = stdout.trim();
    if (p) { _rgPath = p; return _rgPath; }
  } catch { /* ignore */ }

  // 3. Glob in /nix/store
  try {
    const { stdout } = await execAsync(
      "ls /nix/store/*/bin/rg 2>/dev/null | head -1",
      { timeout: 4000, shell: "/bin/sh" },
    );
    const p = stdout.trim();
    if (p) { _rgPath = p; return _rgPath; }
  } catch { /* ignore */ }

  _rgPath = null;
  console.warn("[ripgrep] Not found — search will use Node.js fallback.");
  return null;
}

// Run at startup so the first search call doesn't pay the discovery cost.
void findRg();

// ─── Node.js fallback search (used when rg is unavailable) ───────────────────

const SEARCH_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".css", ".md"]);

async function nodeSearch(
  pattern: string,
  absDir: string,
  fileGlob?: string,
): Promise<string> {
  const results: string[] = [];
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "gm");
  } catch {
    regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gm");
  }

  // Derive extension filter from glob if provided (e.g. "*.tsx" → ".tsx")
  const extFilter = fileGlob
    ? ("." + fileGlob.replace(/['"*]/g, "").split(".").pop())
    : null;

  async function walk(d: string, depth = 0): Promise<void> {
    if (depth > 6 || results.length >= 60) return;
    let entries: import("fs").Dirent[];
    try { entries = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (results.length >= 60) break;
      if (e.name.startsWith(".")) continue;
      if (["node_modules", ".pnpm-store", "dist", ".git"].includes(e.name)) continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) {
        await walk(abs, depth + 1);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (!SEARCH_EXTS.has(ext)) continue;
        if (extFilter && ext !== extFilter) continue;
        try {
          const content = await fs.readFile(abs, "utf8");
          const lines = content.split("\n");
          let hitCount = 0;
          for (let i = 0; i < lines.length && hitCount < 5; i++) {
            regex.lastIndex = 0;
            if (regex.test(lines[i])) {
              results.push(`${path.relative(absDir, abs)}:${i + 1}: ${lines[i].trim().slice(0, 120)}`);
              hitCount++;
            }
          }
        } catch { /* unreadable — skip */ }
      }
    }
  }

  await walk(absDir);
  return results.join("\n") || "No matches found.";
}

// ─── Diagnostic export ────────────────────────────────────────────────────────

export async function getProjectRootDiagnostics(): Promise<{
  projectRoot: string;
  cwd: string;
  dirname: string;
  markers: Record<string, boolean>;
  rgPath: string | null;
  jarvisDir: string;
}> {
  const rgPath = await findRg();
  const markers: Record<string, boolean> = {};
  for (const m of ["artifacts", "package.json", "artifacts/api-server", "artifacts/jarvas", "lib", ".git"]) {
    try { accessSync(path.join(PROJECT_ROOT, m)); markers[m] = true; } catch { markers[m] = false; }
  }
  return { projectRoot: PROJECT_ROOT, cwd: process.cwd(), dirname: __dirname, markers, rgPath, jarvisDir: JARVIS_DIR };
}

const BLOCKED_PATHS = [
  ".env", ".env.local", ".env.production", ".env.development",
  ".git/", "node_modules/", ".pnpm-store/",
  "secrets", ".replit", ".ssh",
];

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

// ─── Pending patches (persisted to disk so restarts don't lose them) ──────────

export interface PendingPatch {
  patchId: string;
  file: string;
  description: string;
  oldContent: string;
  newContent: string;
  createdAt: number;
  // Review metadata
  riskLevel?: "low" | "medium" | "high";
  uiImpact?: string;
  logicImpact?: string;
  safeToTest?: boolean;
  /** Allowlisted shell command to verify the patch (shown in UI, run on apply). */
  testCommand?: string;
  /** True when this patch was loaded from disk on server startup (i.e. survived a restart). */
  recoveredFromRestart?: boolean;
}

// Store patches in the project directory so they survive container sleeps.
// /tmp is cleared when Replit hibernates; PROJECT_ROOT/.jarvis is not.
const JARVIS_DIR = `${PROJECT_ROOT}/.jarvis`;
const PATCHES_FILE = `${JARVIS_DIR}/pending_patches.json`;

export const pendingPatches = new Map<string, PendingPatch>();

/** Timestamp when this server process started. Used by the restart-status endpoint. */
export const SERVER_STARTED_AT = Date.now();
/** How many patches were loaded from disk on this startup (0 = fresh start). */
export let RECOVERED_PATCH_COUNT = 0;

// Ensure the .jarvis directory exists, then load any patches saved before last restart.
try { mkdirSync(JARVIS_DIR, { recursive: true }); } catch { /* non-fatal */ }

try {
  const raw = readFileSync(PATCHES_FILE, "utf8");
  const saved = JSON.parse(raw) as Array<[string, PendingPatch]>;
  for (const [id, patch] of saved) {
    pendingPatches.set(id, { ...patch, recoveredFromRestart: true });
  }
  RECOVERED_PATCH_COUNT = pendingPatches.size;
  if (RECOVERED_PATCH_COUNT > 0) {
    console.log(`[pendingPatches] Recovered ${RECOVERED_PATCH_COUNT} patch(es) from disk after restart.`);
  }
} catch { /* no file yet — fresh start */ }

function savePatches(): void {
  try {
    mkdirSync(JARVIS_DIR, { recursive: true });
    writeFileSync(PATCHES_FILE, JSON.stringify(Array.from(pendingPatches.entries())), "utf8");
  } catch { /* non-fatal */ }
}

/**
 * Remove a patch from the pending queue by ID.
 * Called by the DELETE /api/dev/patches/:id endpoint (explicit rejection).
 * Returns true if the patch existed, false if it was already gone.
 */
export function deletePatch(patchId: string): boolean {
  const existed = pendingPatches.has(patchId);
  if (existed) {
    pendingPatches.delete(patchId);
    savePatches();
    console.log("[pendingPatches] Deleted (rejected):", patchId, "— remaining:", pendingPatches.size);
  }
  return existed;
}

/**
 * Register a patch from any source (REST endpoint, Jarvis chat tool, etc.).
 * The patch is stored in the shared `pendingPatches` map and persisted to disk,
 * so DEV → Patches tab picks it up on its next poll of GET /api/dev/patches.
 */
export function registerPatch(params: {
  file: string;
  description: string;
  oldContent?: string;
  newContent: string;
  riskLevel?: "low" | "medium" | "high";
}): PendingPatch {
  const patchId = crypto.randomUUID();
  const patch: PendingPatch = {
    patchId,
    file: params.file,
    description: params.description,
    oldContent: params.oldContent ?? "",
    newContent: params.newContent,
    createdAt: Date.now(),
    riskLevel: params.riskLevel ?? "medium",
    uiImpact: "unknown",
    logicImpact: "unknown",
    safeToTest: false,
  };
  pendingPatches.set(patchId, patch);
  savePatches();
  console.log("[pendingPatches] Registered:", patchId, "for", params.file, "— total:", pendingPatches.size);
  return patch;
}

// ─── Tool implementations ─────────────────────────────────────────────────────

export async function listProjectFiles(
  params: { directory?: string; pattern?: string },
  send: (d: object) => void,
): Promise<string> {
  const dir = params.directory ?? "";
  const absDir = path.resolve(PROJECT_ROOT, dir);
  if (dir && !isPathSafe(dir)) throw new Error(`Path not allowed: ${dir}`);
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
      if (e.name.endsWith(".devbak") || e.name.includes(".devbak.")) continue;
      if (pattern && !rel.toLowerCase().includes(pattern) && e.isFile()) continue;
      if (e.isDirectory()) {
        results.push(`${rel}/`);
        results.push(...await walk(path.join(d, e.name), depth + 1));
      } else {
        results.push(rel);
      }
    }
    return results;
  }

  const files = await walk(absDir);
  return files.slice(0, 200).join("\n") || "(empty directory)";
}

/** REST-friendly version for the file browser UI — no SSE send needed */
export async function listProjectFilesRest(dir = "", maxDepth = 2): Promise<string[]> {
  const absDir = path.resolve(PROJECT_ROOT, dir);
  if (dir && !isPathSafe(dir)) throw new Error(`Path not allowed: ${dir}`);

  async function walk(d: string, depth = 0): Promise<string[]> {
    if (depth > maxDepth) return [];
    let entries: import("fs").Dirent[];
    try { entries = await fs.readdir(d, { withFileTypes: true }); } catch { return []; }
    const results: string[] = [];
    for (const e of entries) {
      const rel = path.relative(PROJECT_ROOT, path.join(d, e.name));
      if (BLOCKED_PATHS.some(b => rel.startsWith(b) || e.name === b.replace("/", ""))) continue;
      if (e.name.startsWith(".")) continue;
      if (e.name.endsWith(".devbak") || e.name.includes(".devbak.")) continue;
      if (e.isDirectory()) {
        results.push(rel + "/");
        results.push(...await walk(path.join(d, e.name), depth + 1));
      } else {
        results.push(rel);
      }
    }
    return results;
  }

  return walk(absDir);
}

/** REST-friendly file read for the file browser UI */
export async function readProjectFileRest(
  filePath: string,
  maxLines = 300,
): Promise<{ ok: boolean; content?: string; lines?: number; error?: string }> {
  if (!isPathSafe(filePath)) return { ok: false, error: "Path not allowed" };
  const abs = path.resolve(PROJECT_ROOT, filePath);
  try {
    const raw = await fs.readFile(abs, "utf8");
    const lines = raw.split("\n");
    const slice = lines.slice(0, maxLines);
    const content = slice.map((l, i) => `${String(i + 1).padStart(4)}: ${l}`).join("\n");
    return { ok: true, content, lines: lines.length };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
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

  const rgBin = await findRg();

  if (rgBin) {
    const glob = params.fileGlob
      ? `--glob "${params.fileGlob}"`
      : "--glob '*.{ts,tsx,js,jsx,json,css,md}'";
    const escapedPattern = params.pattern.replace(/"/g, '\\"');
    const cmd = `"${rgBin}" --no-heading -n --max-count 5 --max-filesize 500K ${glob} "${escapedPattern}" "${absDir}" 2>&1 | head -60`;

    try {
      const { stdout } = await execAsync(cmd, { timeout: 10000 });
      const out = stdout.trim();
      // rg exits 1 for "no matches" — stdout will be empty; that's fine
      if (out && !out.includes("command not found") && !out.includes("No such file")) {
        return out || "No matches found.";
      }
    } catch (err: unknown) {
      // exit code 1 = no matches (stdout already captured above); other errors fall through
      const stdout = (err as { stdout?: string }).stdout?.trim() ?? "";
      if (stdout) return stdout;
    }
  }

  // Node.js fallback — no rg dependency
  return nodeSearch(params.pattern, absDir, params.fileGlob);
}

export async function proposePatchHunk(
  params: {
    file: string;
    oldText: string;
    newText: string;
    description: string;
    riskLevel?: "low" | "medium" | "high";
    uiImpact?: string;
    logicImpact?: string;
    safeToTest?: boolean;
    testCommand?: string;
  },
  send: (d: object) => void,
): Promise<string> {
  if (!isPathSafe(params.file)) throw new Error(`Path not allowed: ${params.file}`);
  const abs = path.resolve(PROJECT_ROOT, params.file);

  let oldContent: string;
  try { oldContent = await fs.readFile(abs, "utf8"); } catch {
    throw new Error(`File not found: ${params.file}`);
  }

  if (!oldContent.includes(params.oldText)) {
    // Anchor not found — emit a manual-patch event so the frontend shows a card
    send({
      type: "dev:manual_patch",
      file: params.file,
      description: `Anchor text not found in ${params.file}. Apply this replacement manually.`,
      oldText: params.oldText,
      newContent: params.newText,
    });
    return JSON.stringify({
      error: "anchor_not_found",
      message: `The exact text to replace was not found in ${params.file}. A Manual Patch Required card has been shown to the user.`,
    });
  }

  const newContent = oldContent.replace(params.oldText, params.newText);
  return proposeFilePatch(
    {
      file: params.file,
      newContent,
      description: params.description,
      riskLevel: params.riskLevel,
      uiImpact: params.uiImpact,
      logicImpact: params.logicImpact,
      safeToTest: params.safeToTest,
      testCommand: params.testCommand,
    },
    send,
  );
}

export async function proposeFilePatch(
  params: {
    file: string;
    newContent: string;
    description: string;
    riskLevel?: "low" | "medium" | "high";
    uiImpact?: string;
    logicImpact?: string;
    safeToTest?: boolean;
    testCommand?: string;
  },
  send: (d: object) => void,
): Promise<string> {
  if (!isPathSafe(params.file)) throw new Error(`Path not allowed: ${params.file}`);
  const abs = path.resolve(PROJECT_ROOT, params.file);

  let oldContent = "";
  try { oldContent = await fs.readFile(abs, "utf8"); } catch { /* new file */ }

  const patchId = crypto.randomUUID();
  const patch: PendingPatch = {
    patchId,
    file: params.file,
    description: params.description,
    oldContent,
    newContent: params.newContent,
    createdAt: Date.now(),
    riskLevel: params.riskLevel ?? "medium",
    uiImpact: params.uiImpact ?? "unknown",
    logicImpact: params.logicImpact ?? "unknown",
    safeToTest: params.safeToTest ?? false,
    testCommand: params.testCommand,
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
    riskLevel: patch.riskLevel,
    uiImpact: patch.uiImpact,
    logicImpact: patch.logicImpact,
    safeToTest: patch.safeToTest,
    testCommand: patch.testCommand,
  });

  return JSON.stringify({ patchId, status: "pending_approval", message: "Patch proposed. Do not apply until the user approves." });
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

// ─── Apply patch ──────────────────────────────────────────────────────────────

export async function applyPatch(patchId: string): Promise<{ ok: boolean; error?: string; backupPath?: string }> {
  const patch = pendingPatches.get(patchId);
  if (!patch) return { ok: false, error: "Patch not found — server may have restarted. Use Manual Patch to apply manually." };
  if (!isPathSafe(patch.file)) return { ok: false, error: "Path not allowed" };

  const abs = path.resolve(PROJECT_ROOT, patch.file);
  const backupPath = `${abs}.devbak.${Date.now()}`;

  try {
    try { await fs.copyFile(abs, backupPath); } catch { /* new file */ }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, patch.newContent, "utf8");
    pendingPatches.delete(patchId);
    savePatches();
    return { ok: true, backupPath: path.relative(PROJECT_ROOT, backupPath) };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── Rollback ─────────────────────────────────────────────────────────────────

export async function rollbackFile(filePath: string): Promise<{ ok: boolean; error?: string; restoredFrom?: string }> {
  if (!isPathSafe(filePath)) return { ok: false, error: "Path not allowed" };
  const abs = path.resolve(PROJECT_ROOT, filePath);
  const dir = path.dirname(abs);
  const base = path.basename(abs);

  let entries: string[] = [];
  try { entries = await fs.readdir(dir); } catch { return { ok: false, error: "Could not read directory" }; }

  const backups = entries
    .filter(e => e.startsWith(base + ".devbak."))
    .sort(); // lexicographic = chronological (timestamp suffix)

  if (backups.length === 0) return { ok: false, error: `No backup found for ${filePath}` };

  const latest = path.join(dir, backups[backups.length - 1]);
  try {
    await fs.copyFile(latest, abs);
    return { ok: true, restoredFrom: backups[backups.length - 1] };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── Tool definitions for Claude ─────────────────────────────────────────────

export const DEV_TOOL_DEFINITIONS = [
  {
    name: "list_project_files",
    description: "List files in the project directory. Use to explore codebase structure before making changes.",
    input_schema: {
      type: "object" as const,
      properties: {
        directory: { type: "string", description: "Subdirectory (relative to project root). Empty for root." },
        pattern: { type: "string", description: "Filter — only return files containing this pattern." },
      },
    },
  },
  {
    name: "read_project_file",
    description: "Read a project file's contents. Always read the file before proposing changes to it.",
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
    name: "propose_patch_hunk",
    description: "Propose a targeted change to a file by specifying the EXACT old text to replace and the new text. Preferred over propose_file_patch for all edits to existing files — much safer and more precise. If oldText is not found exactly, a Manual Patch Required card is shown.",
    input_schema: {
      type: "object" as const,
      required: ["file", "oldText", "newText", "description", "riskLevel", "uiImpact", "logicImpact", "safeToTest"],
      properties: {
        file:         { type: "string", description: "File path relative to project root." },
        oldText:      { type: "string", description: "The EXACT text to replace — copy it verbatim from the read_project_file output, including surrounding lines for uniqueness." },
        newText:      { type: "string", description: "The replacement text." },
        description:  { type: "string", description: "What changed and why (1–2 sentences)." },
        riskLevel:    { type: "string", enum: ["low", "medium", "high"], description: "Risk of this change causing breakage." },
        uiImpact:     { type: "string", description: "What the user will see differently in the UI, or 'none'." },
        logicImpact:  { type: "string", description: "How backend/state/data flow changes, or 'none'." },
        safeToTest:   { type: "boolean", description: "True if the change can be safely previewed in dev without side effects." },
        testCommand:  { type: "string", description: "Optional allowlisted shell command to verify this patch (e.g. 'pnpm --filter @workspace/jarvas exec tsc --noEmit'). Shown in the UI and run automatically after apply." },
      },
    },
  },
  {
    name: "propose_file_patch",
    description: "Propose a full file replacement. Use propose_patch_hunk instead for edits to existing files. Only use this for new files or files under 50 lines.",
    input_schema: {
      type: "object" as const,
      required: ["file", "newContent", "description", "riskLevel", "uiImpact", "logicImpact", "safeToTest"],
      properties: {
        file:        { type: "string", description: "File path relative to project root." },
        newContent:  { type: "string", description: "Complete new content for the file." },
        description: { type: "string", description: "What changed and why (1–2 sentences)." },
        riskLevel:   { type: "string", enum: ["low", "medium", "high"], description: "Risk of this change causing breakage." },
        uiImpact:    { type: "string", description: "What the user will see differently in the UI, or 'none'." },
        logicImpact: { type: "string", description: "How backend/state/data flow changes, or 'none'." },
        safeToTest:  { type: "boolean", description: "True if the change can be safely previewed in dev without side effects." },
        testCommand: { type: "string", description: "Optional allowlisted shell command to verify this patch (e.g. 'pnpm --filter @workspace/jarvas exec tsc --noEmit'). Shown in the UI and run automatically after apply." },
      },
    },
  },
  {
    name: "run_typecheck",
    description: "Run TypeScript typecheck on a workspace package.",
    input_schema: {
      type: "object" as const,
      properties: {
        project: { type: "string", description: "Package: 'jarvas' or 'api-server'. Default: jarvas." },
      },
    },
  },
  {
    name: "run_build",
    description: "Run the build script for a workspace package.",
    input_schema: {
      type: "object" as const,
      properties: {
        project: { type: "string", description: "Package: 'jarvas' or 'api-server'. Default: jarvas." },
      },
    },
  },
] as const;

export type DevToolName =
  | "list_project_files" | "read_project_file" | "search_project_files"
  | "propose_patch_hunk" | "propose_file_patch" | "run_typecheck" | "run_build";

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
    case "propose_patch_hunk":
      return proposePatchHunk(input as {
        file: string; oldText: string; newText: string; description: string;
        riskLevel?: "low" | "medium" | "high"; uiImpact?: string; logicImpact?: string; safeToTest?: boolean;
        testCommand?: string;
      }, send);
    case "propose_file_patch":
      return proposeFilePatch(input as {
        file: string; newContent: string; description: string;
        riskLevel?: "low" | "medium" | "high"; uiImpact?: string; logicImpact?: string; safeToTest?: boolean;
        testCommand?: string;
      }, send);
    case "run_typecheck":
      return runTypecheck(input as { project?: string }, send);
    case "run_build":
      return runBuild(input as { project?: string }, send);
    default:
      throw new Error(`Unknown dev tool: ${name}`);
  }
}
