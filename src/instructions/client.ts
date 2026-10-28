import type { InstructionEntry, InstructionPage, InstructionSearchResult } from "./types.js";

type RequestFunction = (url: string, options: RequestInit) => Promise<Response>;
const validId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Сервер вернул некорректные инструкции");
  return value as Record<string, unknown>;
}

function metadata(value: unknown): InstructionEntry {
  const item = record(value);
  for (const key of ["id", "title", "description", "category", "source"]) {
    if (typeof item[key] !== "string") throw new Error("Сервер вернул некорректный каталог инструкций");
  }
  if (!validId.test(item.id as string) || !Array.isArray(item.keywords) || !item.keywords.every(keyword => typeof keyword === "string")) {
    throw new Error("Сервер вернул некорректный каталог инструкций");
  }
  return { id: item.id as string, title: item.title as string, description: item.description as string, category: item.category as string, source: item.source as string, keywords: item.keywords as string[] };
}

export class InstructionClient {
  constructor(private readonly serverUrl: string, private readonly request: RequestFunction) {}

  private async get(path: string, parameters: Record<string, string>, externalSignal?: AbortSignal): Promise<Record<string, unknown>> {
    const timeout = AbortSignal.timeout(30_000);
    const signal = externalSignal ? AbortSignal.any([externalSignal, timeout]) : timeout;
    signal.throwIfAborted();
    const response = await this.request(`${this.serverUrl}${path}?${new URLSearchParams(parameters)}`, { method: "GET", signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = payload && typeof payload === "object" ? (payload as Record<string, unknown>).error : null;
      throw new Error(typeof error === "string" ? error : `Инструкции недоступны: HTTP ${response.status}`);
    }
    return record(payload);
  }

  async search(query: string, limit = 6, signal?: AbortSignal): Promise<InstructionSearchResult> {
    if (query.trim().length > 500 || !Number.isInteger(limit) || limit < 1 || limit > 12) throw new Error("Укажите запрос до 500 символов и от 1 до 12 результатов");
    const payload = await this.get("/api/instructions/search", { query: query.trim(), limit: String(limit) }, signal);
    if (typeof payload.query !== "string" || typeof payload.guidance !== "string" || !Array.isArray(payload.entries) || payload.entries.length > limit) {
      throw new Error("Сервер вернул некорректный каталог инструкций");
    }
    return { query: payload.query, entries: payload.entries.map(metadata), guidance: payload.guidance };
  }

  async read(id: string, offset = 0, limit = 12_000, signal?: AbortSignal): Promise<InstructionPage> {
    if (id.length > 160 || !validId.test(id) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 16_000) {
      throw new Error("Укажите ID из каталога, неотрицательное смещение и размер страницы от 1 до 16000 символов");
    }
    const payload = await this.get(`/api/instructions/${encodeURIComponent(id)}`, { offset: String(offset), limit: String(limit) }, signal);
    const { content, title, totalCharacters, nextOffset } = payload;
    if (payload.id !== id || payload.offset !== offset || typeof title !== "string" || typeof content !== "string" || content.length > limit
      || !Number.isSafeInteger(totalCharacters) || (totalCharacters as number) < offset + content.length
      || (nextOffset !== null && (!Number.isSafeInteger(nextOffset) || nextOffset !== offset + content.length || (nextOffset as number) >= (totalCharacters as number)))
      || (nextOffset === null && offset + content.length !== totalCharacters)) {
      throw new Error("Сервер вернул некорректную страницу инструкции");
    }
    return { id, title, content, offset, nextOffset: nextOffset as number | null, totalCharacters: totalCharacters as number };
  }
}
