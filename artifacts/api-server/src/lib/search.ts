/**
 * lib/search.ts — Web search logic
 *
 * Shared module used by both:
 *   routes/search.ts  — the explicit POST /api/search endpoint
 *   lib/tools/research.ts — the research tool (called when intent = "research")
 *
 * Switches between LIVE mode (Brave Search API) and DEMO mode (fake results)
 * based on whether SEARCH_API_KEY is set.
 */

import type { SearchResult, SearchResponse } from "./types";

/** Fake results used when no API key is configured */
const DEMO_RESULTS: SearchResult[] = [
  {
    title: "Quantum Neural Networks: The Next Frontier",
    url: "https://example.com/quantum-neural-networks",
    description:
      "Recent breakthroughs in quantum computing have enabled neural networks that process information at unprecedented speeds compared to classical architectures.",
  },
  {
    title: "AI Trends Report 2026 — Global Intelligence Index",
    url: "https://example.com/ai-trends-2026",
    description:
      "Comprehensive analysis of the current AI landscape, covering generative models, autonomous systems, and emerging research directions.",
  },
  {
    title: "Web Search Integration in Modern AI Assistants",
    url: "https://example.com/ai-web-search",
    description:
      "How leading AI assistants are combining retrieval-augmented generation with real-time web data to deliver more accurate, up-to-date responses.",
  },
];

/** Calls the Brave Search REST API and returns formatted results */
async function callBraveSearch(query: string, apiKey: string): Promise<SearchResult[]> {
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

/**
 * Main search function — automatically picks live or demo mode.
 * Callers don't need to know which mode is active.
 */
export async function performSearch(query: string): Promise<SearchResponse> {
  const apiKey = process.env.SEARCH_API_KEY;

  if (!apiKey) {
    return {
      query,
      results: DEMO_RESULTS,
      answer:
        `[DEMO MODE — add SEARCH_API_KEY for live results]\n\n` +
        `Scanning available data for: "${query}". ` +
        `Retrieved ${DEMO_RESULTS.length} relevant results.`,
      isFake: true,
    };
  }

  try {
    const results = await callBraveSearch(query, apiKey);
    const top = results.slice(0, 4);
    return {
      query,
      results: top,
      answer:
        top.length > 0
          ? `Search complete. Found ${top.length} sources for: "${query}".`
          : `Search complete for: "${query}". No strong results found — try rephrasing.`,
      isFake: false,
    };
  } catch (err) {
    throw err;
  }
}
