/**
 * routes/chat.ts — Conversation endpoint
 *
 * POST /api/chat          — standard (single-response)
 * POST /api/chat/stream   — SSE streaming
 *
 * Both routes share the same pipeline:
 *   1. Validate input
 *   2. Intercept "forget" commands (delete LTM entries before any AI call)
 *   3. Load session history + long-term memory (LTM)
 *   4. Rank and inject relevant LTM facts into context
 *   5. Save the user's message
 *   6. Run the agent: classify intent → route to tool → generate response
 *   7. Save the assistant's response
 *   8. Apply side effects (preference updates)
 *   9. Asynchronously extract new LTM facts from the exchange (fire-and-forget)
 */

import { Router } from "express";
import { complete } from "../lib/responder";
import { appendMessage, getOrCreateSession, updatePreferences } from "../lib/memory";
import { logger } from "../lib/logger";
import { classifyIntent } from "../lib/intent";
import { searchNotes } from "../lib/kb/manager";
import { streamAiCompletion } from "../lib/tools/ai";
import { streamResearchCompletion } from "../lib/tools/research";
import { getLTM, rankEntries, addOrUpdateEntry, deleteMatchingEntries, deleteRecentEntries, clearLTM } from "../lib/ltm/store";
import { shouldExtract, extractFacts } from "../lib/ltm/extractor";
import type { ToolInput } from "../lib/types";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CLAUDE_INTENTS = new Set(["definition", "general", "coding", "planning", "research"]);

// Forget command patterns
const FORGET_ALL_RE  = /^(forget|clear|delete|erase|wipe)\s+(everything|all|my (memory|memories|data)|it all)\b/i;
const FORGET_THIS_RE = /^forget\s+(this|that)\b/i;
const FORGET_TOPIC_RE = /^forget\s+(?!everything|all|my|this|that\b)(.+)$/i;

/**
 * Fire-and-forget LTM extraction after each exchange.
 * Never throws — extraction failures must not affect chat responses.
 */
async function runExtraction(sessionId: string, userMessage: string): Promise<void> {
  try {
    if (!shouldExtract(userMessage)) return;
    const facts = await extractFacts(userMessage);
    await Promise.all(
      facts.map((f) =>
        addOrUpdateEntry(sessionId, {
          category: f.category,
          content: f.content,
          source: "auto",
          tags: f.tags,
        }),
      ),
    );
    if (facts.length > 0) {
      logger.info({ sessionId, count: facts.length }, "LTM facts extracted");
    }
  } catch (err) {
    logger.warn({ err, sessionId }, "LTM extraction failed (non-fatal)");
  }
}

