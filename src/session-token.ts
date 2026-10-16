type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class SessionToken {
  private session: { token: string; expiresAt: number } | undefined;
  private pending: Promise<string> | undefined;

  constructor(private readonly serverUrl: string, private readonly fetchRequest: FetchFunction) {}

  invalidate(token: string): void {
    if (this.session?.token === token) this.session = undefined;
  }

  async get(): Promise<string> {
    if (this.session && this.session.expiresAt > Date.now() + 60_000) return this.session.token;
    if (!this.pending) this.pending = this.create().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async create(): Promise<string> {
    const response = await this.fetchRequest(`${this.serverUrl}/api/plugin/session`, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`PrimeAI connection failed: ${response.status}`);
    const value = await response.json() as { token?: unknown; expiresAt?: unknown };
    if (typeof value.token !== "string" || !value.token || value.token.length > 1024
      || typeof value.expiresAt !== "number" || !Number.isSafeInteger(value.expiresAt)
      || value.expiresAt <= Date.now() + 60_000) throw new Error("Invalid PrimeAI connection response");
    this.session = { token: value.token, expiresAt: value.expiresAt };
    return value.token;
  }
}
