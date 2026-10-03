const transientCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

export function isTransientConnectionError(error: unknown): boolean {
  const pending: unknown[] = [error];
  const visited = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== "object" || visited.has(current)) continue;
    visited.add(current);
    const failure = current as { code?: unknown; cause?: unknown; errors?: unknown };
    if (typeof failure.code === "string" && transientCodes.has(failure.code)) return true;
    if (failure.cause !== undefined) pending.push(failure.cause);
    if (Array.isArray(failure.errors)) pending.push(...failure.errors);
  }
  return false;
}

export async function connectWithRetry<T>(connect: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return await connect();
    } catch (error) {
      if (signal?.aborted || attempt >= 2 || !isTransientConnectionError(error)) throw error;
    }
  }
}
