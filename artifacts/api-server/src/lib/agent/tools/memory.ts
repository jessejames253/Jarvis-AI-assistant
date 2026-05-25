/**
 * agent/tools/memory.ts — Long-term memory lookup tool
 */

import { getLTM, rankEntries } from "../../ltm/store";
import type { LTMEntry } from "../../ltm/store";

export interface MemoryLookupResult {
  query: string;
  facts: Array<{ category: string; content: string; tags: string[] }>;
  total: number;
}

export async function lookupMemory(
  sessionId: string,
  query: string,
): Promise<MemoryLookupResult> {
  const store = await getLTM(sessionId);
  if (store.entries.length === 0) {
    return { query, facts: [], total: 0 };
  }

  const ranked: LTMEntry[] = rankEntries(store.entries, query, 6);
  return {
    query,
    facts: ranked.map((e) => ({
      category: e.category,
      content: e.content,
      tags: e.tags,
    })),
    total: store.entries.length,
  };
}
