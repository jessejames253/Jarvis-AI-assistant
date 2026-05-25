/**
 * lib/tools/research.ts — Web search + Claude synthesis
 *
 * When intent = "research":
 *   1. Run Brave Search (or demo fallback)
 *   2. Feed results to Claude to synthesize a direct, ranked answer
 *   3. Return the synthesized answer + source cards
 *
 * If no SEARCH_API_KEY is set, Claude answers from training knowledge
 * and notes that it cannot retrieve live data.
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { Tool, ToolInput, ToolOutput, SearchResult } from "../types";
import { performSearch } from "../search";

const RESEARCH_SYSTEM = `You are Jarvis, a direct and intelligent AI assistant. You have been given web search results for the user's query. Your job:

1. Synthesize a clear, accurate answer from the search results provided.
2. Lead with the most important finding — don't bury the answer.
3. If results conflict, note it briefly and cite which source is more authoritative.
4. Be concise. Don't pad the response with "Based on the search results I found..."
5. If the results don't fully answer the question, say what you know and what's uncertain.
6. Use markdown formatting where appropriate (lists, bold key facts).
7. Never invent facts not present in the results.`;

const FALLBACK_SYSTEM = `You are Jarvis, a direct and intelligent AI assistant. The user asked a question that may need current information, but no live search results are available. Answer from your training knowledge. Be honest if the information may be outdated (e.g. for rapidly changing facts like population, prices, or current events). Do not refuse to answer — give your best knowledge and note any uncertainty.`;

/**
 * Streaming variant — does web search (blocking) then streams Claude synthesis.
 * Used by the /api/chat/stream SSE endpoint.
 */
