/**
 * lib/dev/agent.ts — Dev agent powered by Claude + file/build tools.
 *
 * Loads project memory before every task so the agent has full context.
 * Patches are never auto-applied — user must approve.
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

## Coding rules (always follow)
1. ALWAYS search/read the file before proposing changes — never guess at content.
2. Use propose_file_patch for ALL edits. Never claim to edit files directly.
3. Every propose_file_patch MUST include: riskLevel, uiImpact, logicImpact, safeToTest.
4. After proposing a patch, explain in 2–3 sentences what it changes and why, then STOP.
5. Never auto-apply. Never claim a patch was applied before the user approves.
6. After a patch is applied, validation runs automatically — do not re-run unless asked.
7. Keep responses concise — no vague wording, no filler. Lead with what you found.
8. Do not touch .env, secrets, or auth config.
9. If you cannot find a file, say so clearly and search with a different pattern.
10. Group related changes into one patch per file. Propose one file at a time.

## Risk levels
- low:    cosmetic/text change, no logic change
- medium: logic or state change, isolated to one component
- high:   route changes, shared lib changes, or affects multiple components`;

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

  // Load project memory and inject into system prompt
  let systemPrompt = BASE_SYSTEM;
  try {
    const memoryBlock = formatMemoryForPrompt();
    if (memoryBlock) systemPrompt = `${BASE_SYSTEM}\n\n${memoryBlock}`;
  } catch { /* non-fatal if memory store unavailable */ }

  const messages: MessageParam[] = [
    { role: "user", content: message },
  ];

  let fullResponse = "";

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    if (isCancelled()) { send({ type: "dev:cancelled" }); return; }

    const blocks = new Map<number, ContentBlock & { input_json?: string }>();
    let stopReason = "end_turn";

    const stream = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
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
        }
      } else if (event.type === "content_block_delta") {
        const block = blocks.get(event.index);
        if (!block) continue;
        if (event.delta.type === "text_delta" && block.type === "text") {
          block.text += event.delta.text;
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
      let result: unknown;
      let errorMsg: string | undefined;
      try {
        result = await executeDevTool(tb.name, tb.input as Record<string, unknown>, send);
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : String(err);
        result = { error: errorMsg };
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

  send({ type: "dev:done", response: fullResponse });
}
