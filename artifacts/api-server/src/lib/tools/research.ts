import type { Tool, ToolInput, ToolOutput } from "../types";
import { performSearch } from "../search";

export const researchTool: Tool = {
  name: "research",
  description: "Searches the web for current information, news, and live data",
  handles: ["research"],
  async execute(input: ToolInput): Promise<ToolOutput> {
    const reasoning: string[] = [
      "Intent: web search / research",
      `Query: "${input.message.slice(0, 70)}"`,
      "Calling search API",
    ];

    try {
      const result = await performSearch(input.message);
      reasoning.push(
        result.isFake
          ? "Mode: DEMO (no SEARCH_API_KEY configured)"
          : `Mode: LIVE — retrieved ${result.results.length} results from Brave Search`
      );
      reasoning.push("Formatting results for chat display");

      return {
        response: result.answer,
        action: result.isFake ? "web_search_demo" : "web_search_live",
        mode: "research_agent",
        reasoning,
        sources: result.results,
        isSearch: true,
        isFakeSearch: result.isFake,
      };
    } catch {
      reasoning.push("Search API call failed — falling back to graceful error message");
      return {
        response: `I tried to search the web for "${input.message}" but the search service is currently unavailable. Try again shortly, or ask me a different way and I'll answer from what I know.`,
        action: "web_search_failed",
        mode: "research_agent",
        reasoning,
      };
    }
  },
};
