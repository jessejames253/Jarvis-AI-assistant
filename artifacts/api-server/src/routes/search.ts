import { Router } from "express";
import { logger } from "../lib/logger";

const router = Router();

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

function buildFakeAnswer(query: string): string {
  return (
    `[DEMO MODE — Add a real SEARCH_API_KEY to get live results]\n\n` +
    `Scanning data streams for: "${query}". ` +
    `My quantum retrieval matrix has located 3 relevant signal nodes. ` +
    `The synthesized intelligence below represents the highest-confidence data patterns identified.`
  );
}

async function braveSearch(query: string, apiKey: string): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Brave Search API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    web?: { results?: Array<{ title: string; url: string; description?: string }> };
  };

  return (data.web?.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    description: r.description ?? "",
  }));
}

router.post("/search", async (req, res) => {
  const { query } = req.body as { query?: string };

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    res.status(400).json({ error: "Missing or invalid query" });
    return;
  }

  const trimmedQuery = query.trim();
  const apiKey = process.env.SEARCH_API_KEY;

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

  try {
    logger.info({ query: trimmedQuery }, "Executing live Brave search");
    const results = await braveSearch(trimmedQuery, apiKey);
    const topResults = results.slice(0, 4);

    const answer =
      topResults.length > 0
        ? `Neural search complete. Located ${topResults.length} high-confidence data sources for: "${trimmedQuery}". ` +
          `Synthesized from live internet signals — sources listed below.`
        : `Search sweep complete for: "${trimmedQuery}". No strong signal nodes detected. Try refining your query.`;

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
