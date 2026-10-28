import { parseSse } from "./sse.js";
import type { GenerationKind, GenerationResult, ModelTestResult, PublicModel, RouterCompletionRequest, RouterEvent } from "./types.js";
import { MaintenanceModeError } from "./user-errors.js";
import { isTransientConnectionError } from "./connection-retry.js";
import { CompletionError } from "./completion-error.js";
import type { WebSearchResult } from "./types.js";
import { SessionToken } from "./session-token.js";
import { InstructionClient } from "./instructions/client.js";

type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const validKinds = new Set<string>(["text", "image", "video"]);

export class RouterClient {
  private readonly sessionToken: SessionToken;
  private readonly instructions: InstructionClient;
  constructor(
    private readonly serverUrl: string,
    private readonly pluginToken: string,
    private readonly fetchRequest: FetchFunction = fetch,
  ) {
    this.sessionToken = new SessionToken(serverUrl, fetchRequest);
    this.instructions = new InstructionClient(serverUrl, fetchRequest);
  }

  searchInstructions(query: string, limit?: number, signal?: AbortSignal) {
    return this.instructions.search(query, limit, signal);
  }

  readInstruction(id: string, offset?: number, limit?: number, signal?: AbortSignal) {
    return this.instructions.read(id, offset, limit, signal);
  }

  private async request(url: string, options: RequestInit): Promise<Response> {
    const token = this.pluginToken || await this.sessionToken.get();
    if (options.signal?.aborted) throw options.signal.reason;
    const response = await this.fetchRequest(url, { ...options, headers: { ...options.headers, authorization: `Bearer ${token}` } });
    if (response.status !== 401 || this.pluginToken) return response;
    await response.body?.cancel();
    this.sessionToken.invalidate(token);
    const refreshedToken = await this.sessionToken.get();
    if (options.signal?.aborted) throw options.signal.reason;
    return this.fetchRequest(url, { ...options, headers: { ...options.headers, authorization: `Bearer ${refreshedToken}` } });
  }

