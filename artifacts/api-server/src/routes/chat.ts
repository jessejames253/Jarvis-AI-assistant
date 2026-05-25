/**
 * routes/chat.ts — Conversation endpoints
 *
 * POST /api/chat          — standard (single-response)
 * POST /api/chat/stream   — SSE streaming with autonomous tool use
 *
 * Pipeline:
 *   1. Validate input
 *   2. Intercept "forget" commands
 *   3. Load session history + LTM
 *   4. Classify intent
 *   5a. AGENT_INTENTS → runAgent() (tool-enabled streaming)
 *   5b. Other intents  → existing instant tools
 *   6. Persist response + async LTM extraction
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
import { runAgent } from "../lib/agent/runner";
import type { ToolInput } from "../lib/types";

const router = Router();

// ─── Constants ────────────────────────────────────────────────────────────────

/** Intents routed through the autonomous agent runner (Claude + tools) */
const AGENT_INTENTS = new Set(["coding", "planning", "definition", "general", "research"]);

// Forget command patterns
const FORGET_ALL_RE   = /^(forget|clear|delete|erase|wipe)\s+(everything|all|my (memory|memories|data)|it all)\b/i;
const FORGET_THIS_RE  = /^forget\s+(this|that)\b/i;
const FORGET_TOPIC_RE = /^forget\s+(?!everything|all|my|this|that\b)(.+)$/i;

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
    if (facts.length > 0) logger.info({ sessionId, count: facts.length }, "LTM facts extracted");
  } catch (err) {
    logger.warn({ err, sessionId }, "LTM extraction failed (non-fatal)");
  }
}

/** Build the shared memory context object */
async function loadMemoryContext(sessionId: string, message: string) {
  const session = await getOrCreateSession(sessionId);
  const memoryContext: Record<string, unknown> = {};
  if (session.summary) memoryContext.summary = session.summary;
  if (Object.keys(session.preferences).length > 0) memoryContext.preferences = session.preferences;
  memoryContext.sessionId = sessionId;

  const ltmStore = await getLTM(sessionId);
  let ltmHits: string[] = [];
  if (ltmStore.entries.length > 0) {
    const ranked = rankEntries(ltmStore.entries, message, 8);
    if (ranked.length > 0) {
      memoryContext.ltmFacts = ranked.map((e) => ({
        id: e.id, category: e.category, content: e.content, tags: e.tags,
      }));
      ltmHits = ranked.map((e) => `[${e.category}] ${e.content}`);
    }
  }

  const history = session.messages.map((m) => ({ role: m.role, content: m.content }));
  return { session, history, memoryContext, ltmHits };
}

/** Forget command responses (shared by both endpoints) */
async function handleForgetCommand(
  sessionId: string,
  message: string,
  startTime: number,
): Promise<{ matched: true; response: string; debug: object } | { matched: false }> {
  if (FORGET_ALL_RE.test(message)) {
    await clearLTM(sessionId);
    return {
      matched: true,
      response: "Done — I've cleared all long-term memories for this session. Starting fresh.",
      debug: { intent: "memory_update", confidence: 0.97, signals: ["forget all"], action: "ltm_clear_all", mode: "memory_manager", memoryUsed: false, ltmHits: [], toolCalls: [], reasoning: ["User requested full LTM wipe", "All LTM entries deleted"], processingMs: Date.now() - startTime },
    };
  }
  if (FORGET_THIS_RE.test(message)) {
    const deleted = await deleteRecentEntries(sessionId, 2);
    return {
      matched: true,
      response: deleted > 0
        ? `Forgotten — removed the ${deleted} most recently stored memor${deleted === 1 ? "y" : "ies"}.`
        : "Nothing recent in long-term memory to forget.",
      debug: { intent: "memory_update", confidence: 0.95, signals: ["forget this/that"], action: "ltm_delete_recent", mode: "memory_manager", memoryUsed: false, ltmHits: [], toolCalls: [], reasoning: [`Deleted ${deleted} recent LTM entries`], processingMs: Date.now() - startTime },
    };
  }
  const topicMatch = message.match(FORGET_TOPIC_RE);
  if (topicMatch) {
    const topic = topicMatch[1].trim();
    const deleted = await deleteMatchingEntries(sessionId, topic);
    return {
      matched: true,
      response: deleted > 0
        ? `Removed ${deleted} memor${deleted === 1 ? "y" : "ies"} related to "${topic}".`
        : `Nothing stored about "${topic}" in long-term memory.`,
      debug: { intent: "memory_update", confidence: 0.95, signals: [`forget topic: "${topic}"`], action: "ltm_delete_topic", mode: "memory_manager", memoryUsed: false, ltmHits: [], toolCalls: [], reasoning: [`Deleted ${deleted} LTM entries for: "${topic}"`], processingMs: Date.now() - startTime },
    };
  }
  return { matched: false };
}

