/**
 * routes/search.ts — Explicit web search endpoint
 *
 * POST /api/search
 *
 * This endpoint exists for direct / external search calls.
 * When a message is sent through /api/chat, the backend classifies
 * intent and calls search automatically — the frontend no longer
 * needs to call this endpoint directly for chat messages.
 *
 * It's kept for:
 *   - Direct API consumers
 *   - Future search-specific features (image search, structured data)
 *   - Testing the search layer in isolation
 *
 * All search logic lives in lib/search.ts — this route just validates
 * input and delegates.
 */

import { Router } from "express";
import { performSearch } from "../lib/search";
import { logger } from "../lib/logger";

const router = Router();

router.post("/search", async (req, res) => {
  const { query } = req.body as { query?: string };

  if (!query || typeof query !== "string" || !query.trim()) {
    res.status(400).json({ error: "Missing or invalid query" });
    return;
  }

  try {
    const result = await performSearch(query.trim());
    res.json(result);
  } catch (err) {
    logger.error({ err, query }, "Search error");
    res.status(502).json({ error: "Search service temporarily unavailable" });
  }
});

export default router;