// ─── POST /api/chat ───────────────────────────────────────────────────────────

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
    // ── Intercept forget commands ────────────────────────────────────────────
    if (hasSession) {
      if (FORGET_ALL_RE.test(trimmedMessage)) {
        await clearLTM(sessionId!);
        res.json({
          response: "Done — I've cleared all long-term memories for this session. Starting fresh.",
          model: "internal",
          sources: [],
          isSearch: false,
          debug: { intent: "memory_update", confidence: 0.97, signals: ["forget all command"], action: "ltm_clear_all", mode: "memory_manager", memoryUsed: false, ltmHits: [], reasoning: ["User requested full LTM wipe", "All long-term memory entries deleted"], processingMs: 0 },
        });
        return;
      }
      if (FORGET_THIS_RE.test(trimmedMessage)) {
        const deleted = await deleteRecentEntries(sessionId!, 2);
        res.json({
          response: deleted > 0
            ? `Forgotten — I've removed the ${deleted} most recently stored memor${deleted === 1 ? "y" : "ies"}.`
            : "There's nothing recent in long-term memory to forget.",
          model: "internal", sources: [], isSearch: false,
          debug: { intent: "memory_update", confidence: 0.95, signals: ["forget this/that command"], action: "ltm_delete_recent", mode: "memory_manager", memoryUsed: false, ltmHits: [], reasoning: [`Deleted ${deleted} recent LTM entries`], processingMs: 0 },
        });
        return;
      }
      const forgetTopicMatch = trimmedMessage.match(FORGET_TOPIC_RE);
      if (forgetTopicMatch) {
        const topic = forgetTopicMatch[1].trim();
        const deleted = await deleteMatchingEntries(sessionId!, topic);
        res.json({
          response: deleted > 0
            ? `Got it — I've removed ${deleted} memor${deleted === 1 ? "y" : "ies"} related to "${topic}".`
            : `I don't have anything stored about "${topic}" in long-term memory.`,
          model: "internal", sources: [], isSearch: false,
          debug: { intent: "memory_update", confidence: 0.95, signals: [`forget topic: "${topic}"`], action: "ltm_delete_topic", mode: "memory_manager", memoryUsed: false, ltmHits: [], reasoning: [`Searched LTM for topic: "${topic}"`, `Deleted ${deleted} matching entries`], processingMs: 0 },
        });
        return;
      }
    }

    // ── Load memory context ──────────────────────────────────────────────────
    let history: Array<{ role: "user" | "assistant"; content: string }> = [];
    let memoryContext: { summary?: string; preferences?: Record<string, string> } = {};
    let ltmHits: string[] = [];

    if (hasSession) {
      const session = await getOrCreateSession(sessionId!);
      history = session.messages.map((m) => ({ role: m.role, content: m.content }));
      if (session.summary) memoryContext.summary = session.summary;
      if (Object.keys(session.preferences).length > 0) {
        memoryContext.preferences = session.preferences as Record<string, string>;
      }
      (memoryContext as Record<string, unknown>).sessionId = sessionId!;

      // ── Long-term memory ───────────────────────────────────────────────────
      const ltmStore = await getLTM(sessionId!);
      if (ltmStore.entries.length > 0) {
        const ranked = rankEntries(ltmStore.entries, trimmedMessage, 8);
        if (ranked.length > 0) {
          (memoryContext as Record<string, unknown>).ltmFacts = ranked.map((e) => ({
            id: e.id, category: e.category, content: e.content, tags: e.tags,
          }));
          ltmHits = ranked.map((e) => `[${e.category}] ${e.content}`);
        }
      }

      await appendMessage(sessionId!, "user", trimmedMessage);
    }

    // ── Run the agent ────────────────────────────────────────────────────────
    const output = await complete({ message: trimmedMessage, history, memoryContext });

    // ── Persist the response ─────────────────────────────────────────────────
    if (hasSession) {
      await appendMessage(sessionId!, "assistant", output.response);
      if (output.sideEffects?.updatePreferences) {
        await updatePreferences(sessionId!, output.sideEffects.updatePreferences);
        logger.info({ sessionId, prefs: output.sideEffects.updatePreferences }, "Preferences updated");
      }
      // Extract and store new facts (async, never blocks response)
      void runExtraction(sessionId!, trimmedMessage);
    }

    res.json({
      response: output.response,
      model: output.model,
      sources: output.sources,
      isSearch: output.isSearch,
      isFakeSearch: output.isFakeSearch,
      debug: { ...output.debug, ltmHits },
    });
  } catch (err) {
    logger.error({ err, message: trimmedMessage }, "Chat pipeline error");
    res.status(500).json({ error: "Failed to generate response" });
  }
});

// ─── POST /api/chat/stream ────────────────────────────────────────────────────