// ─── POST /api/chat ───────────────────────────────────────────────────────────

router.post("/chat", async (req, res) => {
  const { message, sessionId } = req.body as { message?: string; sessionId?: string };
  if (!message?.trim()) { res.status(400).json({ error: "Missing or invalid message" }); return; }

  const trimmed = message.trim();
  const hasSid = !!(sessionId && /^[a-zA-Z0-9\-]{8,64}$/.test(sessionId));
  const startTime = Date.now();

  try {
    if (hasSid) {
      const forgot = await handleForgetCommand(sessionId!, trimmed, startTime);
      if (forgot.matched) { res.json({ response: forgot.response, model: "internal", sources: [], isSearch: false, debug: forgot.debug }); return; }
    }

    let history: Array<{ role: "user" | "assistant"; content: string }> = [];
    let memoryContext: Record<string, unknown> = {};
    let ltmHits: string[] = [];

    if (hasSid) {
      const mc = await loadMemoryContext(sessionId!, trimmed);
      history = mc.history as Array<{ role: "user" | "assistant"; content: string }>;
      memoryContext = mc.memoryContext;
      ltmHits = mc.ltmHits;
      await appendMessage(sessionId!, "user", trimmed);
    }

    const output = await complete({ message: trimmed, history, memoryContext });

    if (hasSid) {
      await appendMessage(sessionId!, "assistant", output.response);
      if (output.sideEffects?.updatePreferences) await updatePreferences(sessionId!, output.sideEffects.updatePreferences);
      void runExtraction(sessionId!, trimmed);
    }

    res.json({ response: output.response, model: output.model, sources: output.sources, isSearch: output.isSearch, debug: { ...output.debug, ltmHits, toolCalls: [] } });
  } catch (err) {
    logger.error({ err, message: trimmed }, "Chat pipeline error");
    res.status(500).json({ error: "Failed to generate response" });
  }
});

// ─── POST /api/chat/stream ────────────────────────────────────────────────────

