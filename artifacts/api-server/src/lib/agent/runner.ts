/**
 * agent/runner.ts — Autonomous agentic loop with tool execution
 *
 * Streams responses from Claude while supporting multi-step tool use.
 * The loop runs until Claude stops requesting tools (stop_reason = "end_turn")
 * or reaches MAX_ITERATIONS.
 *
 * SSE events emitted via `send()`:
 *   { type: "token",      text: string }
 *   { type: "tool_start", toolCallId, tool, label }
 *   { type: "tool_done",  toolCallId, tool, durationMs, result }
 *   { type: "tool_error", toolCallId, tool, durationMs, error }
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";
import { TOOL_DEFINITIONS, TOOL_LABELS, executeToolCall } from "./registry";
import type { ToolContext } from "./registry";
import type { ToolInput } from "../types";
import type { AgentToolCall } from "../types";

// ─── Jarvis system prompt (mirrors ai.ts for personality consistency) ─────────

const SYSTEM_PROMPT = `You are Jarvis — a calm, intelligent, and direct AI assistant. Your personality:

- Confident and precise. Answer questions directly without unnecessary preamble.
- Never say "Great question!" or "Certainly!" or similar filler phrases.
- Don't repeat the user's question back to them.
- Give the answer first, context second. If a short answer suffices, don't pad it.
- Only ask a clarifying question if the request is genuinely ambiguous. Never ask multiple at once.
- For code requests: write the code immediately.
- For factual questions: answer from your training knowledge. Be honest about uncertainty.
- Format responses well: use markdown for code blocks, bullet points for lists, bold for key terms.
- Be concise but never terse to the point of being unhelpful.
- Your aesthetic: futuristic, efficient, cyberpunk-adjacent. Think Iron Man's JARVIS, not a chatbot.

You have access to tools. Use them when they add clear value. Don't use tools for things you already know well from training data unless the user explicitly asks for live data. When you use a tool, don't narrate that you're going to use it — just use it and incorporate the result naturally.`;

const MAX_ITERATIONS = 6;

// ─── Context block builder (mirrors ai.ts buildMessages) ─────────────────────

function buildContextPrefix(input: ToolInput): string {
  const parts: string[] = [];

  if (input.memoryContext?.summary) {
    parts.push(`[Conversation summary: ${input.memoryContext.summary}]`);
  }
  if (input.memoryContext?.preferences?.name) {
    parts.push(`[User's name: ${input.memoryContext.preferences.name}]`);
  }
  if (input.memoryContext?.ltmFacts && input.memoryContext.ltmFacts.length > 0) {
    const grouped: Record<string, string[]> = {};
    for (const f of input.memoryContext.ltmFacts) {
      (grouped[f.category] ??= []).push(f.content);
    }
    const lines = Object.entries(grouped)
      .map(([cat, facts]) => `  ${cat}:\n${facts.map((f) => `    • ${f}`).join("\n")}`)
      .join("\n");
    parts.push(`[Long-term memories about this user:\n${lines}\n]`);
  }
  if (input.memoryContext?.kbNotes && input.memoryContext.kbNotes.length > 0) {
    const notes = input.memoryContext.kbNotes
      .map((n) => `• ${n.title}: ${n.content.slice(0, 300)}`)
      .join("\n");
    parts.push(`[Relevant notes from user's Knowledge Base:\n${notes}]`);
  }

  return parts.join("\n");
}

// Content block types for the agentic loop
type TextBlock = { type: "text"; text: string };
type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: unknown };
type ContentBlock = TextBlock | ToolUseBlock;

type MessageParam =
  | { role: "user"; content: string | Array<{ type: "tool_result"; tool_use_id: string; content: string }> }
  | { role: "assistant"; content: ContentBlock[] };

// ─── Main agent runner ────────────────────────────────────────────────────────

export interface AgentRunResult {
  fullResponse: string;
  toolCalls: AgentToolCall[];
  reasoning: string[];
  inputTokens: number;
  outputTokens: number;
}

export async function runAgent(
  toolInput: ToolInput,
  ctx: ToolContext,
  send: (data: object) => void,
): Promise<AgentRunResult> {
  const contextPrefix = buildContextPrefix(toolInput);
  const userContent = contextPrefix
    ? `${contextPrefix}\n\n${toolInput.message}`
    : toolInput.message;

  // Build initial messages from history + current user message
  const initialMessages: MessageParam[] = [
    ...toolInput.history.slice(-20).map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user", content: userContent },
  ];

  // Mutable messages for the agentic loop (grows with each tool round-trip)
  const messages: MessageParam[] = [...initialMessages];

  const allToolCalls: AgentToolCall[] = [];
  let fullResponse = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    // Track content blocks for this iteration
    const blocks = new Map<number, ContentBlock & { input_json?: string }>();
    let stopReason = "end_turn";

    const stream = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: messages as Parameters<typeof anthropic.messages.create>[0]["messages"],
      tools: TOOL_DEFINITIONS as Parameters<typeof anthropic.messages.create>[0]["tools"],
      stream: true,
    });

    for await (const event of stream) {
      if (event.type === "message_start") {
        totalInputTokens += event.message.usage.input_tokens;
      } else if (event.type === "content_block_start") {
        const idx = event.index;
        const cb = event.content_block;
        if (cb.type === "text") {
          blocks.set(idx, { type: "text", text: "" });
        } else if (cb.type === "tool_use") {
          blocks.set(idx, { type: "tool_use", id: cb.id, name: cb.name, input: {}, input_json: "" });
          // Emit tool_start immediately
          const label = TOOL_LABELS[cb.name]?.running ?? `Using ${cb.name}...`;
          send({ type: "tool_start", toolCallId: cb.id, tool: cb.name, label });
        }
      } else if (event.type === "content_block_delta") {
        const block = blocks.get(event.index);
        if (!block) continue;
        if (event.delta.type === "text_delta" && block.type === "text") {
          block.text += event.delta.text;
          fullResponse += event.delta.text;
          send({ type: "token", text: event.delta.text });
        } else if (event.delta.type === "input_json_delta" && block.type === "tool_use") {
          (block as { input_json: string }).input_json =
            ((block as { input_json: string }).input_json ?? "") + event.delta.partial_json;
        }
      } else if (event.type === "content_block_stop") {
        const block = blocks.get(event.index);
        if (block?.type === "tool_use") {
          try {
            block.input = JSON.parse((block as { input_json: string }).input_json ?? "{}");
          } catch {
            block.input = {};
          }
        }
      } else if (event.type === "message_delta") {
        totalOutputTokens += event.usage.output_tokens;
        stopReason = event.delta.stop_reason ?? "end_turn";
      }
    }

    // Build assistant content for the loop (clean, without input_json)
    const assistantContent: ContentBlock[] = Array.from(blocks.values()).map((b) => {
      if (b.type === "text") return { type: "text", text: b.text };
      return { type: "tool_use", id: (b as ToolUseBlock).id, name: (b as ToolUseBlock).name, input: (b as ToolUseBlock).input };
    });
    messages.push({ role: "assistant", content: assistantContent });

    // If no tool_use stop, we're done
    if (stopReason !== "tool_use") break;

    // Execute all tool_use blocks
    const toolUseBlocks = assistantContent.filter((b): b is ToolUseBlock => b.type === "tool_use");
    const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];

    for (const tb of toolUseBlocks) {
      const start = Date.now();
      let result: unknown;
      let errorMsg: string | undefined;

      try {
        result = await executeToolCall(tb.name, tb.input as Record<string, unknown>, ctx);
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : String(err);
        result = { error: errorMsg };
      }

      const durationMs = Date.now() - start;
      const toolCall: AgentToolCall = {
        tool: tb.name,
        label: TOOL_LABELS[tb.name]?.done ?? tb.name,
        durationMs,
        status: errorMsg ? "error" : "done",
        result: errorMsg ? undefined : result,
        error: errorMsg,
      };
      allToolCalls.push(toolCall);

      if (errorMsg) {
        send({ type: "tool_error", toolCallId: tb.id, tool: tb.name, durationMs, error: errorMsg });
      } else {
        send({ type: "tool_done", toolCallId: tb.id, tool: tb.name, durationMs, result });
      }

      const contentStr = errorMsg
        ? `Error: ${errorMsg}`
        : typeof result === "string"
        ? result
        : JSON.stringify(result, null, 2);

      toolResults.push({ type: "tool_result", tool_use_id: tb.id, content: contentStr });
    }

    messages.push({ role: "user", content: toolResults });
  }

  const reasoning = [
    `Agent loop: ${MAX_ITERATIONS} max iterations`,
    `Tools invoked: ${allToolCalls.length}`,
    ...(allToolCalls.length > 0
      ? allToolCalls.map((tc) => `  • ${tc.tool} → ${tc.status} (${tc.durationMs}ms)`)
      : ["No tools needed — responded from knowledge"]),
    `Tokens: ${totalInputTokens} in / ${totalOutputTokens} out`,
  ];

  return { fullResponse, toolCalls: allToolCalls, reasoning, inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
}