router.post("/chat/stream", async (req, res) => {
  const { message, sessionId } = req.body as { message?: string; sessionId?: string };

  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "Missing or invalid message" });
    return;
  }

  // ── SSE headers ──────────────────────────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: object) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const trimmedMessage = message.trim();
  const hasSession = !!(sessionId && /^[a-zA-Z0-9\-]{8,64}$/.test(sessionId));
  const startTime = Date.now();

  try {
    // ── Intercept forget commands ────────────────────────────────────────────
    if (hasSession) {
      if (FORGET_ALL_RE.test(trimmedMessage)) {
        await clearLTM(sessionId!);
        send({ type: "token", text: "Done — I've cleared all long-term memories for this session. Starting fresh." });
        send({ type: "done", model: "internal", isSearch: false, isFakeSearch: false, sources: [],
          debug: { intent: "memory_update", confidence: 0.97, signals: ["forget all command"], action: "ltm_clear_all", mode: "memory_manager", memoryUsed: false, ltmHits: [], reasoning: ["User requested full LTM wipe", "All LTM entries deleted"], processingMs: Date.now() - startTime } });
        res.end(); return;
      }
      if (FORGET_THIS_RE.test(trimmedMessage)) {
        const deleted = await deleteRecentEntries(sessionId!, 2);
        const txt = deleted > 0
          ? `Forgotten — I've removed the ${deleted} most recently stored memor${deleted === 1 ? "y" : "ies"}.`
          : "There's nothing recent in long-term memory to forget.";
        send({ type: "token", text: txt });
        send({ type: "done", model: "internal", isSearch: false, isFakeSearch: false, sources: [],
          debug: { intent: "memory_update", confidence: 0.95, signals: ["forget this/that"], action: "ltm_delete_recent", mode: "memory_manager", memoryUsed: false, ltmHits: [], reasoning: [`Deleted ${deleted} recent LTM entries`], processingMs: Date.now() - startTime } });
        res.end(); return;
      }
      const forgetTopicMatch = trimmedMessage.match(FORGET_TOPIC_RE);
      if (forgetTopicMatch) {
        const topic = forgetTopicMatch[1].trim();
        const deleted = await deleteMatchingEntries(sessionId!, topic);
        const txt = deleted > 0
          ? `Got it — I've removed ${deleted} memor${deleted === 1 ? "y" : "ies"} related to "${topic}".`
          : `I don't have anything stored about "${topic}" in long-term memory.`;
        send({ type: "token", text: txt });
        send({ type: "done", model: "internal", isSearch: false, isFakeSearch: false, sources: [],
          debug: { intent: "memory_update", confidence: 0.95, signals: [`forget topic: "${topic}"`], action: "ltm_delete_topic", mode: "memory_manager", memoryUsed: false, ltmHits: [], reasoning: [`Deleted ${deleted} matching LTM entries for: "${topic}"`], processingMs: Date.now() - startTime } });
        res.end(); return;
      }
    }

    // ── Load memory context ──────────────────────────────────────────────────
    let history: Array<{ role: "user" | "assistant"; content: string }> = [];
    const memoryContext: Record<string, unknown> = {};
    let ltmHits: string[] = [];

    if (hasSession) {
      const session = await getOrCreateSession(sessionId!);
      history = session.messages.map((m) => ({ role: m.role, content: m.content }));
      if (session.summary) memoryContext.summary = session.summary;
      if (Object.keys(session.preferences).length > 0) memoryContext.preferences = session.preferences;
      memoryContext.sessionId = sessionId!;

      // ── Long-term memory ───────────────────────────────────────────────────
      const ltmStore = await getLTM(sessionId!);
      if (ltmStore.entries.length > 0) {
        const ranked = rankEntries(ltmStore.entries, trimmedMessage, 8);
        if (ranked.length > 0) {
          memoryContext.ltmFacts = ranked.map((e) => ({
            id: e.id, category: e.category, content: e.content, tags: e.tags,
          }));
          ltmHits = ranked.map((e) => `[${e.category}] ${e.content}`);
        }
      }

      await appendMessage(sessionId!, "user", trimmedMessage);
    }

    // ── Classify intent ──────────────────────────────────────────────────────
    const classification = classifyIntent(trimmedMessage, history);

    // ── Build tool input + inject KB notes ────────────────────────────────────
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
      streamMeta = await streamAiCompletion(toolInput, (text) => {
        fullResponse += text;
        send({ type: "token", text });
      });
    } else if (classification.intent === "research") {
      const meta = await streamResearchCompletion(toolInput, (text) => {
        fullResponse += text;
        send({ type: "token", text });
      });
      streamMeta = { action: meta.action, mode: meta.mode, reasoning: meta.reasoning };
      sources = meta.sources;
      isSearch = meta.isSearch;
      isFakeSearch = meta.isFakeSearch;
    } else {
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
        logger.info({ sessionId, prefs: sideEffects.updatePreferences }, "Preferences updated (stream)");
      }
      // Extract and store new LTM facts (async, never blocks stream)
      void runExtraction(sessionId!, trimmedMessage);
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
        ltmHits,
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
