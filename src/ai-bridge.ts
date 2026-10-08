import type { AiChunk, AiCompleteRequest, AiMessage } from "astra-plugin-sdk";
import { normalizeMessageContent } from "./message-content.js";
import { ReasoningStreamParser, type ReasoningStreamPart } from "./reasoning-stream.js";
import { withWebSearch } from "./web-search.js";
import type { RouterCompletionRequest, RouterEvent, RouterMessage } from "./types.js";

export type BridgeCompletionRequest = Omit<AiCompleteRequest, "messages"> & {
  messages: Array<Omit<AiMessage, "content"> & { content: RouterMessage["content"] }>;
};

export interface AiBridgeDependencies {
  selectedModel(): Promise<string>;
  strictModel(): Promise<boolean>;
  complete(request: RouterCompletionRequest, signal?: AbortSignal): AsyncIterable<RouterEvent>;
  onRoute(event: Extract<RouterEvent, { type: "route" }>): void;
  signal?: AbortSignal;
  webSearchToolName?: string;
}

function tools(request: BridgeCompletionRequest): RouterCompletionRequest["tools"] | undefined {
  if (!request.tools || request.tools.length === 0) return undefined;
  return request.tools.map((tool) => {
    let parameters: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(tool.parametersJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        parameters = parsed as Record<string, unknown>;
      }
    } catch {
      parameters = {};
    }
    return { name: tool.name, description: tool.description, parameters };
  });
}

function reasoningEnabled(request: BridgeCompletionRequest): boolean {
  if (request.showReasoning) return true;
  return !["", "auto", "off", "none"].includes(request.reasoningEffort.trim().toLowerCase());
}

function reasoningChunk(part: ReasoningStreamPart): AiChunk {
  return part.type === "thinking" ? { thinking: part.delta } : { text: part.delta };
}

export async function* completeForAstra(request: BridgeCompletionRequest, dependencies: AiBridgeDependencies): AsyncIterable<AiChunk | string> {
  const selectedModel = await dependencies.selectedModel();
  if (!selectedModel) throw new Error("Выберите модель на странице плагина PrimeAI");
  const strict = await dependencies.strictModel();
  const showReasoning = reasoningEnabled(request);
  const reasoningParser = showReasoning ? new ReasoningStreamParser() : null;
  const payload: RouterCompletionRequest = {
    model: selectedModel,
    messages: request.messages.map((msg) => ({
      role: msg.role,
      content: normalizeMessageContent(msg.content),
      toolCallId: msg.toolCallId || undefined,
      toolCalls: msg.toolCalls?.map((tc) => ({
        id: tc.id,
        name: tc.name,
        argumentsJson: tc.argumentsJson,
      })) || undefined,
    })),
    tools: withWebSearch(tools(request), dependencies.webSearchToolName),
    systemPrompt: request.systemPrompt ?? undefined,
    temperature: request.temperature ?? undefined,
    maxTokens: request.maxTokens ?? undefined,
    reasoningEffort: request.reasoningEffort ?? undefined,
    showReasoning,
    strictModel: strict,
  };
  for await (const event of dependencies.complete(payload, dependencies.signal)) {
    if (event.type === "route") dependencies.onRoute(event);
    if (event.type === "text") {
      if (!reasoningParser) yield { text: event.delta };
      else for (const part of reasoningParser.push(event.delta)) yield reasoningChunk(part);
    }
    if (event.type === "thinking" && showReasoning) yield { thinking: event.delta };
    if (event.type === "tool_call") {
      const call = event.call.name === "web_search" && dependencies.webSearchToolName
        ? { ...event.call, name: dependencies.webSearchToolName }
        : event.call;
      yield { toolCall: call };
    }
    if (event.type === "done") {
      if (reasoningParser) {
        for (const part of reasoningParser.finish()) yield reasoningChunk(part);
      }
      return;
    }
    if (event.type === "error") throw new Error(`PrimeAI: ${event.code}${event.detail ? ` (${event.detail})` : ""}`);
  }
  throw new Error("PrimeAI stream ended unexpectedly");
}