router.post("/chat/stream", async (req, res) => {
  const { message, sessionId } = req.body as { message?: string; sessionId?: string };
  if (!message?.trim()) { res.status(400).json({ error: "Missing or invalid message" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: object) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };
  const trimmed = message.trim();
  const hasSid = !!(sessionId && /^[a-zA-Z0-9\-]{8,64}$/.test(sessionId));
  const startTime = Date.now();

  try {
    // ── Forget intercept ────────────────────────────────────────────────────
    if (hasSid) {
      const forgot = await handleForgetCommand(sessionId!, trimmed, startTime);
      if (forgot.matched) {
        send({ type: "token", text: forgot.response });
        send({ type: "done", model: "internal", isSearch: false, isFakeSearch: false, sources: [], debug: forgot.debug });
        res.end(); return;
      }
    }

    // ── Load memory ─────────────────────────────────────────────────────────
    let history: Array<{ role: "user" | "assistant"; content: string }> = [];
    const memoryContext: Record<string, unknown> = {};
    let ltmHits: string[] = [];

    if (hasSid) {
      const mc = await loadMemoryContext(sessionId!, trimmed);
      history = mc.history as Array<{ role: "user" | "assistant"; content: string }>;
      Object.assign(memoryContext, mc.memoryContext);
      ltmHits = mc.ltmHits;
      await appendMessage(sessionId!, "user", trimmed);
    }

    // ── Classify intent ─────────────────────────────────────────────────────
    const classification = classifyIntent(trimmed, history);

    // ── Build tool input + KB notes ─────────────────────────────────────────
    const toolInput: ToolInput = {
      message: trimmed,
      history,
      memoryContext: memoryContext as ToolInput["memoryContext"],
      classification,
    };

    if (hasSid && !["casual", "identity"].includes(classification.intent)) {
      try {
        const hits = await searchNotes(sessionId!, trimmed, 3);
        if (hits.length > 0 && hits[0].score > 0.15) {
          toolInput.memoryContext!.kbNotes = hits.map((h) => ({
            id: h.note.id, title: h.note.title, content: h.note.content,
            type: h.note.type, tags: h.note.tags, url: h.note.url,
          }));
        }
      } catch { /* KB errors never block chat */ }
    }

    let fullResponse = "";
    let isSearch = false;
    let isFakeSearch = false;
    let sources: unknown[] = [];
    let sideEffects: { updatePreferences?: Record<string, string> } | undefined;
    let debugExtra = { action: "", mode: "", reasoning: [] as string[], toolCalls: [] as unknown[] };

    // ── Route: agent runner vs instant tools ────────────────────────────────
    if (AGENT_INTENTS.has(classification.intent)) {
      const ctx = { sessionId: hasSid ? sessionId! : undefined };
      const result = await runAgent(toolInput, ctx, send);
      fullResponse = result.fullResponse;
      debugExtra = {
        action: `agent_${classification.intent}`,
        mode: `${classification.intent}_agent`,
        reasoning: result.reasoning,
        toolCalls: result.toolCalls,
      };
    } else {
      // Existing instant tools for: casual, identity, memory_update, math, task_management, knowledge_base
      const output = await complete({ message: trimmed, history, memoryContext: memoryContext as Parameters<typeof complete>[0]["memoryContext"] });
      fullResponse = output.response;
      sources = output.sources ?? [];
      isSearch = output.isSearch ?? false;
      isFakeSearch = output.isFakeSearch ?? false;
      sideEffects = output.sideEffects;
      debugExtra = {
        action: output.debug.action ?? "",
        mode: output.debug.mode ?? "",
        reasoning: output.debug.reasoning ?? [],
        toolCalls: [],
      };
      send({ type: "token", text: output.response });
    }

    // ── Persist ─────────────────────────────────────────────────────────────
    if (hasSid) {
      await appendMessage(sessionId!, "assistant", fullResponse);
      if (sideEffects?.updatePreferences) await updatePreferences(sessionId!, sideEffects.updatePreferences);
      void runExtraction(sessionId!, trimmed);
    }

    // ── Done event ───────────────────────────────────────────────────────────
    send({
      type: "done",
      model: "claude-sonnet-4-6",
      isSearch,
      isFakeSearch,
      sources,
      debug: {
        intent: classification.intent,
        secondaryIntent: classification.secondaryIntent,
        confidence: classification.confidence,
        signals: classification.signals,
        action: debugExtra.action,
        mode: debugExtra.mode,
        memoryUsed: !!(memoryContext.summary || memoryContext.preferences),
        ltmHits,
        toolCalls: debugExtra.toolCalls,
        reasoning: debugExtra.reasoning,
        processingMs: Date.now() - startTime,
      },
    });
  } catch (err) {
    logger.error({ err, message: trimmed }, "Stream chat error");
    send({ type: "error", message: "Failed to generate response" });
  }

  res.end();
});

export default router;
