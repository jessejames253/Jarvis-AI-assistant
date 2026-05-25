/**
 * lib/dev/agent.ts — Dev agent powered by Claude + file/build tools.
 *
 * Understands developer requests, reads relevant files, proposes patches,
 * and runs checks. Patches are never auto-applied — user must approve.
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";
import { DEV_TOOL_DEFINITIONS, executeDevTool } from "./tools";

const DEV_SYSTEM = `You are Jarvis Dev Agent — an expert software engineer assistant that can inspect and propose changes to the Jarvis project codebase.

Project structure:
- /home/runner/workspace/artifacts/jarvas/       — React+Vite frontend
- /home/runner/workspace/artifacts/api-server/   — Express backend
- /home/runner/workspace/artifacts/jarvas/src/pages/Chat.tsx — Main chat UI
- /home/runner/workspace/artifacts/jarvas/src/components/ — UI components
- /home/runner/workspace/artifacts/api-server/src/routes/ — API routes
- /home/runner/workspace/artifacts/api-server/src/lib/    — Backend logic

Rules:
1. Always search/read files before proposing changes — never guess at content.
2. Use propose_file_patch for ALL edits. NEVER claim to edit files directly.
3. After proposing a patch, explain what it changes and why, then stop — wait for user approval.
4. Run typecheck after user approves and patch is applied.
5. Be concise — explain what you found and what you propose in 2–4 sentences.
6. Do not modify .env files, secrets, or authentication config.
7. If you cannot find relevant files, say so clearly.`;

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
      system: DEV_SYSTEM,
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
