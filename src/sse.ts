import { abortable } from "./request-lifecycle.js";
import type { RouterEvent } from "./types.js";
import { CompletionError } from "./completion-error.js";

function parseEvent(name: string, data: string): RouterEvent {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    throw new CompletionError("INVALID_RESPONSE", false, "Invalid PrimeAI stream event");
  }
  if (!value || typeof value !== "object") throw new CompletionError("INVALID_RESPONSE", false);
  const event = value as Record<string, unknown>;
  if (event.type !== name) throw new CompletionError("INVALID_RESPONSE", false);
  if (name === "text" || name === "thinking") {
    if (typeof event.delta !== "string") throw new CompletionError("INVALID_RESPONSE", false);
  } else if (name === "tool_call") {
    const call = event.call;
    if (!call || typeof call !== "object") throw new CompletionError("INVALID_RESPONSE", false);
    const toolCall = call as Record<string, unknown>;
    if (typeof toolCall.id !== "string" || typeof toolCall.name !== "string" || typeof toolCall.argumentsJson !== "string") throw new CompletionError("INVALID_RESPONSE", false);
    try {
      JSON.parse(toolCall.argumentsJson);
    } catch {
      throw new CompletionError("INVALID_RESPONSE", false, "Invalid PrimeAI tool argumentsJson");
    }
  } else if (name === "route") {
    if (typeof event.providerName !== "string" || typeof event.modelId !== "string" || typeof event.substituted !== "boolean") throw new CompletionError("INVALID_RESPONSE", false);
  } else if (name === "error") {
    if (typeof event.code !== "string" || typeof event.retryable !== "boolean") throw new CompletionError("INVALID_RESPONSE", false);
  } else if (name !== "done") {
    throw new CompletionError("INVALID_RESPONSE", false);
  }
  return event as unknown as RouterEvent;
}

export async function* parseSse(body: ReadableStream<Uint8Array>, options: { signal?: AbortSignal; idleTimeoutMs?: number } = {}): AsyncIterable<RouterEvent> {
  const reader = body.getReader();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const cancel = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const cancelReader = () => { void reader.cancel(controller.signal.reason).catch(() => {}); };
  controller.signal.addEventListener("abort", cancelReader, { once: true });
  const decoder = new TextDecoder();
  let buffer = "";
  try {
  while (true) {
    idleTimer = setTimeout(() => controller.abort(new CompletionError("IDLE_TIMEOUT", false)), options.idleTimeoutMs ?? 120_000);
    const next = await abortable(reader.read(), controller.signal);
    clearTimeout(idleTimer);
    if (next.done) break;
    const chunk = next.value;
    buffer += decoder.decode(chunk, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");
    while (true) {
      const separator = buffer.indexOf("\n\n");
      if (separator < 0) break;
      const frame = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      let name = "";
      const data: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) name = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (name === "limits") continue;
      if (name && data.length > 0) yield parseEvent(name, data.join("\n"));
    }
  }
  buffer += decoder.decode();
  buffer = buffer.replace(/\r\n/g, "\n");
  if (buffer.trim()) throw new CompletionError("STREAM_INTERRUPTED", true);
  } finally {
    clearTimeout(idleTimer);
    options.signal?.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", cancelReader);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
