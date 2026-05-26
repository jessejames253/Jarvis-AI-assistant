/**
 * lib/dev/projectMemory.ts — Backend-persisted project architecture memory.
 *
 * Stores architecture notes, coding rules, UI conventions, known bugs,
 * and file map entries. Loaded into the Dev Agent system prompt before
 * every task. Stored at /tmp/jarvis_project_memory.json.
 */

import { readFileSync, writeFileSync } from "fs";

const MEMORY_FILE = "/tmp/jarvis_project_memory.json";

export type MemoryCategory =
  | "architecture" | "coding-rules" | "ui-conventions"
  | "known-bugs" | "file-map" | "deployment" | "general";

export interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

const DEFAULTS: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">[] = [
  {
    category: "architecture",
    title: "Monorepo structure",
    content: "pnpm workspace. artifacts/jarvas = React+Vite frontend. artifacts/api-server = Express+esbuild backend. lib/ = shared packages (db, api-client, integrations-anthropic-ai). No tsc at runtime — esbuild only.",
  },
  {
    category: "coding-rules",
    title: "Frontend styling",
    content: "Dark cyberpunk theme. Use hsl() color tokens only — no arbitrary Tailwind colors. Background: hsl(220 20% 7%). Accent: hsl(194 100% 55%). Borders: hsl(210 15% 18%). Text-muted: hsl(196 30% 45%).",
  },
  {
    category: "coding-rules",
    title: "Patch discipline",
    content: "Always read before writing. One propose_file_patch per file. Include riskLevel, uiImpact, logicImpact, safeToTest. Never auto-apply. Wait for user approval.",
  },
  {
    category: "file-map",
    title: "Key frontend files",
    content: "Chat.tsx — main chat (~1450 lines). DevAgentPanel.tsx — dev agent overlay. DiffViewer.tsx — diff with metadata. MarkdownContent.tsx — markdown renderer. MemoryPanel.tsx — memory view.",
  },
  {
    category: "file-map",
    title: "Key backend files",
    content: "routes/dev.ts — /api/dev/* routes. lib/dev/agent.ts — Claude agent loop. lib/dev/tools.ts — file/build tools. lib/dev/taskStore.ts — task persistence. lib/dev/projectMemory.ts — this file.",
  },
];

let entries: MemoryEntry[] = [];
let seeded = false;

function load(): void {
  try {
    entries = JSON.parse(readFileSync(MEMORY_FILE, "utf8")) as MemoryEntry[];
    seeded = true;
  } catch {
    entries = [];
    seeded = false;
  }
}

function save(): void {
  try {
    writeFileSync(MEMORY_FILE, JSON.stringify(entries, null, 2), "utf8");
  } catch { /* non-fatal */ }
}

load();

// Seed defaults on first run
if (!seeded || entries.length === 0) {
  const now = Date.now();
  entries = DEFAULTS.map(d => ({ ...d, id: crypto.randomUUID(), createdAt: now, updatedAt: now }));
  save();
  seeded = true;
}

export function getAllMemory(): MemoryEntry[] {
  return entries.sort((a, b) => a.category.localeCompare(b.category) || a.createdAt - b.createdAt);
}

export function getMemoryByCategory(cat: MemoryCategory): MemoryEntry[] {
  return entries.filter(e => e.category === cat);
}

export function addMemory(params: { category: MemoryCategory; title: string; content: string }): MemoryEntry {
  const now = Date.now();
  const entry: MemoryEntry = { ...params, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
  entries.push(entry);
  save();
  return entry;
}

export function updateMemory(id: string, patch: Partial<Pick<MemoryEntry, "title" | "content" | "category">>): MemoryEntry | null {
  const idx = entries.findIndex(e => e.id === id);
  if (idx < 0) return null;
  entries[idx] = { ...entries[idx], ...patch, updatedAt: Date.now() };
  save();
  return entries[idx];
}

export function deleteMemory(id: string): boolean {
  const len = entries.length;
  entries = entries.filter(e => e.id !== id);
  if (entries.length < len) { save(); return true; }
  return false;
}

/** Format all memory as a compact string for the agent system prompt */
export function formatMemoryForPrompt(): string {
  if (entries.length === 0) return "";
  const byCategory = new Map<string, MemoryEntry[]>();
  for (const e of entries) {
    if (!byCategory.has(e.category)) byCategory.set(e.category, []);
    byCategory.get(e.category)!.push(e);
  }
  const sections: string[] = [];
  for (const [cat, items] of byCategory) {
    const header = `## Project memory: ${cat}`;
    const body = items.map(e => `- **${e.title}:** ${e.content}`).join("\n");
    sections.push(`${header}\n${body}`);
  }
  return sections.join("\n\n");
}
