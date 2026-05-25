/**
 * routes/chat.ts — Conversation endpoint
 *
 * POST /api/chat
 *
 * Accepts a user message and returns Jarvas's response.
 * When a sessionId is provided, this route:
 *   1. Loads conversation history from persistent memory (server-side)
 *   2. Saves the user message before generating the response
 *   3. Saves the assistant response after generating it
 *
 * Request body:
 *   {
 *     message:   string  — the user's latest message (required)
 *     sessionId: string  — UUID identifying the chat session (optional)
 *   }
 *
 * Response:
 *   {
 *     response: string  — Jarvas's reply
 *     model:    string  — which engine produced the response
 *   }
 *
 * If no sessionId is given, the route falls back to stateless mode:
 * history must be provided by the client and nothing is persisted.
 *
 * To plug in a real AI model, only lib/responder.ts needs to change.
 */

import { Router } from "express";
import { complete, type HistoryEntry } from "../lib/responder";
import { appendMessage, getOrCreateSession } from "../lib/memory";
import { logger } from "../lib/logger";

const router = Router();

router.post("/chat", async (req, res) => {
  const { message, sessionId, history: clientHistory = [] } = req.body as {
    message?: string;
    sessionId?: string;
    history?: HistoryEntry[];
  };

  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "Missing or invalid message" });
    return;
  }

  const trimmedMessage = message.trim();

  try {
    let history: HistoryEntry[] = Array.isArray(clientHistory) ? clientHistory : [];
    let memoryContext: { summary?: string; preferences?: Record<string, string> } = {};

    // ── Memory-backed mode (sessionId provided) ───────────────────────────────
    if (sessionId && /^[a-zA-Z0-9\-]{8,64}$/.test(sessionId)) {
      // 1. Load the session to get history and any auto-summary
      const session = await getOrCreateSession(sessionId);

      // Build history from stored messages for the AI
      history = session.messages.map((m) => ({ role: m.role, content: m.content }));

      // Pass the summary and preferences as context for real AI models
      if (session.summary) memoryContext.summary = session.summary;
      if (Object.keys(session.preferences).length > 0) {
        memoryContext.preferences = session.preferences as Record<string, string>;
      }

      // 2. Persist the user's message before generating a response
      await appendMessage(sessionId, "user", trimmedMessage);
    }

    // ── Generate response ──────────────────────────────────────────────────────
    const output = await complete({ message: trimmedMessage, history, memoryContext });

    // ── Persist the assistant response ────────────────────────────────────────
    if (sessionId && /^[a-zA-Z0-9\-]{8,64}$/.test(sessionId)) {
      await appendMessage(sessionId, "assistant", output.response);
    }

    res.json(output);
  } catch (err) {
    logger.error({ err }, "Chat completion error");
    res.status(500).json({ error: "Failed to generate response" });
  }
});

export default router;
