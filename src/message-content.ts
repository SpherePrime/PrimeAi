import type { RouterContentPart, RouterMessage } from "./types.js";

export function normalizeMessageContent(content: unknown): RouterMessage["content"] {
  if (content === undefined || content === null) return null;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) throw new Error("Неподдерживаемое содержимое сообщения");
  return content.map((part): RouterContentPart => {
    if (part?.type === "text" && typeof part.text === "string") return { type: "text", text: part.text };
    if (part?.type !== "image_url" || typeof part.image_url?.url !== "string" || !part.image_url.url.trim()) {
      throw new Error("Изображение должно содержать URL или данные изображения");
    }
    const { url, detail } = part.image_url;
    if (detail !== undefined && !["auto", "low", "high"].includes(detail)) throw new Error("Некорректная детализация изображения");
    return { type: "image_url", image_url: { url, ...(detail === undefined ? {} : { detail }) } };
  });
}
