import { ModelPicker } from "./model-picker";

interface AstraBridge {
  callBackend(method: string, params: Record<string, unknown>): Promise<unknown>;
}

interface PublicModel {
  id: string;
  name: string;
  kind: string;
  supportsVision?: boolean;
}

interface PingResult {
  ok: boolean;
  latencyMs: number;
  modelId: string;
}

interface UiState {
  selectedModelId: string;
  imageModelId: string;
  videoModelId: string;
  strictModel: boolean;
  automaticModelId: string;
  models: PublicModel[];
  imageModels: PublicModel[];
  videoModels: PublicModel[];
  connected: boolean;
  lastRoute: { providerName: string; modelId: string; substituted: boolean } | null;
  lastPing: PingResult | null;
  lastError: string;
}

declare global {
  interface Window {
    astra?: AstraBridge;
  }
}

function getElements() {
  return {
    status: document.querySelector<HTMLElement>("#status")!,
    availability: document.querySelector<HTMLElement>("#availability")!,
    route: document.querySelector<HTMLElement>("#route")!,
    ping: document.querySelector<HTMLElement>("#ping")!,
    error: document.querySelector<HTMLElement>("#error")!,
    toast: document.querySelector<HTMLElement>("#toast")!,
    strictModel: document.querySelector<HTMLInputElement>("#strict-model")!,
    pingModel: document.querySelector<HTMLButtonElement>("#ping-model")!,
  };
}

async function call(method: string, params: Record<string, unknown> = {}): Promise<UiState> {
  const bridge = window.astra;
  if (!bridge || typeof bridge.callBackend !== 'function') {
    throw new Error('Мост Astra не загрузился. Перезапустите плагин.');
  }
  return bridge.callBackend(method, params) as Promise<UiState>;
}

let toastTimer = 0;
let stateCache: UiState | null = null;
let chatPicker: ModelPicker;
let imagePicker: ModelPicker;
let videoPicker: ModelPicker;

function showToast(message: string, bad = false) {
  const { toast } = getElements();
  toast.textContent = message;
  toast.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.className = 'toast'; }, 3000);
}

function toModelOption(model: PublicModel): { id: string; name: string } {
  return { id: model.id, name: model.supportsVision ? `${model.name} · Зрение` : model.name };
}

function isSpecificModelSelected(state: UiState): boolean {
  return Boolean(state.selectedModelId) && state.selectedModelId !== state.automaticModelId;
}

function checkModelPing(): void {
  if (!stateCache || !isSpecificModelSelected(stateCache)) return;
  void run("pingModel", { modelId: stateCache.selectedModelId }).then((state) => {
    const ping = state?.lastPing;
    if (ping) showToast(ping.ok ? `Пинг: ${ping.latencyMs} мс` : "Недоступна", !ping.ok);
  });
}

function pingDisplayName(state: UiState, modelId: string): string {
  if (!modelId) return "";
  const model = state.models.find((item) => item.id === modelId);
  if (model) return model.name;
  if (modelId === state.automaticModelId) return "Автоматически";
  return modelId;
}

function formatPing(state: UiState): string {
  const ping = state.lastPing;
  if (!ping) return "";
  if (!ping.ok) return "Недоступна";
  const modelName = pingDisplayName(state, ping.modelId);
  return `Пинг: ${ping.latencyMs} мс${modelName ? ` · ${modelName}` : ""}`;
}

function render(state: UiState): void {
  stateCache = state;
  const { status, availability, route, error, strictModel, ping, pingModel } = getElements();
  status.textContent = state.connected ? "Онлайн" : "Нет связи";
  status.className = state.connected ? "badge ok" : "badge";
  chatPicker.setModels(state.models.map(toModelOption), state.selectedModelId);
  imagePicker.setModels(state.imageModels.map(toModelOption), state.imageModelId);
  videoPicker.setModels(state.videoModels.map(toModelOption), state.videoModelId);
  document.getElementById("image-section")!.hidden = state.imageModels.length === 0;
  document.getElementById("video-section")!.hidden = state.videoModels.length === 0;
  strictModel.checked = state.strictModel;
  availability.textContent =
    state.models.length || state.imageModels.length || state.videoModels.length
      ? "Список обновляется автоматически"
      : "Доступных моделей нет";
  route.textContent = state.lastRoute
    ? pingDisplayName(state, state.lastRoute.modelId)
    : "Пока нет завершённых запросов";
  ping.textContent = formatPing(state);
  const specificModelSelected = Boolean(state.selectedModelId) && state.selectedModelId !== state.automaticModelId;
  pingModel.disabled = !specificModelSelected;
  error.textContent = state.lastError;
}

async function run(method: string, params: Record<string, unknown> = {}, successMessage?: string): Promise<UiState | null> {
  const { error } = getElements();
  error.textContent = "";
  try {
    const state = await call(method, params);
    stateCache = state;
    render(state);
    if (successMessage) showToast(successMessage);
    return state;
  } catch (failure) {
    const msg = failure instanceof Error ? failure.message : "Ошибка";
    error.textContent = msg;
    showToast(msg, true);
    return null;
  }
}

function init() {
  chatPicker = new ModelPicker(document.querySelector<HTMLElement>("#chat-picker")!, {
    onSelect: (modelId, modelName) => { void run("selectModel", { modelId }, `Выбрана модель: ${modelName}`); },
  });
  imagePicker = new ModelPicker(document.querySelector<HTMLElement>("#image-picker")!, {
    allowEmpty: true,
    emptyLabel: "Автоматически",
    onSelect: (modelId) => { void run("selectImageModel", { modelId }, modelId ? "Модель изображений выбрана" : "Выбор модели изображений снят"); },
  });
  videoPicker = new ModelPicker(document.querySelector<HTMLElement>("#video-picker")!, {
    allowEmpty: true,
    emptyLabel: "Автоматически",
    onSelect: (modelId) => { void run("selectVideoModel", { modelId }, modelId ? "Модель видео выбрана" : "Выбор модели видео снят"); },
  });

  document.querySelector("#refresh")!.addEventListener("click", () => { void run("refreshModels", {}, "Модели обновлены"); });
  getElements().strictModel.addEventListener("change", (event) => {
    const enabled = (event.target as HTMLInputElement).checked;
    void run("setStrictMode", { enabled }, enabled ? "Строгий режим включён" : "Строгий режим выключен");
  });
  document.querySelector("#test")!.addEventListener("click", () => { void run("testConnection", {}, "Сервер доступен"); });
  getElements().pingModel.addEventListener("click", checkModelPing);
  void run("getState").then(() => { void run("refreshModels"); });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export {};
