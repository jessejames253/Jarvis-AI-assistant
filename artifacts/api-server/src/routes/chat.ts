import { Router } from "express";
import { complete, type HistoryEntry } from "../lib/responder";
import { logger } from "../lib/logger";

const router = Router();

router.post("/chat", async (req, res) => {
  const { message, history = [] } = req.body as {
    message?: string;
    history?: HistoryEntry[];
  };

  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "Missing or invalid message" });
    return;
  }

  try {
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
