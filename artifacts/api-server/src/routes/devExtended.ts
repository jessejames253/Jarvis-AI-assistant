/**
 * routes/devExtended.ts — Extended Dev Platform routes.
 *
 * Tasks:     GET/POST /dev/tasks, GET/PATCH/DELETE /dev/tasks/:id
 *            POST /dev/tasks/:id/cancel
 * Snapshots: GET /dev/snapshots, POST /dev/snapshots/:id/restore
 * Memory:    GET/POST /dev/project-memory, DELETE /dev/project-memory/:id
 * Git:       GET /dev/git/status, POST /dev/git/commit
 * Index:     GET /dev/index (lightweight file list w/ mtime)
 */

import { Router } from "express";
import fs from "fs/promises";
import path from "path";
import {
  getAllTasks, getTask, createTask, updateTask, deleteTask,
} from "../lib/dev/taskStore";
import { getSnapshots, getSnapshot, restoreSnapshot } from "../lib/dev/snapshotStore";
import {
  getAllMemory, addMemory, updateMemory, deleteMemory,
  type MemoryCategory,
} from "../lib/dev/projectMemory";
import { getGitStatus, commitPatch } from "../lib/dev/gitHelper";
import { PROJECT_ROOT } from "../lib/dev/tools";

const router = Router();

// ─── Tasks ────────────────────────────────────────────────────────────────────

router.get("/dev/tasks", (_req, res) => {
  res.json({ ok: true, tasks: getAllTasks() });
});

router.get("/dev/tasks/:id", (req, res) => {
  const task = getTask(req.params.id);
  if (!task) { res.status(404).json({ ok: false, error: "Task not found" }); return; }
  res.json({ ok: true, task });
});

router.post("/dev/tasks", (req, res) => {
  const { prompt, title } = req.body as { prompt?: string; title?: string };
  if (!prompt?.trim()) { res.status(400).json({ ok: false, error: "prompt is required" }); return; }
  const task = createTask(prompt.trim(), title?.trim());
  res.json({ ok: true, task });
});

router.patch("/dev/tasks/:id", (req, res) => {
  const task = updateTask(req.params.id, req.body as Parameters<typeof updateTask>[1]);
  if (!task) { res.status(404).json({ ok: false, error: "Task not found" }); return; }
  res.json({ ok: true, task });
});

router.delete("/dev/tasks/:id", (req, res) => {
  const deleted = deleteTask(req.params.id);
  if (!deleted) { res.status(404).json({ ok: false, error: "Task not found" }); return; }
  res.json({ ok: true });
});

router.post("/dev/tasks/:id/cancel", (req, res) => {
  const task = updateTask(req.params.id, { status: "cancelled" });
  if (!task) { res.status(404).json({ ok: false, error: "Task not found" }); return; }
  res.json({ ok: true, task });
});

// ─── Snapshots ────────────────────────────────────────────────────────────────

router.get("/dev/snapshots", (req, res) => {
  const taskId = req.query.taskId as string | undefined;
  res.json({ ok: true, snapshots: getSnapshots(taskId).map(s => ({ ...s, previousContent: undefined })) });
});

router.get("/dev/snapshots/:id", (req, res) => {
  const snap = getSnapshot(req.params.id);
  if (!snap) { res.status(404).json({ ok: false, error: "Snapshot not found" }); return; }
  res.json({ ok: true, snapshot: snap });
});

router.post("/dev/snapshots/:id/restore", async (req, res) => {
  const result = await restoreSnapshot(req.params.id);
  if (!result.ok) { res.status(400).json(result); return; }
  res.json({ ok: true });
});

// ─── Project memory ───────────────────────────────────────────────────────────

router.get("/dev/project-memory", (_req, res) => {
  res.json({ ok: true, entries: getAllMemory() });
});

router.post("/dev/project-memory", (req, res) => {
  const { category, title, content } = req.body as { category?: MemoryCategory; title?: string; content?: string };
  if (!content?.trim()) { res.status(400).json({ ok: false, error: "content is required" }); return; }
  const entry = addMemory({
    category: category ?? "general",
    title: title?.trim() ?? content.slice(0, 40),
    content: content.trim(),
  });
  res.json({ ok: true, entry });
});

router.patch("/dev/project-memory/:id", (req, res) => {
  const entry = updateMemory(req.params.id, req.body as Parameters<typeof updateMemory>[1]);
  if (!entry) { res.status(404).json({ ok: false, error: "Entry not found" }); return; }
  res.json({ ok: true, entry });
});

router.delete("/dev/project-memory/:id", (req, res) => {
  const deleted = deleteMemory(req.params.id);
  if (!deleted) { res.status(404).json({ ok: false, error: "Entry not found" }); return; }
  res.json({ ok: true });
});

// ─── Git ──────────────────────────────────────────────────────────────────────

router.get("/dev/git/status", async (_req, res) => {
  const status = await getGitStatus();
  res.json({ ok: true, ...status });
});

router.post("/dev/git/commit", async (req, res) => {
  const { message, files } = req.body as { message?: string; files?: string[] };
  if (!message?.trim()) { res.status(400).json({ ok: false, error: "message is required" }); return; }
  const result = await commitPatch(message.trim(), files);
  if (!result.ok) { res.status(400).json({ ok: false, error: result.error }); return; }
  res.json({ ok: true, hash: result.hash });
});

// ─── File index (lightweight) ─────────────────────────────────────────────────

interface IndexEntry {
  path: string;
  size: number;
  modifiedAt: number;
  lines: number;
}

const SOURCE_DIRS = [
  "artifacts/jarvas/src",
  "artifacts/api-server/src",
];
const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".css", ".md"]);

router.get("/dev/index", async (_req, res) => {
  const entries: IndexEntry[] = [];

  async function walk(dir: string): Promise<void> {
    let items: import("fs").Dirent[];
    try { items = await fs.readdir(path.resolve(PROJECT_ROOT, dir), { withFileTypes: true }); }
    catch { return; }

    for (const item of items) {
      const rel = `${dir}/${item.name}`;
      if (item.isDirectory()) {
        if (!["node_modules", ".git", "dist", ".turbo"].includes(item.name)) await walk(rel);
      } else if (SOURCE_EXTS.has(path.extname(item.name))) {
        try {
          const abs = path.resolve(PROJECT_ROOT, rel);
          const stat = await fs.stat(abs);
          const content = await fs.readFile(abs, "utf8");
          entries.push({ path: rel, size: stat.size, modifiedAt: stat.mtimeMs, lines: content.split("\n").length });
        } catch { /* skip */ }
      }
    }
  }

  for (const dir of SOURCE_DIRS) await walk(dir);
  entries.sort((a, b) => b.modifiedAt - a.modifiedAt);
  res.json({ ok: true, count: entries.length, entries });
});

router.post("/dev/index/rebuild", async (_req, res) => {
  // Trigger re-index — for now, same as GET (stateless index)
  res.json({ ok: true, message: "Index is rebuilt on every GET /dev/index" });
});

export default router;
