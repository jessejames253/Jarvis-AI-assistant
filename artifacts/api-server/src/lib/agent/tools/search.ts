/**
 * agent/tools/search.ts — Web search tool wrapping the existing Brave search module
 */

import { performSearch } from "../../search";
import type { SearchResult } from "../../types";

export interface SearchToolResult {
  query: string;
  results: SearchResult[];
  isFake: boolean;
}

export async function searchWeb(query: string): Promise<SearchToolResult> {
  const resp = await performSearch(query);
  return {
    query: resp.query,
    results: resp.results,
    isFake: resp.isFake,
  };
}