export async function streamResearchCompletion(
  input: ToolInput,
  onToken: (text: string) => void,
): Promise<{
  action: string; mode: string; reasoning: string[];
  sources?: SearchResult[]; isSearch: boolean; isFakeSearch?: boolean;
}> {
  const reasoning: string[] = [`intent: research`, `query: "${input.message.slice(0, 70)}"`];
  const apiKey = process.env.SEARCH_API_KEY;

  async function streamClaude(system: string, userMsg: string) {
    let inputTokens = 0, outputTokens = 0;
    const stream = await anthropic.messages.create({
      model: "claude-sonnet-4-6", max_tokens: 8192, system,
      messages: [{ role: "user", content: userMsg }],
      stream: true,
    });
    for await (const event of stream) {
      if (event.type === "message_start") inputTokens = event.message.usage.input_tokens;
      else if (event.type === "content_block_delta" && event.delta.type === "text_delta") onToken(event.delta.text);
      else if (event.type === "message_delta") outputTokens = event.usage.output_tokens;
    }
    return { inputTokens, outputTokens };
  }

  if (!apiKey) {
    reasoning.push("No SEARCH_API_KEY — streaming from training knowledge");
    try {
      const { inputTokens, outputTokens } = await streamClaude(FALLBACK_SYSTEM, input.message);
      reasoning.push(`streamed: ${inputTokens} in / ${outputTokens} out tokens`);
      return { action: "ai_knowledge_fallback", mode: "research_agent", reasoning, isSearch: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reasoning.push(`Claude error: ${msg}`);
      onToken("I'm having trouble reaching my reasoning engine right now. Please try again.");
      return { action: "research_error", mode: "research_agent", reasoning, isSearch: false };
    }
  }

  try {
    reasoning.push("Calling Brave Search API");
    const result = await performSearch(input.message);
    reasoning.push(`Retrieved ${result.results.length} results`);

    if (result.results.length === 0) {
      reasoning.push("No results — falling back to training knowledge");
      await streamClaude(FALLBACK_SYSTEM, input.message);
      return { action: "ai_knowledge_fallback", mode: "research_agent", reasoning, isSearch: false };
    }

    const searchContext = result.results
      .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.description}`)
      .join("\n\n");
    const userPrompt = `User question: ${input.message}\n\nSearch results:\n${searchContext}`;

    reasoning.push("Streaming Claude synthesis");
    const { inputTokens, outputTokens } = await streamClaude(RESEARCH_SYSTEM, userPrompt);
    reasoning.push(`Synthesis complete: ${inputTokens} in / ${outputTokens} out tokens`);

    return {
      action: "web_search_synthesized", mode: "research_agent", reasoning,
      sources: result.results, isSearch: true, isFakeSearch: false,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    reasoning.push(`Search/synthesis error: ${msg}`);
    try {
      await streamClaude(FALLBACK_SYSTEM, input.message);
      return { action: "ai_knowledge_fallback", mode: "research_agent", reasoning, isSearch: false };
    } catch {
      onToken("Search is temporarily unavailable. Please try again shortly.");
      return { action: "research_error", mode: "research_agent", reasoning, isSearch: false };
    }
  }
}

export const researchTool: Tool = {
  name: "research",
  description: "Searches the web and synthesizes results with Claude",
  handles: ["research"],
  async execute(input: ToolInput): Promise<ToolOutput> {
    const reasoning: string[] = [`intent: research`, `query: "${input.message.slice(0, 70)}"`];

    const apiKey = process.env.SEARCH_API_KEY;

    // ── No API key: Claude answers from training knowledge ────────────────────
    if (!apiKey) {
      reasoning.push("No SEARCH_API_KEY — answering from training knowledge");
      try {
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 8192,
          system: FALLBACK_SYSTEM,
          messages: [{ role: "user", content: input.message }],
        });
        const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
        reasoning.push(`Claude responded (no search): ${response.usage.output_tokens} tokens`);
        return {
          response: text,
          action: "ai_knowledge_fallback",
          mode: "research_agent",
          reasoning,
          isSearch: false,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        reasoning.push(`Claude error: ${msg}`);
        return {
          response: "I couldn't reach my reasoning engine. Please try again.",
          action: "research_error",
          mode: "research_agent",
          reasoning,
        };
      }
    }

    // ── Live search + Claude synthesis ───────────────────────────────────────
    try {
      reasoning.push("Calling Brave Search API");
      const result = await performSearch(input.message);
      reasoning.push(`Retrieved ${result.results.length} results`);

      if (result.results.length === 0) {
        // No results — fall back to Claude's training knowledge
        reasoning.push("No results — falling back to training knowledge");
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 8192,
          system: FALLBACK_SYSTEM,
          messages: [{ role: "user", content: input.message }],
        });
        const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
        return {
          response: text,
          action: "ai_knowledge_fallback",
          mode: "research_agent",
          reasoning,
          isSearch: false,
        };
      }

      // Build context block from search results
      const searchContext = result.results
        .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.description}`)
        .join("\n\n");

      const userPrompt = `User question: ${input.message}\n\nSearch results:\n${searchContext}`;

      reasoning.push("Passing results to Claude for synthesis");
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        system: RESEARCH_SYSTEM,
        messages: [{ role: "user", content: userPrompt }],
      });

      const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      reasoning.push(`Synthesis complete: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out tokens`);

      return {
        response: text,
        action: "web_search_synthesized",
        mode: "research_agent",
        reasoning,
        sources: result.results,
        isSearch: true,
        isFakeSearch: false,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reasoning.push(`Search/synthesis error: ${msg}`);

      // Last resort: try Claude from knowledge
      try {
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 8192,
          system: FALLBACK_SYSTEM,
          messages: [{ role: "user", content: input.message }],
        });
        const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
        return {
          response: text,
          action: "ai_knowledge_fallback",
          mode: "research_agent",
          reasoning,
          isSearch: false,
        };
      } catch {
        return {
          response: "Search is temporarily unavailable and I couldn't reach my fallback. Please try again shortly.",
          action: "research_error",
          mode: "research_agent",
          reasoning,
        };
      }
    }
  },
};
