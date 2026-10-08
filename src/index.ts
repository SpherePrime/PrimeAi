import { plugin, s, tool, UiContrib } from "astra-plugin-sdk";
import { PrimeAiRuntime } from "./runtime.js";
import { createWebSearchTool } from "./web-search-tool.js";

const pluginDirectory = process.env.ASTRA_PLUGIN_DIR || process.cwd();
let runtime: PrimeAiRuntime | undefined;

function getRuntime(): PrimeAiRuntime {
  if (!runtime) {
    runtime = new PrimeAiRuntime(pluginDirectory);
    runtime.startModelSync();
  }
  return runtime;
}

const fileTtlNotice = "Файл будет удалён через 24 часа.";

function assetUrl(asset: { url?: string; base64?: string; contentType?: string }): string {
  if (asset.url) return asset.url;
  if (asset.base64) {
    const mime = asset.contentType?.startsWith("video/") ? "video/mp4" : "image/png";
    return `data:${mime};base64,${asset.base64}`;
  }
  return "";
}

function renderAssets(kind: "image" | "video", assets: Array<{ url?: string; base64?: string; contentType?: string }>): string {
  const rendered = assets
    .map((asset) => assetUrl(asset))
    .filter((url) => url.length > 0)
    .map((url, index) => {
      const label = kind === "video"
        ? (assets.length > 1 ? `Видео ${index + 1}` : "Скачать видео")
        : (assets.length > 1 ? `Сгенерированное изображение ${index + 1}` : "Сгенерированное изображение");
      return kind === "video" ? `[${label}](${url})` : `![${label}](${url})`;
    });
  if (rendered.length === 0) return "";
  return `${rendered.join("\n\n")}\n\n${fileTtlNotice}`;
}

export const app = plugin({
  id: "dwertyfa-prime-ai",
  ai: {
    complete: (request, context) => getRuntime().complete(request, context.pluginId || "dwertyfa-prime-ai"),
  },
  tools: {
    primeai_web_search: createWebSearchTool((query, limit) => getRuntime().search(query, limit)),
    primeai_generate_image: tool({
      description: "Сгенерировать изображение по запросу пользователя и вернуть готовую markdown-картинку. Вызывай, когда пользователь просит картинку, иллюстрацию или изображение. После генерации ОБЯЗАТЕЛЬНО сообщи пользователю отдельной фразой: \"Изображение будет доступно по ссылке 24 часа, потом файл автоматически удалится\".",
      input: s.object({
        prompt: s.string().optional().describe("Точное описание изображения, которое нужно сгенерировать"),
        size: s.string().optional().describe("Размер изображения, например 1024x1024"),
        n: s.integer().optional().describe("Количество изображений (1-4)"),
      }),
      run: async ({ prompt, size, n }) => {
        try {
          const result = await getRuntime().generate("image", { prompt: prompt?.trim() || "", size, n });
          const rendered = renderAssets("image", result.assets);
          if (!rendered) return { success: false, error: "Сервер не вернул изображение" };
          return { success: true, result: rendered };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : "Ошибка генерации изображения" };
        }
      },
    }),
    primeai_generate_video: tool({
      description: "Сгенерировать видео по запросу пользователя и вернуть ссылку. Вызывай, когда пользователь просит видеоролик, анимацию или видео. После генерации ОБЯЗАТЕЛЬНО сообщи пользователю отдельной фразой: \"Видео будет доступно по ссылке 24 часа, потом файл автоматически удалится\".",
      input: s.object({
        prompt: s.string().optional().describe("Точное описание видео, которое нужно сгенерировать"),
        durationSeconds: s.integer().optional().describe("Длительность видео в секундах"),
        size: s.string().optional().describe("Разрешение видео, например 1280x720"),
      }),
      run: async ({ prompt, durationSeconds, size }) => {
        try {
          const result = await getRuntime().generate("video", { prompt: prompt?.trim() || "", durationSeconds, size });
          const rendered = renderAssets("video", result.assets);
          if (!rendered) return { success: false, error: "Сервер не вернул видео" };
          return { success: true, result: rendered };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : "Ошибка генерации видео" };
        }
      },
    }),
  },
  ui: {
    contributions: [
      {
        ...UiContrib.page("primeai-settings", "PrimeAI", "index.html", {
          iconSvg: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 3h13v4h-9v4h8v4h-8v6H6z"/></svg>',
        }),
        transparent: true,
      },
    ],
    onCall: {
      getState: () => getRuntime().publicState(),
      refreshModels: () => getRuntime().refreshModels(),
      selectModel: (params) => getRuntime().selectModel(String(record(params).modelId ?? "")),
      selectImageModel: (params) => getRuntime().selectImageModel(String(record(params).modelId ?? "")),
      selectVideoModel: (params) => getRuntime().selectVideoModel(String(record(params).modelId ?? "")),
      setStrictMode: (params) => getRuntime().setStrictMode(record(params).enabled === true),
      testConnection: () => getRuntime().testConnection(),
      pingModel: (params) => getRuntime().pingModel(String(record(params).modelId ?? "")),
    },
  },
  onShutdown: () => getRuntime().shutdown(),
  healthCheck: async () => {
    try {
      const state = await getRuntime().publicState();
      return { healthy: true, status: state.connected ? `PrimeAI connected: ${state.selectedModelId || "model not selected"}` : "PrimeAI configured; open plugin settings" };
    } catch (error) {
      return { healthy: false, status: error instanceof Error ? error.message : "PrimeAI configuration error" };
    }
  },
});

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

if (require.main === module) app.run();
