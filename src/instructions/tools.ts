import { s, tool } from "astra-plugin-sdk";
import { readInstructionDescription, searchInstructionsDescription } from "./definitions.js";
import type { InstructionPage, InstructionSearchResult } from "./types.js";

interface InstructionActions {
  search(query: string, limit?: number): Promise<InstructionSearchResult>;
  read(id: string, offset?: number, limit?: number): Promise<InstructionPage>;
}

async function toolResult(action: () => Promise<unknown>) {
  try {
    return { success: true, result: JSON.stringify(await action()) };
  } catch (error) {
    return { success: false, result: "", error: error instanceof Error ? error.message : "Инструкции временно недоступны" };
  }
}

export function createInstructionTools(actions: InstructionActions) {
  return {
    primeai_search_instructions: tool({
      description: searchInstructionsDescription,
      input: s.object({
        query: s.string().describe("Task keywords in English or Russian, up to 500 characters"),
        limit: s.integer().optional().describe("Maximum results from 1 to 12, default 6"),
      }),
      run: ({ query, limit }) => toolResult(() => actions.search(query, limit)),
    }),
    primeai_read_instruction: tool({
      description: readInstructionDescription,
      input: s.object({
        id: s.string().describe("Exact instruction ID returned by search"),
        offset: s.integer().optional().describe("Start at 0, then use nextOffset if needed"),
        limit: s.integer().optional().describe("Maximum characters from 1 to 16000, default 12000"),
      }),
      run: ({ id, offset, limit }) => toolResult(() => actions.read(id, offset, limit)),
    }),
  };
}
