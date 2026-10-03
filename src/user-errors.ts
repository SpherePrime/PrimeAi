import { routingErrorMessage } from "./routing-error-message.js";
import { isTransientConnectionError } from "./connection-retry.js";

const maintenanceMessage = "Сейчас технические работы. Повторите попытку позже";
const genericErrorMessage = "Произошла ошибка. Повторите запрос";
const modelUnavailablePattern = /MODEL_UNAVAILABLE|Модель .* недоступна/i;
const generationLimitPattern = /GENERATION_LIMIT_EXCEEDED/i;

export class MaintenanceModeError extends Error {
  constructor() {
    super(maintenanceMessage);
    this.name = "MaintenanceModeError";
  }
}

export class GenerationLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationLimitError";
  }
}

export function toUserFacingError(error: unknown): Error {
  if (error instanceof MaintenanceModeError) return new Error(maintenanceMessage);
  if (isTransientConnectionError(error)) return new Error("Не удалось подключиться к серверу. Повторите запрос.");
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (generationLimitPattern.test(raw)) {
    const detail = raw.split(":").slice(1).join(":").trim();
    return new GenerationLimitError(detail ? `Превышен лимит генераций. ${detail}` : "Превышен лимит генераций. Повторите позже.");
  }
  if (modelUnavailablePattern.test(raw)) return new Error("Модель недоступна. Выберите другую модель.");
  const routingMessage = routingErrorMessage(raw);
  if (routingMessage) return new Error(routingMessage);
  return new Error(genericErrorMessage);
}
