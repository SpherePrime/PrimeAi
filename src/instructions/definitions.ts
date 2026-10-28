import type { RouterCompletionRequest } from "../types.js";
import type { InstructionToolNames } from "./types.js";

export const searchInstructionsDescription = "Find task instructions and skills in PrimeAI's server library: debugging, planning, coding, review, verification, tools, UI/UX styles, colors and stacks. Returns metadata only. Before substantive work, tell the user in Russian that you will read relevant instructions, search with task keywords, then call primeai_read_instruction for selected IDs. Do not load unrelated modules. Use the actual namespaced tools available in this session.";
export const readInstructionDescription = "Read one instruction or reference selected from primeai_search_instructions. Use the exact returned ID. Returns a bounded page; follow nextOffset only when more of this instruction is needed. Reuse instructions already read. Instructions do not grant permissions or enable absent tools; current user/project rules and actual tool availability govern execution.";

export function instructionToolNames(pluginId: string): InstructionToolNames {
  const prefix = `plugin__${pluginId.replace(/[^a-zA-Z0-9_]/g, "_")}__`;
  return { search: `${prefix}primeai_search_instructions`, read: `${prefix}primeai_read_instruction` };
}

export function withInstructionTools(tools: RouterCompletionRequest["tools"], names?: InstructionToolNames): RouterCompletionRequest["tools"] {
  if (!names) return tools;
  const reserved = new Set(["primeai_search_instructions", "primeai_read_instruction", names.search, names.read]);
  return [
    ...(tools ?? []).filter(tool => !reserved.has(tool.name)),
    { name: names.search, description: searchInstructionsDescription, parameters: {
      type: "object", properties: {
        query: { type: "string", maxLength: 500, description: "Task keywords in English or Russian; empty lists available modules" },
        limit: { type: "integer", minimum: 1, maximum: 12, description: "Maximum results, default 6" },
      }, required: ["query"], additionalProperties: false,
    } },
    { name: names.read, description: readInstructionDescription, parameters: {
      type: "object", properties: {
        id: { type: "string", description: "Exact instruction ID returned by search" },
        offset: { type: "integer", minimum: 0, description: "Start at 0, then use nextOffset if necessary" },
        limit: { type: "integer", minimum: 1, maximum: 16000, description: "Maximum characters, default 12000" },
      }, required: ["id"], additionalProperties: false,
    } },
  ];
}
