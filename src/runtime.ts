import { join } from "node:path";
import type { AiChunk, AiCompleteRequest } from "astra-plugin-sdk";
import { completeForAstra } from "./ai-bridge.js";
import { addAutomaticModel, automaticModelId } from "./automatic-model.js";
import { getHardwareId } from "./hardware-id.js";
import { getInstanceId } from "./instance-id.js";
import { loadDeployment } from "./deployment.js";
import { RouterClient } from "./router-client.js";
import { PluginStateStore } from "./state.js";
import type { GenerationKind, GenerationResult, PublicModel, RouterEvent } from "./types.js";
import { toUserFacingError } from "./user-errors.js";

export interface RuntimePublicState {
  selectedModelId: string;
  imageModelId: string;
  videoModelId: string;
  strictModel: boolean;
  automaticModelId: string;
  models: Array<Pick<PublicModel, "id" | "name" | "supportsVision">>;
  imageModels: Array<Pick<PublicModel, "id" | "name">>;
  videoModels: Array<Pick<PublicModel, "id" | "name">>;
  connected: boolean;
  lastRoute: Extract<RouterEvent, { type: "route" }> | null;
  lastPing: RuntimePingResult | null;
  lastError: string;
}

export interface RuntimePingResult {
  ok: boolean;
  latencyMs: number;
  modelId: string;
}

const modelSyncIntervalMs = 300_000;
const pingTimeoutMs = 10_000;

export class PrimeAiRuntime {
  private readonly client: RouterClient;
  private readonly state: PluginStateStore;
  private readonly pluginDirectory: string;
  private readonly activeRequests = new Set<AbortController>();
  private models: PublicModel[] = [];
  private lastRoute: Extract<RouterEvent, { type: "route" }> | null = null;
  private lastPing: RuntimePingResult | null = null;
  private lastError = "";
  private modelSyncTimer: NodeJS.Timeout | undefined;
  private modelSyncRunning = false;


  constructor(pluginDirectory: string) {
    this.pluginDirectory = pluginDirectory;
    const deployment = loadDeployment(pluginDirectory);
    this.client = new RouterClient(deployment.serverUrl, deployment.pluginToken);
    this.state = new PluginStateStore(join(pluginDirectory, "primeai-state.json"));
  }

  async *complete(request: AiCompleteRequest): AsyncIterable<AiChunk | string> {
    const controller = new AbortController();
    this.activeRequests.add(controller);
    try {
      yield* completeForAstra(request, {
        selectedModel: async () => (await this.state.load()).selectedModelId,
        strictModel: async () => (await this.state.load()).strictModel,
        complete: (payload, signal) => this.client.complete(payload, signal),
        onRoute: (route) => { this.lastRoute = route; },
        signal: controller.signal,
      });
      this.lastError = "";
    } catch (error) {
      const userError = toUserFacingError(error);
      this.lastError = userError.message;
      throw userError;
    } finally {
      this.activeRequests.delete(controller);
    }
  }

  async generate(kind: GenerationKind, input: { prompt: string; n?: number; size?: string; durationSeconds?: number }): Promise<GenerationResult> {
    const state = await this.state.load();
    const controller = new AbortController();
    this.activeRequests.add(controller);
    try {
      const model = kind === "image" ? state.imageModelId : state.videoModelId;
      const result = await this.client.generate(kind, {
        prompt: input.prompt,
        n: input.n,
        size: input.size,
        durationSeconds: input.durationSeconds,
        model: model.trim() ? model : undefined,
        clientId: getHardwareId(getInstanceId(this.pluginDirectory)),
      }, controller.signal);
      if (result.assets.length === 0) throw new Error("Сервер не вернул результат генерации");
      this.lastRoute = { type: "route", providerName: result.providerName, modelId: result.publicModelId, substituted: result.substituted };
      this.lastError = "";
      return result;
    } catch (error) {
      const userError = toUserFacingError(error);
      this.lastError = userError.message;
      throw userError;
    } finally {
      this.activeRequests.delete(controller);
    }
  }

