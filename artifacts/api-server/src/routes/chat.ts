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
 *     response:   string       — Jarvas's reply
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

export default router;
