import { randomBytes } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

import { loadAccount, saveAccount } from "./account-storage.js";

const site = "https://vpn.sphereprime.ru";

export class AccountAuth {
  private token = "";
  private email = "";
  private flow = 0;
  private waiting = false;
  private error = "";
  private readonly ready: Promise<void>;
  private readonly path: string;

  constructor(directory: string) {
    this.path = join(directory, "primeai-account.bin");
    this.ready = this.restore();
  }

  private async restore(): Promise<void> {
    try {
      const stored = await loadAccount(this.path);
      if (typeof stored.token !== "string") return;
      const response = await fetch(`${site}/api/auth/me`, {
        headers: { authorization: `Bearer ${stored.token}` },
        signal: AbortSignal.timeout(10_000), redirect: "error",
      });
      if (!response.ok) return;
      const payload = await response.json() as { user?: { email?: string }; email?: string };
      this.email = payload.user?.email ?? payload.email ?? "";
      this.token = stored.token;
    } catch {}
  }

  async getToken(): Promise<string> {
    await this.ready;
    if (!this.token) throw new Error("Войдите через Google на вкладке PrimeAI");
    return this.token;
  }

  async state() {
    await this.ready;
    return { signedIn: Boolean(this.token), email: this.email, waiting: this.waiting, error: this.error };
  }

  async login(): Promise<void> {
    await this.ready;
    const flow = ++this.flow;
    const hash = `desktop_${randomBytes(32).toString("hex")}`;
    const url = `${site}/auth/google?app_hash=${hash}`;
    this.waiting = true;
    this.error = "";
    const command = process.platform === "win32" ? "rundll32.exe" : process.platform === "darwin" ? "open" : "xdg-open";
    const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
    child.on("error", () => { if (flow === this.flow) { this.error = "Не удалось открыть браузер"; this.waiting = false; ++this.flow; } });
    child.unref();
    void this.poll(hash, flow);
  }

  private async poll(hash: string, flow: number): Promise<void> {
    try {
      for (let attempt = 0; attempt < 150 && flow === this.flow; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (flow !== this.flow) return;
        const response = await fetch(`${site}/api/auth/desktop-auth/${hash}`, { signal: AbortSignal.timeout(10_000), cache: "no-store", redirect: "error" });
        if (response.status >= 500) throw new Error(`Сервер входа недоступен (HTTP ${response.status}). Повторите попытку.`);
        const result = await response.json().catch(() => ({})) as { status?: string; token?: string; user?: { email?: string } };
        if (flow !== this.flow) return;
        if (result.status === "success" && result.token) {
          await saveAccount(this.path, result.token);
          if (flow !== this.flow) { await unlink(this.path).catch(() => {}); return; }
          this.token = result.token;
          this.email = result.user?.email ?? "";
          this.waiting = false;
          return;
        }
      }
      if (flow === this.flow) this.error = "Время ожидания истекло. Повторите вход.";
    } catch (error) {
      if (flow === this.flow) this.error = error instanceof Error ? error.message : "Ошибка входа";
    } finally {
      if (flow === this.flow) this.waiting = false;
    }
  }

  async logout(): Promise<void> {
    await this.ready;
    ++this.flow;
    this.token = "";
    this.email = "";
    this.waiting = false;
    this.error = "";
    await unlink(this.path).catch(() => {});
  }
}
