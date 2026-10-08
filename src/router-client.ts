import { parseSse } from "./sse.js";
import type { GenerationKind, GenerationResult, ModelTestResult, PublicModel, RouterCompletionRequest, RouterEvent } from "./types.js";
import { MaintenanceModeError } from "./user-errors.js";
import { connectWithRetry } from "./connection-retry.js";
import type { WebSearchResult } from "./types.js";

type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const validKinds = new Set<string>(["text", "image", "video"]);

export class RouterClient {
  constructor(
    private readonly serverUrl: string,
    private readonly pluginToken: string,
    private readonly fetchRequest: FetchFunction = fetch,
  ) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.pluginToken}` };
  }

  async search(query: string, limit = 5, signal?: AbortSignal): Promise<WebSearchResult> {
    const timeout = AbortSignal.timeout(60_000);
    const response = await this.fetchRequest(`${this.serverUrl}/api/plugin/search`, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
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
    const response = await this.fetchRequest(`${this.serverUrl}/api/plugin/models`, { headers: this.headers(), signal });
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
    const response = await this.fetchRequest(`${this.serverUrl}/api/plugin/generate`, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
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
    const response = await this.fetchRequest(`${this.serverUrl}/api/plugin/test`, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
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
    const response = await connectWithRetry(() => this.fetchRequest(`${this.serverUrl}/api/plugin/chat/completions`, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(request),
      signal,
    }), signal);
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
      throw new Error(`PrimeAI completion request failed: ${response.status} ${errorBody}`);
    }
    if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) {
      throw new Error("PrimeAI server returned an invalid stream");
    }
    yield* parseSse(response.body);
  }
}
