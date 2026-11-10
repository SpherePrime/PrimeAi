import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DaemonClient } from "astra-plugin-sdk";
import { ChatImageCache, type ImageAttachmentLike } from "./chat-images.js";
import { requestDaemonSessionToken } from "./astra-client-auth.js";

// The plugin protocol gives an ai_provider neither chat images nor settings
// access. Astra's own window talks to the same daemon with the token in
// `<config>/daemon.token`; the plugin reuses that client API for both.

export interface AstraHostConnection {
  daemonAddr: string;
  token: string;
  configDir: string;
}

export function astraConfigDirs(env: NodeJS.ProcessEnv = process.env, home = homedir()): string[] {
  if (process.platform === "win32") {
    return [join(env.APPDATA || join(home, "AppData", "Roaming"), "astra", "astra", "config")];
  }
  const xdg = env.XDG_CONFIG_HOME || join(home, ".config");
  return [join(xdg, "astra"), join(xdg, "astra", "astra", "config")];
}

export function resolveAstraHost(argv: string[] = process.argv, env: NodeJS.ProcessEnv = process.env): AstraHostConnection | null {
  if (env.PRIMEAI_ASTRA_HOST === "off") return null;
  const daemonAddr = argv.find((arg) => arg.startsWith("--daemon-addr="))?.slice("--daemon-addr=".length);
  if (!daemonAddr) return null;
  const daemonPort = daemonAddr.slice(daemonAddr.lastIndexOf(":") + 1);
  for (const configDir of astraConfigDirs(env)) {
    try {
      const port = readFileSync(join(configDir, "daemon.port"), "utf8").trim();
      // A test harness or a second daemon serves another port; never touch the real Astra then.
      if (port !== daemonPort) continue;
      const token = readFileSync(join(configDir, "daemon.token"), "utf8").trim();
      if (token) return { daemonAddr, token, configDir };
    } catch {
      // Not this layout.
    }
  }
  return null;
}

type Unary = (client: unknown, method: string, request: unknown) => Promise<any>;

function log(message: string): void {
  console.error(`[primeai] ${message}`);
}

export type DaemonClientFactory = (daemonAddr: string, sessionToken: string) => DaemonClient;

export class AstraHostBridge {
  readonly images = new ChatImageCache();
  private client: DaemonClient | undefined;
  private stream: { cancel(): void } | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private reconnectDelayMs = 1_000;
  private subscribed = false;
  private stopped = false;
  private toolSearchDisabled = false;

  constructor(
    private readonly connection: AstraHostConnection,
    private readonly pluginDirectory: string,
    private readonly clientFactory: DaemonClientFactory = (addr, token) => new DaemonClient(addr, token)
  ) {}

  get capturing(): boolean {
    return this.subscribed;
  }

  private async daemon(): Promise<DaemonClient> {
    if (!this.client) {
      const sessionToken = await requestDaemonSessionToken(this.connection.daemonAddr, this.connection.token);
      const client = this.clientFactory(this.connection.daemonAddr, sessionToken);
      await client.connect();
      this.client = client;
    }
    return this.client;
  }

  private async unary(service: "configClient" | "chatClient", method: string, request: unknown): Promise<any> {
    const client = await this.daemon() as unknown as Record<string, unknown> & { _unary: Unary };
    return client._unary.call(client, client[service], method, request);
  }

  async start(): Promise<void> {
    try {
      await this.disableToolSearch();
    } catch (error) {
      log(`could not disable Tool Search on start: ${error instanceof Error ? error.message : String(error)}`);
    }
    await this.subscribe();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stream?.cancel();
    this.client?.close();
    this.client = undefined;
  }

  private async subscribe(): Promise<void> {
    if (this.stopped) return;
    try {
      const client = await this.daemon();
      const stream = client.subscribeChatEvents();
      this.stream = stream;
      stream.on("data", (message: { conversationId?: string; event?: { userMessage?: { messageId?: string; content?: string; images?: ImageAttachmentLike[] } } }) => {
        this.subscribed = true;
        this.reconnectDelayMs = 1_000;
        const user = message.event?.userMessage;
        if (!user) return;
        this.images.record(message.conversationId ?? "", user.messageId ?? "", user.content ?? "", user.images ?? []);
      });
      stream.on("metadata", () => { this.subscribed = true; });
      const retry = (reason: string) => {
        if (this.stream !== stream) return;
        this.stream = undefined;
        this.subscribed = false;
        this.client = undefined;
        this.scheduleResubscribe(reason);
      };
      stream.on("error", (error: Error) => retry(error.message));
      stream.on("end", () => retry("stream ended"));
    } catch (error) {
      this.client = undefined;
      this.scheduleResubscribe(error instanceof Error ? error.message : String(error));
    }
  }

  private scheduleResubscribe(reason: string): void {
    if (this.stopped) return;
    log(`chat image capture unavailable (${reason}); retrying in ${Math.round(this.reconnectDelayMs / 1000)}s`);
    this.reconnectTimer = setTimeout(() => void this.subscribe(), this.reconnectDelayMs);
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 60_000);
  }

  async disableToolSearch(): Promise<void> {
    if (this.toolSearchDisabled) return;
    try {
      const current = await this.unary("configClient", "GetSettings", {});
      const isCurrentlyDisabled = current?.toolSearch?.enabled === false
        || ((current as Record<string, unknown>)?.tool_search as Record<string, unknown> | undefined)?.enabled === false;
      if (isCurrentlyDisabled) {
        this.toolSearchDisabled = true;
        return;
      }
      await this.unary("configClient", "SetSetting", { path: "tool_search.enabled", valueJson: "false" });
      const updated = await this.unary("configClient", "GetSettings", {});
      const isNowDisabled = updated?.toolSearch?.enabled === false
        || ((updated as Record<string, unknown>)?.tool_search as Record<string, unknown> | undefined)?.enabled === false;
      if (isNowDisabled) {
        this.toolSearchDisabled = true;
        log("Astra Tool Search disabled");
        return;
      }
      throw new Error("daemon kept Tool Search enabled");
    } catch (error) {
      this.client = undefined;
      await disableToolSearchInFile(join(this.connection.configDir, "settings.json"));
      log(`Tool Search disabled in settings.json; restart Astra to apply (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  async disableToolSearchOnce(): Promise<void> {
    await this.disableToolSearch();
  }
}

export async function disableToolSearchInFile(path: string): Promise<void> {
  const settings = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  const current = settings.tool_search;
  const toolSearch = current && typeof current === "object" && !Array.isArray(current) ? current as Record<string, unknown> : {};
  if (toolSearch.enabled === false) return;
  settings.tool_search = { ...toolSearch, enabled: false };
  const temporary = `${path}.primeai.tmp`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}
