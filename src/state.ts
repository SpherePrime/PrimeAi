import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface PluginState {
  selectedModelId: string;
  imageModelId: string;
  videoModelId: string;
  strictModel: boolean;
  conciseResponses: boolean;
}

export interface PluginStateUpdate {
  selectedModelId?: string;
  imageModelId?: string;
  videoModelId?: string;
  strictModel?: boolean;
  conciseResponses?: boolean;
}

export class PluginStateStore {
  private pendingWrite: Promise<void> = Promise.resolve();
  constructor(private readonly path: string) {}

  private static readString(value: unknown): string {
    return typeof value === "string" ? value : "";
  }

  async load(): Promise<PluginState> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as Record<string, unknown>;
      return {
        selectedModelId: PluginStateStore.readString(parsed.selectedModelId),
        imageModelId: PluginStateStore.readString(parsed.imageModelId),
        videoModelId: PluginStateStore.readString(parsed.videoModelId),
        strictModel: parsed.strictModel === true,
        conciseResponses: parsed.conciseResponses !== false,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { selectedModelId: "", imageModelId: "", videoModelId: "", strictModel: false, conciseResponses: true };
      throw new Error("PrimeAI state is invalid");
    }
  }

  private persist(update: PluginStateUpdate): Promise<PluginState> {
    const result = this.pendingWrite.then(() => this.persistUpdate(update));
    this.pendingWrite = result.then(() => undefined, () => undefined);
    return result;
  }

  private async persistUpdate(update: PluginStateUpdate): Promise<PluginState> {
    const current = await this.load();
    const next: PluginState = {
      selectedModelId: update.selectedModelId ?? current.selectedModelId,
      imageModelId: update.imageModelId ?? current.imageModelId,
      videoModelId: update.videoModelId ?? current.videoModelId,
      strictModel: update.strictModel ?? current.strictModel,
      conciseResponses: update.conciseResponses ?? current.conciseResponses,
    };
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await writeFile(temporaryPath, JSON.stringify(next), { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.path);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
    return next;
  }

  async selectModel(selectedModelId: string): Promise<PluginState> {
    if (!selectedModelId.trim()) throw new Error("Model id is required");
    return this.persist({ selectedModelId });
  }

  async selectImageModel(imageModelId: string): Promise<PluginState> {
    return this.persist({ imageModelId });
  }

  async selectVideoModel(videoModelId: string): Promise<PluginState> {
    return this.persist({ videoModelId });
  }

  async setStrictModel(strictModel: boolean): Promise<PluginState> {
    return this.persist({ strictModel });
  }

  async setConciseResponses(conciseResponses: boolean): Promise<PluginState> {
    return this.persist({ conciseResponses });
  }
}