  async search(query: string, limit = 5, signal?: AbortSignal): Promise<WebSearchResult> {
    const timeout = AbortSignal.timeout(60_000);
    const response = await this.request(`${this.serverUrl}/api/plugin/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, limit }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: unknown };
      throw new Error(typeof payload.error === "string" ? payload.error : "Поиск временно недоступен");
    }
    const payload = await response.json() as Partial<WebSearchResult>;
    if (payload.provider !== "duckduckgo" || typeof payload.query !== "string" || typeof payload.result !== "string" || !payload.result.trim()) {
      throw new Error("Сервер вернул некорректный результат поиска");
    }
    return payload as WebSearchResult;
  }

  async listModels(signal?: AbortSignal): Promise<PublicModel[]> {
    const response = await this.request(`${this.serverUrl}/api/plugin/models`, { signal });
    if (!response.ok) throw new Error(`PrimeAI models request failed: ${response.status}`);
    const payload = await response.json() as { models?: unknown };
    if (!Array.isArray(payload.models)) throw new Error("Invalid PrimeAI models response");
    return payload.models.filter((model): model is PublicModel => {
      if (!model || typeof model !== "object") return false;
      const value = model as Record<string, unknown>;
      return typeof value.id === "string" && typeof value.name === "string" && typeof value.routeCount === "number"
        && (typeof value.kind !== "string" || validKinds.has(value.kind));
    });
  }

  async generate(kind: GenerationKind, input: { prompt: string; model?: string; n?: number; size?: string; durationSeconds?: number; clientId?: string }, signal?: AbortSignal): Promise<GenerationResult> {
    const response = await this.request(`${this.serverUrl}/api/plugin/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, ...input }),
      signal,
    });
    if (!response.ok) {
      let errorBody = "";
      try { errorBody = await response.text(); } catch {}
      if (response.status === 429) {
        let parsed: { error?: string; code?: string; used?: number; limit?: number; windowHours?: number } = {};
        try { parsed = JSON.parse(errorBody); } catch {}
        const detail = parsed.error || `Лимит: ${parsed.used ?? "?"}/${parsed.limit ?? "?"} запросов за ${parsed.windowHours ?? "?"} ч`;
        throw new Error(`GENERATION_LIMIT_EXCEEDED: ${detail}`);
      }
      if (response.status === 503) {
        try {
          const payload = JSON.parse(errorBody) as { code?: unknown };
          if (payload.code === "MAINTENANCE_MODE") throw new MaintenanceModeError();
        } catch (error) {
          if (error instanceof MaintenanceModeError) throw error;
        }
      }
      throw new Error(`PrimeAI generation request failed: ${response.status} ${errorBody}`);
    }
    const payload = await response.json() as Partial<GenerationResult>;
    return {
      assets: Array.isArray(payload.assets) ? payload.assets : [],
      providerName: typeof payload.providerName === "string" ? payload.providerName : "",
      publicModelId: typeof payload.publicModelId === "string" ? payload.publicModelId : "",
      upstreamModelId: typeof payload.upstreamModelId === "string" ? payload.upstreamModelId : "",
      substituted: payload.substituted === true,
      limitRemaining: typeof payload.limitRemaining === "number" ? payload.limitRemaining : undefined,
    };
  }

  async testModel(modelId: string, signal?: AbortSignal): Promise<ModelTestResult> {
    const response = await this.request(`${this.serverUrl}/api/plugin/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: modelId }),
      signal,
    });
    if (!response.ok) {
      let errorBody = "";
      try { errorBody = await response.text(); } catch {}
      if (response.status === 503) {
        try {
          const payload = JSON.parse(errorBody) as { code?: unknown };
          if (payload.code === "MAINTENANCE_MODE") throw new MaintenanceModeError();
        } catch (error) {
          if (error instanceof MaintenanceModeError) throw error;
        }
      }
      throw new Error(`PrimeAI test request failed: ${response.status} ${errorBody}`);
    }
    const payload = await response.json() as Partial<ModelTestResult>;
    return {
      ok: payload.ok === true,
      latencyMs: typeof payload.latencyMs === "number" ? payload.latencyMs : 0,
      modelId: typeof payload.modelId === "string" ? payload.modelId : modelId,
      error: typeof payload.error === "string" ? payload.error : undefined,
    };
  }

  async *complete(request: RouterCompletionRequest, signal?: AbortSignal): AsyncIterable<RouterEvent> {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      let emitted = false;
      try {
        for await (const event of this.completeAttempt(request, signal)) {
          if (event.type === "text" || event.type === "thinking" || event.type === "tool_call") emitted = true;
          yield event;
        }
        return;
      } catch (error) {
        if (signal?.aborted || emitted || attempt >= 2 || !(isTransientConnectionError(error) || error instanceof CompletionError && error.retryable)) throw error;
      }
    }
  }

  private async *completeAttempt(request: RouterCompletionRequest, signal?: AbortSignal): AsyncIterable<RouterEvent> {
    const response = await this.request(`${this.serverUrl}/api/plugin/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(request),
      signal,
    });
    if (!response.ok) {
      let errorBody = "";
      try { errorBody = await response.text(); } catch {}
      if (response.status === 503) {
        try {
          const payload = JSON.parse(errorBody) as { code?: unknown };
          if (payload.code === "MAINTENANCE_MODE") throw new MaintenanceModeError();
        } catch (error) {
          if (error instanceof MaintenanceModeError) throw error;
        }
      }
      throw new CompletionError("HTTP_ERROR", [500, 502, 503, 504].includes(response.status), errorBody, response.status);
    }
    if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) {
      await response.body?.cancel();
      throw new CompletionError("INVALID_RESPONSE", false);
    }
    for await (const event of parseSse(response.body)) {
      if (event.type === "error") throw new CompletionError(event.code, event.retryable, event.detail);
      yield event;
      if (event.type === "done") return;
    }
    throw new CompletionError("STREAM_INTERRUPTED", true);
  }
}