  async refreshModels(): Promise<RuntimePublicState> {
    this.models = addAutomaticModel(await this.client.listModels());
    const state = await this.state.load();
    const textModels = this.models.filter((model) => model.kind === undefined || model.kind === "text");
    const imageModels = this.models.filter((model) => model.kind === "image");
    const videoModels = this.models.filter((model) => model.kind === "video");
    if (textModels.length > 0 && !textModels.some((model) => model.id === state.selectedModelId)) {
      await this.state.selectModel(automaticModelId);
    }
    if (imageModels.length > 0 && state.imageModelId.trim() && !imageModels.some((model) => model.id === state.imageModelId)) {
      await this.state.selectImageModel("");
    }
    if (videoModels.length > 0 && state.videoModelId.trim() && !videoModels.some((model) => model.id === state.videoModelId)) {
      await this.state.selectVideoModel("");
    }
    this.lastError = "";
    return this.publicState();
  }

  startModelSync(): void {
    if (this.modelSyncTimer) return;
    this.synchronizeModels();
    this.modelSyncTimer = setInterval(() => this.synchronizeModels(), modelSyncIntervalMs);
    this.modelSyncTimer.unref();
  }

  async selectModel(modelId: string): Promise<RuntimePublicState> {
    if (this.models.length === 0) await this.refreshModels();
    if (!this.models.some((model) => model.id === modelId)) throw new Error("Модель недоступна");
    await this.state.selectModel(modelId);
    return this.publicState();
  }

  async selectImageModel(modelId: string): Promise<RuntimePublicState> {
    if (this.models.length === 0) await this.refreshModels();
    if (modelId && !this.models.some((model) => model.kind === "image" && model.id === modelId)) throw new Error("Модель недоступна");
    await this.state.selectImageModel(modelId);
    return this.publicState();
  }

  async selectVideoModel(modelId: string): Promise<RuntimePublicState> {
    if (this.models.length === 0) await this.refreshModels();
    if (modelId && !this.models.some((model) => model.kind === "video" && model.id === modelId)) throw new Error("Модель недоступна");
    await this.state.selectVideoModel(modelId);
    return this.publicState();
  }

  async setStrictMode(enabled: boolean): Promise<RuntimePublicState> {
    await this.state.setStrictModel(enabled);
    return this.publicState();
  }

  async testConnection(): Promise<RuntimePublicState> {
    const startedAt = Date.now();
    try {
      await this.refreshModels();
      this.lastPing = { ok: true, latencyMs: Date.now() - startedAt, modelId: "" };
      this.lastError = "";
    } catch (error) {
      this.lastPing = { ok: false, latencyMs: 0, modelId: "" };
      this.lastError = "";
    }
    return this.publicState();
  }

  async pingModel(modelId: string): Promise<RuntimePublicState> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), pingTimeoutMs);
    try {
      const result = await this.client.testModel(modelId, controller.signal);
      this.lastPing = { ok: result.ok, latencyMs: result.latencyMs, modelId };
      this.lastError = "";
    } catch (error) {
      this.lastPing = { ok: false, latencyMs: 0, modelId };
      this.lastError = error instanceof Error ? error.message : "Сервер недоступен";
    } finally {
      clearTimeout(timer);
    }
    return this.publicState();
  }

  async publicState(): Promise<RuntimePublicState> {
    const selected = await this.state.load();
    return {
      selectedModelId: selected.selectedModelId,
      imageModelId: selected.imageModelId,
      videoModelId: selected.videoModelId,
      strictModel: selected.strictModel,
      automaticModelId,
      models: this.models.filter((model) => model.kind === undefined || model.kind === "text").map(({ id, name, supportsVision }) => ({ id, name, supportsVision: supportsVision === true })),
      imageModels: this.models.filter((model) => model.kind === "image").map(({ id, name }) => ({ id, name })),
      videoModels: this.models.filter((model) => model.kind === "video").map(({ id, name }) => ({ id, name })),
      connected: this.models.length > 0 && !this.lastError,
      lastRoute: this.lastRoute,
      lastPing: this.lastPing,
      lastError: this.lastError,
    };
  }

  shutdown(): void {
    if (this.modelSyncTimer) clearInterval(this.modelSyncTimer);
    this.modelSyncTimer = undefined;
    for (const controller of this.activeRequests) controller.abort();
    this.activeRequests.clear();
  }

  private synchronizeModels(): void {
    if (this.modelSyncRunning) return;
    this.modelSyncRunning = true;
    void this.refreshModels()
      .catch((error) => {
        this.lastError = error instanceof Error ? error.message : "Сервер недоступен";
      })
      .finally(() => {
        this.modelSyncRunning = false;
      });
  }
}
