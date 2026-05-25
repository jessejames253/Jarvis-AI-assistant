/**
 * routes/search.ts — Web search endpoint
 *
 * POST /api/search
 *
 * Accepts a search query and returns relevant web results plus a summary.
 * Automatically switches between two modes depending on whether an API key exists:
 *
 *  LIVE MODE  — when the SEARCH_API_KEY secret is set
 *               Calls the Brave Search API and returns real web results.
 *               Get a free key at: https://brave.com/search/api/
 *
 *  DEMO MODE  — when no SEARCH_API_KEY is set
 *               Returns clearly-labeled fake results so the UI still works
 *               and developers can build without needing a key right away.
 *
 * Request body:
 *   { query: string }
 *
 * Response:
 *   {
 *     query: string          — the original search query
 *     results: Source[]      — list of web results (title, url, description)
 *     answer: string         — a summary message for the chat UI
 *     isFake: boolean        — true when running in demo mode
 *   }
 */

import { Router } from "express";
import { logger } from "../lib/logger";

const router = Router();

// Shape of a single search result
interface SearchResult {
  title: string;
  url: string;
  description: string;
}

interface SearchResponse {
  query: string;
  results: SearchResult[];
  answer: string;
  isFake: boolean;
}

// Placeholder results used in demo mode (no API key set)
const FAKE_RESULTS: Record<string, SearchResult[]> = {
  default: [
    {
      title: "Quantum Neural Networks: The Next Frontier",
      url: "https://example.com/quantum-neural-networks",
      description:
        "Recent breakthroughs in quantum computing have enabled neural networks that process information 10,000x faster than classical architectures.",
    },
    {
      title: "AI Trends Report 2025 — Global Intelligence Index",
      url: "https://example.com/ai-trends-2025",
      description:
        "Comprehensive analysis of the current AI landscape, covering generative models, autonomous systems, and emerging research directions.",
    },
    {
      title: "Web Search Integration in Modern AI Assistants",
      url: "https://example.com/ai-web-search",
      description:
        "How leading AI assistants are combining retrieval-augmented generation with real-time web data to deliver more accurate, up-to-date responses.",
    },
  ],
};

// The message shown in the chat bubble when running in demo mode
function buildFakeAnswer(query: string): string {
  return (
    `[DEMO MODE — Add a real SEARCH_API_KEY to get live results]\n\n` +
    `Scanning data streams for: "${query}". ` +
    `My quantum retrieval matrix has located 3 relevant signal nodes. ` +
    `The synthesized intelligence below represents the highest-confidence data patterns identified.`
  );
}

// Calls the Brave Search REST API and returns formatted results.
// Docs: https://api.search.brave.com/app/documentation/web-search/get-started
async function braveSearch(query: string, apiKey: string): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey, // API key stays on the server — never sent to the browser
    },
  });

  if (!response.ok) {
    throw new Error(`Brave Search API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    web?: { results?: Array<{ title: string; url: string; description?: string }> };
  };

  // Normalise the API response into our SearchResult shape
  return (data.web?.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    description: r.description ?? "",
  }));
}

router.post("/search", async (req, res) => {
  const { query } = req.body as { query?: string };

  // Validate input
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    res.status(400).json({ error: "Missing or invalid query" });
    return;
  }

  const trimmedQuery = query.trim();

  // Check whether the API key has been configured
  const apiKey = process.env.SEARCH_API_KEY;

  // No key → demo mode
  if (!apiKey) {
    logger.info({ query: trimmedQuery }, "Search in demo mode (no SEARCH_API_KEY)");
    const response: SearchResponse = {
      query: trimmedQuery,
      results: FAKE_RESULTS.default,
      answer: buildFakeAnswer(trimmedQuery),
      isFake: true,
    };
    res.json(response);
    return;
  }

  // Key present → live mode
  try {
    logger.info({ query: trimmedQuery }, "Executing live Brave search");
    const results = await braveSearch(trimmedQuery, apiKey);
    const topResults = results.slice(0, 4); // Show at most 4 sources in the chat UI

    const answer =
      topResults.length > 0
        ? `Search complete. Found ${topResults.length} sources for: "${trimmedQuery}". Sources listed below.`
        : `Search complete for: "${trimmedQuery}". No strong results found — try rephrasing your query.`;

    const response: SearchResponse = {
      query: trimmedQuery,
      results: topResults,
      answer,
      isFake: false,
    };
    res.json(response);
  } catch (err) {
    logger.error({ err, query: trimmedQuery }, "Search API error");
    res.status(502).json({ error: "Search service temporarily unavailable" });
  }
});

export default router;
