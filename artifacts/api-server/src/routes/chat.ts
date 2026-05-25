/**
 * routes/chat.ts — Conversation endpoint
 *
 * POST /api/chat
 *
 * Accepts a user message (and optionally the conversation history so far)
 * and returns an intelligent response from Jarvas.
 *
 * Request body:
 *   {
 *     message: string           — the user's latest message
 *     history: HistoryEntry[]   — previous messages in this conversation (optional)
 *   }
 *
 * Response:
 *   {
 *     response: string   — Jarvas's reply
 *     model: string      — which model/engine produced the response
 *   }
 *
 * The actual response generation is handled by lib/responder.ts.
 * This route just validates input and calls complete() — keeping the
 * HTTP layer separate from the AI logic.
 *
 * To connect a real AI model (OpenAI, Anthropic, etc.), you only need
 * to update lib/responder.ts — this file stays exactly the same.
 */

import { Router } from "express";
import { complete, type HistoryEntry } from "../lib/responder";
import { logger } from "../lib/logger";

const router = Router();

router.post("/chat", async (req, res) => {
  // Pull the message and conversation history out of the request body.
  // history defaults to an empty array if not provided.
  const { message, history = [] } = req.body as {
    message?: string;
    history?: HistoryEntry[];
  };

  // Validate: message must be a non-empty string
  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "Missing or invalid message" });
    return;
  }

  try {
    // complete() is the single function that generates Jarvas's response.
    // It lives in lib/responder.ts and is designed to be swapped for a real AI SDK.
    const output = await complete({
      message: message.trim(),
      history: Array.isArray(history) ? history : [],
    });

    res.json(output);
  } catch (err) {
    logger.error({ err }, "Chat completion error");
    res.status(500).json({ error: "Failed to generate response" });
  }
});

export default router;
