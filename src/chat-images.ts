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
const imageOnlyFallbackMs = 2 * 60_000;

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
  private textMessages: Array<{ content: string; receivedAt: number }> = [];
  private waiters = new Set<() => void>();

  constructor(private readonly now: () => number = Date.now) {}

  record(conversationId: string, messageId: string, content: string, images: ImageAttachmentLike[]): void {
    const receivedAt = this.now();
    const imageUrls = images.map(imageDataUrl).filter((url) => url.length > 0);
    this.textMessages.push({ content: normalize(content), receivedAt });
    if (this.textMessages.length > maxTextMessages) this.textMessages.shift();
    if (imageUrls.length > 0) {
      this.imageMessages = this.imageMessages.filter((entry) => entry.messageId !== messageId);
      this.imageMessages.push({ conversationId, messageId, content: normalize(content), imageUrls, receivedAt });
      this.trim();
    }
    for (const wake of this.waiters) wake();
  }

  private trim(): void {
    const size = () => this.imageMessages.reduce((sum, entry) => sum + entry.imageUrls.reduce((s, url) => s + url.length, 0), 0);
    while (this.imageMessages.length > maxImageMessages || (this.imageMessages.length > 1 && size() > maxImageBytes)) this.imageMessages.shift();
  }

  /** True once the daemon has published a user message with this text. */
  hasSeen(content: string): boolean {
    const wanted = normalize(content);
    return this.textMessages.some((entry) => entry.content === wanted || (entry.content.length > 0 && wanted.includes(entry.content)));
  }

  /** Waits briefly for the firehose to deliver the user message that started this turn. */
  async waitFor(content: string, timeoutMs: number): Promise<void> {
    if (this.hasSeen(content)) return;
    await new Promise<void>((resolve) => {
      const done = () => { clearTimeout(timer); this.waiters.delete(check); resolve(); };
      const check = () => { if (this.hasSeen(content)) done(); };
      const timer = setTimeout(done, timeoutMs);
      this.waiters.add(check);
    });
  }

  /** Returns messages with cached images re-attached as OpenAI image_url parts. */
  attach<T extends BridgeMessage>(messages: T[]): T[] {
    if (this.imageMessages.length === 0) return messages;
    const used = new Set<CapturedUserMessage>();
    const result = [...messages];
    let lastUserIndex = -1;
    let lastUserMatched = false;
    for (let index = result.length - 1; index >= 0; index -= 1) {
      const message = result[index];
      if (message.role !== "user" || typeof message.content !== "string") continue;
      const isLast = lastUserIndex === -1;
      if (isLast) lastUserIndex = index;
      const text = normalize(message.content);
      const entry = [...this.imageMessages].reverse().find((candidate) => !used.has(candidate)
        && (candidate.content === text || (candidate.content.length > 0 && text.includes(candidate.content))));
      if (!entry) continue;
      used.add(entry);
      if (isLast) lastUserMatched = true;
      result[index] = withImages(message, entry.imageUrls);
    }
    // An image-only message may reach the plugin with text the daemon added, so the
    // newest unmatched capture still belongs to the turn that is starting now.
    if (lastUserIndex >= 0 && !lastUserMatched) {
      const newest = this.imageMessages[this.imageMessages.length - 1];
      if (newest && !used.has(newest) && newest.content === "" && this.now() - newest.receivedAt <= imageOnlyFallbackMs) {
        result[lastUserIndex] = withImages(result[lastUserIndex], newest.imageUrls);
      }
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
