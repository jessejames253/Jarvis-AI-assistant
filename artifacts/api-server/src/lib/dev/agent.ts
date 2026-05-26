/**
 * lib/dev/agent.ts — Dev agent powered by Claude + file/build tools.
 *
 * Guards (all enforced before tool execution, not relying on the model):
 *  - Direct Patch Mode: message contains a file path → searching disabled, read once, patch
 *  - Max 3 search_project_files calls per task
 *  - Max 2 read_project_file calls per same file
 *  - Duplicate search queries blocked
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";
import { DEV_TOOL_DEFINITIONS, executeDevTool } from "./tools";
import { formatMemoryForPrompt } from "./projectMemory";

const BASE_SYSTEM = `You are Jarvis Dev Agent — an expert software engineer that inspects and proposes changes to the Jarvis project codebase. You are the main builder tool for this project.

## Project architecture
- artifacts/jarvas/              — React + Vite frontend (TypeScript, Tailwind, Wouter routing)
- artifacts/api-server/          — Express backend (TypeScript, esbuild, no tsc at runtime)
- lib/                           — Shared workspace packages (db, api-client, integrations)
- artifacts/jarvas/src/pages/Chat.tsx          — Main chat UI (large file, ~1450 lines)
- artifacts/jarvas/src/components/DevAgentPanel.tsx — Dev Agent UI
- artifacts/jarvas/src/components/DiffViewer.tsx    — Diff viewer with metadata
- artifacts/api-server/src/routes/dev.ts            — /api/dev/* routes
- artifacts/api-server/src/lib/dev/tools.ts         — File/build tools + patch store
- artifacts/api-server/src/lib/dev/taskStore.ts     — Task persistence
- artifacts/api-server/src/lib/dev/projectMemory.ts — Project memory (this context loaded from it)
- Styling: dark cyberpunk, hsl color tokens, no Tailwind config overrides needed
- Patch disk store: /tmp/jarvis_pending_patches.json
- Task disk store: /tmp/jarvis_tasks.json
- Snapshot disk store: /tmp/jarvis_snapshots.json
- Project memory disk store: /tmp/jarvis_project_memory.json

## DIRECT PATCH MODE (CRITICAL — always follow when a file path is given)
When the user's message contains a specific file path (e.g. "in artifacts/jarvas/src/pages/Chat.tsx"):
1. Read that file ONCE with read_project_file — do NOT search
2. Use propose_patch_hunk with the EXACT old text (copied from the read output) and the new text
3. Stop after proposing — do NOT continue searching or reading

## TOOL LIMITS (enforced by the system — violations return BLOCKED errors)
- search_project_files: max 3 total per task — after that you will be blocked
- read_project_file: max 2 calls per file — after that you will be blocked
- Duplicate search query: blocked automatically
- If the target file is known from the user's message: searching is fully disabled

## PREFER propose_patch_hunk OVER propose_file_patch
- propose_patch_hunk: replaces only the targeted text — USE THIS for all edits to existing files
- propose_file_patch: rewrites the entire file — ONLY use for new files or files under 50 lines
- For propose_patch_hunk: copy oldText EXACTLY from the file read output, including 2–3 lines of surrounding context for uniqueness

## Coding rules (always follow)
1. ALWAYS read the file before proposing changes — never guess at content.
2. Prefer propose_patch_hunk. Only use propose_file_patch for new/very short files.
3. Every patch MUST include: riskLevel, uiImpact, logicImpact, safeToTest.
4. After proposing a patch, explain in 1–2 sentences what changes, then STOP.
5. Never auto-apply. Never claim a patch was applied before the user approves.
6. After a patch is applied, validation runs automatically — do not re-run unless asked.
7. Keep responses concise — no vague wording, no filler. Lead with what you found.
8. Do not touch .env, secrets, or auth config.
9. If you cannot find a file after 1–2 searches, stop and show a Manual Patch Required card.
10. Group related changes into one patch per file. Propose one file at a time.

## Risk levels
- low:    cosmetic/text change, no logic change
- medium: logic or state change, isolated to one component
- high:   route changes, shared lib changes, or affects multiple components`;

// ─── Tool loop guard ──────────────────────────────────────────────────────────

class ToolLoopGuard {
  private searchCount  = 0;
  private readCounts   = new Map<string, number>();
  private searchSeen   = new Set<string>();
  readonly targetFile: string | null;

  constructor(targetFile: string | null) {
    this.targetFile = targetFile;
  }

  checkSearch(query: string): string | null {
    if (this.targetFile) {
      return `BLOCKED: Target file already known (${this.targetFile}). Use read_project_file directly — do not search.`;
    }
    if (this.searchSeen.has(query)) {
      return `BLOCKED: Already searched for "${query}". Use the results from the earlier search — do not repeat.`;
    }
    if (this.searchCount >= 3) {
      return "BLOCKED: Search limit reached (3 max per task). Work with what you have, or use propose_patch_hunk with a manual fallback.";
    }
    return null;
  }

  recordSearch(query: string): void {
    this.searchCount++;
    this.searchSeen.add(query);
  }

  checkList(): string | null {
    if (this.targetFile) {
      return `BLOCKED: Target file already known (${this.targetFile}). Use read_project_file directly.`;
    }
    return null;
  }

  checkRead(file: string): string | null {
    const n = this.readCounts.get(file) ?? 0;
    if (n >= 2) {
      return `BLOCKED: Already read "${file}" ${n} time(s). Use the content you already have — do not re-read.`;
    }
    return null;
  }

  recordRead(file: string): void {
    this.readCounts.set(file, (this.readCounts.get(file) ?? 0) + 1);
  }
}

// ─── File path detection ──────────────────────────────────────────────────────

function detectTargetFile(message: string): string | null {
  const m = message.match(/\b(artifacts\/[\w/.\-]+\.\w+|lib\/[\w/.\-]+\.\w+)\b/);
  return m ? m[1] : null;
}

// ─── Stage mapping ────────────────────────────────────────────────────────────

const TOOL_STAGE: Record<string, string> = {
  list_project_files:   "searching",
  search_project_files: "searching",
  read_project_file:    "reading",
  propose_file_patch:   "proposing",
  propose_patch_hunk:   "proposing",
  run_typecheck:        "validating",
  run_build:            "validating",
};

// ─── Types ────────────────────────────────────────────────────────────────────

type TextBlock    = { type: "text"; text: string };
type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: unknown };
type ContentBlock = TextBlock | ToolUseBlock;
type MessageParam =
  | { role: "user";      content: string | Array<{ type: "tool_result"; tool_use_id: string; content: string }> }
  | { role: "assistant"; content: ContentBlock[] };

const MAX_ITERS = 8;

export async function runDevAgent(
  message: string,
  send: (data: object) => void,
  isCancelled: () => boolean,
): Promise<void> {
  send({ type: "dev:started", message });

  const targetFile = detectTargetFile(message);
  const guard      = new ToolLoopGuard(targetFile);

  if (targetFile) {
    send({ type: "dev:status", stage: "direct_patch", detail: targetFile });
  }

  // Load project memory and inject into system prompt
  let systemPrompt = BASE_SYSTEM;
  try {
    const memoryBlock = formatMemoryForPrompt();
    if (memoryBlock) systemPrompt = `${BASE_SYSTEM}\n\n${memoryBlock}`;
  } catch { /* non-fatal if memory store unavailable */ }

  if (targetFile) {
    systemPrompt += `\n\n## ACTIVE TASK — DIRECT PATCH MODE\nTarget file: ${targetFile}\nInstruction: Read this file ONCE, then immediately use propose_patch_hunk. Do NOT search. Stop after proposing.`;
  }

  const messages: MessageParam[] = [
    { role: "user", content: message },
  ];

  let fullResponse = "";

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    if (isCancelled()) { send({ type: "dev:cancelled" }); return; }

    send({ type: "dev:status", stage: "thinking" });

    const blocks    = new Map<number, ContentBlock & { input_json?: string }>();
    let stopReason  = "end_turn";

    const stream = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages as Parameters<typeof anthropic.messages.create>[0]["messages"],
      tools: DEV_TOOL_DEFINITIONS as Parameters<typeof anthropic.messages.create>[0]["tools"],
      stream: true,
    });

    for await (const event of stream) {
      if (isCancelled()) break;

      if (event.type === "content_block_start") {
        const cb = event.content_block;
        if (cb.type === "text") {
          blocks.set(event.index, { type: "text", text: "" });
        } else if (cb.type === "tool_use") {
          blocks.set(event.index, { type: "tool_use", id: cb.id, name: cb.name, input: {}, input_json: "" });
          send({ type: "dev:tool_start", toolCallId: cb.id, tool: cb.name });
          send({ type: "dev:status", stage: TOOL_STAGE[cb.name] ?? "working", tool: cb.name });
        }
      } else if (event.type === "content_block_delta") {
        const block = blocks.get(event.index);
        if (!block) continue;
        if (event.delta.type === "text_delta" && block.type === "text") {
          block.text  += event.delta.text;
          fullResponse += event.delta.text;
          send({ type: "dev:token", text: event.delta.text });
        } else if (event.delta.type === "input_json_delta" && block.type === "tool_use") {
          (block as { input_json: string }).input_json =
            ((block as { input_json: string }).input_json ?? "") + event.delta.partial_json;
        }
      } else if (event.type === "content_block_stop") {
        const block = blocks.get(event.index);
        if (block?.type === "tool_use") {
          try {
            block.input = JSON.parse((block as { input_json: string }).input_json ?? "{}");
          } catch { block.input = {}; }
        }
      } else if (event.type === "message_delta") {
        stopReason = event.delta.stop_reason ?? "end_turn";
      }
    }

    const assistantContent: ContentBlock[] = Array.from(blocks.values()).map(b =>
      b.type === "text"
        ? { type: "text", text: b.text }
        : { type: "tool_use", id: (b as ToolUseBlock).id, name: (b as ToolUseBlock).name, input: (b as ToolUseBlock).input },
    );
    messages.push({ role: "assistant", content: assistantContent });

    if (stopReason !== "tool_use") break;

    const toolUseBlocks = assistantContent.filter((b): b is ToolUseBlock => b.type === "tool_use");
    const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];

    for (const tb of toolUseBlocks) {
      if (isCancelled()) break;

      // ── Guard checks ────────────────────────────────────────────────────────
      let blocked: string | null = null;

      if (tb.name === "search_project_files") {
        const inp = tb.input as { pattern?: string };
        blocked = guard.checkSearch(inp.pattern ?? "");
        if (!blocked) guard.recordSearch(inp.pattern ?? "");
      } else if (tb.name === "list_project_files") {
        blocked = guard.checkList();
      } else if (tb.name === "read_project_file") {
        const inp = tb.input as { file?: string };
        blocked = guard.checkRead(inp.file ?? "");
        if (!blocked) guard.recordRead(inp.file ?? "");
      }

      if (blocked) {
        send({ type: "dev:status", stage: "blocked", detail: blocked });
        toolResults.push({ type: "tool_result", tool_use_id: tb.id, content: blocked });
        continue;
      }

      // ── Execute ─────────────────────────────────────────────────────────────
      let result: unknown;
      let errorMsg: string | undefined;
      try {
        result = await executeDevTool(tb.name, tb.input as Record<string, unknown>, send);
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : String(err);
        result   = { error: errorMsg };
        send({ type: "dev:tool_error", toolCallId: tb.id, tool: tb.name, error: errorMsg });
      }

      if (!errorMsg) {
        send({ type: "dev:tool_done", toolCallId: tb.id, tool: tb.name });
      }

      const contentStr = errorMsg
        ? `Error: ${errorMsg}`
        : typeof result === "string" ? result : JSON.stringify(result, null, 2);
      toolResults.push({ type: "tool_result", tool_use_id: tb.id, content: contentStr });
    }

    messages.push({ role: "user", content: toolResults });
  }

  send({ type: "dev:status", stage: "done" });
  send({ type: "dev:done", response: fullResponse });
}
