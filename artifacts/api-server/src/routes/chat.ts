/**
 * routes/chat.ts — Conversation endpoint
 *
 * POST /api/chat
 *
 * Full pipeline:
 *   1. Validate input
 *   2. Load session history from memory (if sessionId provided)
 *   3. Save the user's message to memory
 *   4. Run the agent: classify intent → route to tool → generate response
 *   5. Save the assistant's response to memory
 *   6. Apply any side effects (e.g. preference updates from the memory tool)
 *   7. Return response + sources + debug info
 *
 * Request body:
 *   {
 *     message:   string   — the user's message (required)
 *     sessionId: string   — UUID identifying the session (optional)
 *   }
 *
 * Response:
 *   {
 *     response:   string       — Jarvis's reply
 *     model:      string       — engine that produced the response
 *     sources?:   Source[]     — web search results (when intent = research)
 *     isSearch?:  boolean      — true when sources are included
 *     isFakeSearch?: boolean   — true when running in demo search mode
 *     debug:      DebugInfo    — intent, action, reasoning path, timing
 *   }
 */

import { Router } from "express";
import { complete } from "../lib/responder";
import { appendMessage, getOrCreateSession, updatePreferences } from "../lib/memory";
import { logger } from "../lib/logger";
import { classifyIntent } from "../lib/intent";
import { searchNotes } from "../lib/kb/manager";
import { streamAiCompletion } from "../lib/tools/ai";
import { streamResearchCompletion } from "../lib/tools/research";
import type { ToolInput } from "../lib/types";

const router = Router();

router.post("/chat", async (req, res) => {
  const { message, sessionId } = req.body as {
    message?: string;
    sessionId?: string;
  };

  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "Missing or invalid message" });
    return;
  }

  const trimmedMessage = message.trim();
  const hasSession = !!(sessionId && /^[a-zA-Z0-9\-]{8,64}$/.test(sessionId));

  try {
    // ── Load memory context ──────────────────────────────────────────────────
    let history: Array<{ role: "user" | "assistant"; content: string }> = [];
    let memoryContext: { summary?: string; preferences?: Record<string, string> } = {};

    if (hasSession) {
      const session = await getOrCreateSession(sessionId!);
      history = session.messages.map((m) => ({ role: m.role, content: m.content }));
      if (session.summary) memoryContext.summary = session.summary;
      if (Object.keys(session.preferences).length > 0) {
        memoryContext.preferences = session.preferences as Record<string, string>;
      }
      // Pass sessionId so tools like tasks can load session-scoped data
      (memoryContext as Record<string, unknown>).sessionId = sessionId!;
      // Save the user message before generating (so it's in memory even on error)
      await appendMessage(sessionId!, "user", trimmedMessage);
    }

    // ── Run the agent ────────────────────────────────────────────────────────
    const output = await complete({ message: trimmedMessage, history, memoryContext });

    // ── Persist the response ─────────────────────────────────────────────────
    if (hasSession) {
      await appendMessage(sessionId!, "assistant", output.response);

      // Apply side effects — e.g. the memory update tool sets a name preference
      if (output.sideEffects?.updatePreferences) {
        await updatePreferences(sessionId!, output.sideEffects.updatePreferences);
        logger.info({ sessionId, prefs: output.sideEffects.updatePreferences }, "Preferences updated via tool");
      }
    }

    // ── Respond ──────────────────────────────────────────────────────────────
    res.json({
      response: output.response,
      model: output.model,
      sources: output.sources,
      isSearch: output.isSearch,
      isFakeSearch: output.isFakeSearch,
      debug: output.debug,
    });
  } catch (err) {
    logger.error({ err, message: trimmedMessage }, "Chat pipeline error");
    res.status(500).json({ error: "Failed to generate response" });
  }
});

// ─── Streaming endpoint ───────────────────────────────────────────────────────
// POST /api/chat/stream — SSE endpoint that streams tokens as they arrive.
// Claude intents (definition/general/coding/planning/research) stream token by
// token. All other tools (math, tasks, KB, memory, casual, identity) run
// normally and their response is emitted as a single token event.

const CLAUDE_INTENTS = new Set(["definition", "general", "coding", "planning", "research"]);

