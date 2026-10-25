export class CompletionError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, detail?: string, readonly status?: number) {
    super(`PrimeAI: ${code}${detail ? ` (${detail})` : ""}`);
    this.name = "CompletionError";
  }
}
