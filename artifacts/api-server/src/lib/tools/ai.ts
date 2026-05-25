/**
 * lib/tools/ai.ts — Claude-powered AI brain
 *
 * This is the central intelligence of Jarvis. It replaces all template-based
 * tools for knowledge, coding, planning, and general questions.
 *
 * Strategy:
 *   - All non-trivial questions go through Claude (claude-sonnet-4-6)
 *   - The system prompt defines Jarvis's personality and capabilities
 *   - Conversation history is forwarded so Claude has full context
 *   - KB notes, memory summary, and user preferences are injected as context
 *   - Math is still handled by the deterministic mathTool (exact arithmetic)
 *   - Memory updates, tasks, KB management keep their own handlers
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { Tool, ToolInput, ToolOutput } from "../types";

const SYSTEM_PROMPT = `You are Jarvis — a calm, intelligent, and direct AI assistant. Your personality:

- Confident and precise. Answer questions directly without unnecessary preamble.
- Never say "Great question!" or "Certainly!" or similar filler phrases.
- Don't repeat the user's question back to them.
- Give the answer first, context second. If a short answer suffices, don't pad it.
- Only ask a clarifying question if the request is genuinely ambiguous and you cannot make a reasonable assumption. Never ask multiple clarifying questions at once.
- For code requests: write the code immediately. Don't ask what language unless it's truly unspecifiable.
- For factual questions: answer from your training knowledge. Be honest about uncertainty but don't refuse to answer.
- Format responses well: use markdown for code blocks, bullet points for lists, bold for key terms.
- Be concise but never terse to the point of being unhelpful.
- Your aesthetic: futuristic, efficient, cyberpunk-adjacent. Think Iron Man's JARVIS, not a chatbot.`;

function buildMessages(input: ToolInput): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  // Inject memory context as an early system-style user/assistant exchange
  const contextParts: string[] = [];

  if (input.memoryContext?.summary) {
    contextParts.push(`[Conversation summary: ${input.memoryContext.summary}]`);
  }
  if (input.memoryContext?.preferences?.name) {
    contextParts.push(`[User's name: ${input.memoryContext.preferences.name}]`);
  }
  if (input.memoryContext?.kbNotes && input.memoryContext.kbNotes.length > 0) {
    const notesText = input.memoryContext.kbNotes
      .map((n) => `• ${n.title}: ${n.content.slice(0, 300)}`)
      .join("\n");
    contextParts.push(`[Relevant notes from user's Knowledge Base:\n${notesText}]`);
  }

  // Prior conversation history
  for (const h of input.history.slice(-20)) {
    // last 20 turns max
    messages.push({ role: h.role, content: h.content });
  }

  // If we have context to inject and history exists, prepend to first user message
  // Otherwise add as a separate context block before the current message
  if (contextParts.length > 0 && messages.length === 0) {
    messages.push({
      role: "user",
      content: `${contextParts.join("\n")}\n\n${input.message}`,
    });
  } else if (contextParts.length > 0) {
    // Prepend context to the current message
    messages.push({
      role: "user",
      content: `${contextParts.join("\n")}\n\n${input.message}`,
    });
  } else {
    messages.push({ role: "user", content: input.message });
  }

  return messages;
}

/**
 * Streaming variant — pipes tokens to onToken as they arrive from Claude.
 * Used by the /api/chat/stream SSE endpoint.
 */
export async function streamAiCompletion(
  input: ToolInput,
  onToken: (text: string) => void,
): Promise<{ action: string; mode: string; reasoning: string[] }> {
  const intent = input.classification.intent;
  const mode =
    intent === "coding" ? "coding_assistant" :
    intent === "planning" ? "planning_assistant" :
    "knowledge_base";

  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason = "end_turn";

  const stream = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: buildMessages(input),
    stream: true,
  });

  for await (const event of stream) {
    if (event.type === "message_start") {
      inputTokens = event.message.usage.input_tokens;
    } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      onToken(event.delta.text);
    } else if (event.type === "message_delta") {
      outputTokens = event.usage.output_tokens;
      stopReason = event.delta.stop_reason ?? "end_turn";
    }
  }

  return {
    action: `ai_${intent}`,
    mode,
    reasoning: [
      `Claude claude-sonnet-4-6 streamed`,
      `intent: ${intent} (confidence: ${input.classification.confidence})`,
      `history turns: ${input.history.length}`,
      `kb notes injected: ${input.memoryContext?.kbNotes?.length ?? 0}`,
      `stop_reason: ${stopReason}`,
      `tokens: ${inputTokens} in / ${outputTokens} out`,
    ],
  };
}

export const aiTool: Tool = {
  name: "ai",
  description: "Claude-powered AI brain — handles all knowledge, coding, planning, and general questions",
  handles: ["definition", "general", "coding", "planning"],

  async execute(input: ToolInput): Promise<ToolOutput> {
    const intent = input.classification.intent;
    const mode =
      intent === "coding" ? "coding_assistant" :
      intent === "planning" ? "planning_assistant" :
      "knowledge_base";

    try {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: buildMessages(input),
      });

      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");

      return {
        response: text,
        action: `ai_${intent}`,
        mode,
        reasoning: [
          `Claude claude-sonnet-4-6 invoked`,
          `intent: ${intent} (confidence: ${input.classification.confidence})`,
          `history turns: ${input.history.length}`,
          `kb notes injected: ${input.memoryContext?.kbNotes?.length ?? 0}`,
          `stop_reason: ${response.stop_reason}`,
          `tokens: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`,
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        response: "I'm having trouble reaching my reasoning engine right now. Please try again in a moment.",
        action: "ai_error",
        mode,
        reasoning: [`Claude API error: ${msg}`],
      };
    }
  },
};
