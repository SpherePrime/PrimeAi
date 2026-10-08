import { s, tool } from "astra-plugin-sdk";
import { webSearchDescription } from "./web-search.js";
import type { WebSearchResult } from "./types.js";

export function createWebSearchTool(search: (query: string, limit?: number) => Promise<WebSearchResult>) {
  return tool({
    description: webSearchDescription,
    input: s.object({
      query: s.string().describe("Specific web search query"),
      limit: s.integer().optional().describe("Number of results from 1 to 10, default 5"),
    }),
    run: async ({ query, limit }) => {
      try {
        const response = await search(query, limit);
        return { success: true, result: response.result };
      } catch (error) {
        return { success: false, result: "", error: error instanceof Error ? error.message : "Поиск временно недоступен" };
      }
    },
  });
}
