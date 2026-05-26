/**
 * lib/dev/gitHelper.ts — Safe Git integration for the Dev Agent.
 *
 * Only exposes: status, commit, revert.
 * Never runs git push or any destructive operations.
 * All operations are bounded to PROJECT_ROOT.
 */

import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import { PROJECT_ROOT } from "./tools";

const execAsync = promisify(exec);

function run(cmd: string, opts?: { timeout?: number }): Promise<string> {
  return execAsync(cmd, {
    cwd: PROJECT_ROOT,
    timeout: opts?.timeout ?? 15000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  }).then(({ stdout, stderr }) => (stdout + stderr).trim());
}

export async function hasGit(): Promise<boolean> {
  try {
    await fs.access(path.join(PROJECT_ROOT, ".git"));
    return true;
  } catch {
    return false;
  }
}

export interface GitStatus {
  available: boolean;
  branch?: string;
  clean?: boolean;
  changes?: Array<{ status: string; file: string }>;
  error?: string;
}

export async function getGitStatus(): Promise<GitStatus> {
  if (!await hasGit()) return { available: false };

  try {
    const branchOut = await run("git --no-optional-locks rev-parse --abbrev-ref HEAD");
    const statusOut = await run("git --no-optional-locks status --porcelain");

    const changes = statusOut
      .split("\n")
      .filter(Boolean)
      .map(line => ({ status: line.slice(0, 2).trim(), file: line.slice(3).trim() }));

    return { available: true, branch: branchOut, clean: changes.length === 0, changes };
  } catch (err) {
    return { available: true, error: String(err) };
  }
}

export interface CommitResult {
  ok: boolean;
  hash?: string;
  error?: string;
}

export async function commitPatch(message: string, files?: string[]): Promise<CommitResult> {
  if (!await hasGit()) return { ok: false, error: "Git not available" };

  try {
    if (files && files.length > 0) {
      // Stage only the specified files
      for (const f of files) {
        const safe = f.replace(/"/g, '\\"');
        await run(`git add "${safe}"`);
      }
    } else {
      await run("git add -A");
    }

    const safeMsg = message.replace(/"/g, '\\"').slice(0, 200);
    await run(`git commit -m "[jarvis-dev] ${safeMsg}"`, { timeout: 20000 });

    const hash = await run("git --no-optional-locks rev-parse --short HEAD");
    return { ok: true, hash };
  } catch (err) {
    // If nothing to commit, that's fine
    if (String(err).includes("nothing to commit")) return { ok: true, hash: undefined };
    return { ok: false, error: String(err).slice(0, 300) };
  }
}

export async function revertFile(filePath: string): Promise<{ ok: boolean; error?: string }> {
  if (!await hasGit()) return { ok: false, error: "Git not available" };
  try {
    const safe = filePath.replace(/"/g, '\\"');
    await run(`git checkout HEAD -- "${safe}"`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 200) };
  }
}
