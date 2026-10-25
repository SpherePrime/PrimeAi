import { routingErrorMessage } from "./routing-error-message.js";
import { isTransientConnectionError } from "./connection-retry.js";
import { BadArguments, PluginError, RateLimited, Timeout, Unauthorized, Unavailable } from "astra-plugin-sdk";
import { CompletionError } from "./completion-error.js";

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

export class GenerationLimitError extends RateLimited {
  constructor(message: string) {
    super({ message });
    this.name = "GenerationLimitError";
  }
}

export function toUserFacingError(error: unknown): Error {
  if (error instanceof PluginError) return error;
  if (error instanceof MaintenanceModeError) return new Unavailable({ message: maintenanceMessage });
  if (isTransientConnectionError(error)) return new Unavailable({ message: "Не удалось подключиться к серверу. Повторите запрос." });
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (generationLimitPattern.test(raw)) {
    const detail = raw.split(":").slice(1).join(":").trim();
    return new GenerationLimitError(detail ? `Превышен лимит генераций. ${detail}` : "Превышен лимит генераций. Повторите позже.");
  }
  if (modelUnavailablePattern.test(raw)) return new Unavailable({ message: "Модель недоступна. Выберите другую модель." });
  const routingMessage = routingErrorMessage(raw);
  if (routingMessage) return raw.includes("ROUTING_TIMEOUT") ? new Timeout({ message: routingMessage }) : new Unavailable({ message: routingMessage });
  if (error instanceof CompletionError) {
    if (error.status === 400) return new BadArguments({ message: "Некорректные параметры запроса." });
    if (error.status === 401 || error.status === 403) return new Unauthorized({ message: "Не удалось авторизоваться на сервере." });
    if (error.status === 429) return new RateLimited({ message: "Превышен лимит запросов. Повторите позже." });
    if (error.status === 504) return new Timeout({ message: "Не удалось дождаться ответа провайдера. Повторите запрос." });
    return new Unavailable({ message: "Провайдер временно недоступен. Повторите запрос." });
  }
  return new Error(genericErrorMessage);
}
