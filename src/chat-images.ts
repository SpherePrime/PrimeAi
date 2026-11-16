import type { RouterContentPart } from "./types.js";

// Astra's plugin protocol (PluginAiMessage) carries only string content, so images
// attached in chat never reach an ai_provider plugin. The daemon still publishes
// them on its chat firehose (UserMessageEvt.images); this cache keeps them so a
// completion can re-attach them to the matching user message.

export interface CapturedUserMessage {
  conversationId: string;
  messageId: string;
  content: string;
  imageUrls: string[];
  receivedAt: number;
}

export interface ImageAttachmentLike {
  mimeType?: string;
  mime_type?: string;
  data?: Uint8Array | string;
}

type BridgeMessage = { role: string; content: unknown };

const maxImageMessages = 40;
const maxImageBytes = 64 * 1024 * 1024;
const maxTextMessages = 50;
const fallbackWaitRecencyMs = 60_000;
const fallbackAttachRecencyMs = 30 * 60_000;

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function imageDataUrl(image: ImageAttachmentLike): string {
  const data = image.data;
  if (!data || data.length === 0) return "";
  if (typeof data === "string" && data.startsWith("data:")) return data;
  const base64 = typeof data === "string" ? data : Buffer.from(data).toString("base64");
  const rawMime = image.mimeType || image.mime_type;
  const mime = typeof rawMime === "string" && rawMime.startsWith("image/") ? rawMime : "image/png";
  return `data:${mime};base64,${base64}`;
}

export class ChatImageCache {
  private imageMessages: CapturedUserMessage[] = [];
  private textMessages: Array<{ conversationId: string; content: string; receivedAt: number }> = [];
  private waiters = new Set<() => void>();

  constructor(private readonly now: () => number = Date.now) {}

  record(conversationId: string, messageId: string, content: string, images: ImageAttachmentLike[]): void {
    if (!conversationId.trim() || !messageId.trim()) return;
    const receivedAt = this.now();
    const imageUrls = images.map(imageDataUrl).filter((url) => url.length > 0);
    this.textMessages.push({ conversationId, content: normalize(content), receivedAt });
    if (this.textMessages.length > maxTextMessages) this.textMessages.shift();
    if (imageUrls.length > 0) {
      this.imageMessages = this.imageMessages.filter((entry) => entry.conversationId !== conversationId || entry.messageId !== messageId);
      this.imageMessages.push({ conversationId, messageId, content: normalize(content), imageUrls, receivedAt });
      this.trim();
    }
    for (const wake of this.waiters) wake();
  }

  private trim(): void {
    const size = () => this.imageMessages.reduce((sum, entry) => sum + entry.imageUrls.reduce((s, url) => s + url.length, 0), 0);
    while (this.imageMessages.length > maxImageMessages || (this.imageMessages.length > 1 && size() > maxImageBytes)) this.imageMessages.shift();
  }

  hasSeen(content: string, conversationId?: string): boolean {
    const wanted = normalize(content);
    const scopedId = conversationId?.trim();
    if (scopedId) {
      return this.textMessages.some((entry) => entry.conversationId === scopedId && entry.content === wanted);
    }
    const cutoff = this.now() - fallbackWaitRecencyMs;
    return this.textMessages.some((entry) => entry.receivedAt >= cutoff && entry.content === wanted);
  }

  async waitFor(content: string, timeoutMs: number, conversationId?: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted || this.hasSeen(content, conversationId)) return;
    await new Promise<void>((resolve) => {
      const done = () => { clearTimeout(timer); this.waiters.delete(check); signal?.removeEventListener("abort", done); resolve(); };
      const check = () => { if (this.hasSeen(content, conversationId)) done(); };
      const timer = setTimeout(done, timeoutMs);
      this.waiters.add(check);
      signal?.addEventListener("abort", done, { once: true });
    });
  }

  attach<T extends BridgeMessage>(messages: T[], conversationId?: string): T[] {
    if (this.imageMessages.length === 0) return messages;
    const scopedId = conversationId?.trim();
    const cutoff = this.now() - fallbackAttachRecencyMs;
    const used = new Set<CapturedUserMessage>();
    const result = [...messages];
    for (let index = result.length - 1; index >= 0; index -= 1) {
      const message = result[index];
      if (message.role !== "user" || typeof message.content !== "string") continue;
      const text = normalize(message.content);
      const entry = [...this.imageMessages].reverse().find((candidate) => {
        if (used.has(candidate) || candidate.content !== text) return false;
        if (scopedId) return candidate.conversationId === scopedId;
        return candidate.receivedAt >= cutoff;
      });
      if (!entry) continue;
      used.add(entry);
      result[index] = withImages(message, entry.imageUrls);
    }
    return result;
  }
}

function withImages<T extends BridgeMessage>(message: T, imageUrls: string[]): T {
  const text = typeof message.content === "string" ? message.content : "";
  const parts: RouterContentPart[] = [];
  if (text.trim()) parts.push({ type: "text", text });
  for (const url of imageUrls) parts.push({ type: "image_url", image_url: { url } });
  return { ...message, content: parts };
}