router.post("/chat/stream", async (req, res) => {
  const { message, sessionId } = req.body as { message?: string; sessionId?: string };

  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "Missing or invalid message" });
    return;
  }

  // ── SSE headers ─────────────────────────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  res.flushHeaders();

  const send = (data: object) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const trimmedMessage = message.trim();
  const hasSession = !!(sessionId && /^[a-zA-Z0-9\-]{8,64}$/.test(sessionId));
  const startTime = Date.now();

  try {
    // ── Load memory context ──────────────────────────────────────────────────
    let history: Array<{ role: "user" | "assistant"; content: string }> = [];
    const memoryContext: Record<string, unknown> = {};

    if (hasSession) {
      const session = await getOrCreateSession(sessionId!);
      history = session.messages.map((m) => ({ role: m.role, content: m.content }));
      if (session.summary) memoryContext.summary = session.summary;
      if (Object.keys(session.preferences).length > 0) memoryContext.preferences = session.preferences;
      memoryContext.sessionId = sessionId!;
      await appendMessage(sessionId!, "user", trimmedMessage);
    }

    // ── Classify intent ──────────────────────────────────────────────────────
    const classification = classifyIntent(trimmedMessage, history);

    // ── Build tool input + inject KB notes (mirrors router.ts) ───────────────
    const toolInput: ToolInput = {
      message: trimmedMessage,
      history,
      memoryContext: memoryContext as ToolInput["memoryContext"],
      classification,
    };

    if (hasSession && !["casual", "identity"].includes(classification.intent)) {
      try {
        const hits = await searchNotes(sessionId!, trimmedMessage, 3);
        if (hits.length > 0 && hits[0].score > 0.15) {
          toolInput.memoryContext!.kbNotes = hits.map((h) => ({
            id: h.note.id, title: h.note.title, content: h.note.content,
            type: h.note.type, tags: h.note.tags, url: h.note.url,
          }));
        }
      } catch { /* KB errors never block chat */ }
    }

    // ── Route: Claude (streaming) vs instant tools ────────────────────────────
    let fullResponse = "";
    let streamMeta: { action: string; mode: string; reasoning: string[] } =
      { action: "", mode: "", reasoning: [] };
    let sources: unknown[] | undefined;
    let isSearch: boolean | undefined;
    let isFakeSearch: boolean | undefined;
    let sideEffects: { updatePreferences?: Record<string, string> } | undefined;

    if (CLAUDE_INTENTS.has(classification.intent) && classification.intent !== "research") {
      // ── Stream from AI tool ────────────────────────────────────────────────
      streamMeta = await streamAiCompletion(toolInput, (text) => {
        fullResponse += text;
        send({ type: "token", text });
      });
    } else if (classification.intent === "research") {
      // ── Web search + stream synthesis ─────────────────────────────────────
      const meta = await streamResearchCompletion(toolInput, (text) => {
        fullResponse += text;
        send({ type: "token", text });
      });
      streamMeta = { action: meta.action, mode: meta.mode, reasoning: meta.reasoning };
      sources = meta.sources;
      isSearch = meta.isSearch;
      isFakeSearch = meta.isFakeSearch;
    } else {
      // ── Instant tool (math, tasks, KB, memory, casual, identity) ──────────
      const output = await complete({ message: trimmedMessage, history, memoryContext: memoryContext as Parameters<typeof complete>[0]["memoryContext"] });
      fullResponse = output.response;
      sources = output.sources;
      isSearch = output.isSearch;
      isFakeSearch = output.isFakeSearch;
      sideEffects = output.sideEffects;
      streamMeta = {
        action: output.debug.action ?? "",
        mode: output.debug.mode ?? "",
        reasoning: output.debug.reasoning ?? [],
      };
      send({ type: "token", text: output.response });
    }

    // ── Persist the response ─────────────────────────────────────────────────
    if (hasSession) {
      await appendMessage(sessionId!, "assistant", fullResponse);
      if (sideEffects?.updatePreferences) {
        await updatePreferences(sessionId!, sideEffects.updatePreferences);
        logger.info({ sessionId, prefs: sideEffects.updatePreferences }, "Preferences updated via tool (stream)");
      }
    }

    // ── Done event ───────────────────────────────────────────────────────────
    send({
      type: "done",
      model: "claude-sonnet-4-6",
      isSearch: isSearch ?? false,
      isFakeSearch: isFakeSearch ?? false,
      sources: sources ?? [],
      debug: {
        intent: classification.intent,
        secondaryIntent: classification.secondaryIntent,
        confidence: classification.confidence,
        signals: classification.signals,
        action: streamMeta.action,
        mode: streamMeta.mode,
        memoryUsed: !!(memoryContext.summary || memoryContext.preferences),
        reasoning: streamMeta.reasoning,
        processingMs: Date.now() - startTime,
      },
    });
  } catch (err) {
    logger.error({ err, message: trimmedMessage }, "Stream chat error");
    send({ type: "error", message: "Failed to generate response" });
  }

  res.end();
});

export default router;
