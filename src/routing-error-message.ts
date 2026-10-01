const messages: Record<string, string> = {
  NO_PROVIDER_AVAILABLE: "Сейчас нет доступного провайдера. Повторите запрос позже.",
  STREAM_INTERRUPTED: "Соединение с провайдером прервалось. Повторите запрос.",
  ROUTING_TIMEOUT: "Не удалось дождаться ответа провайдера. Повторите запрос.",
};

export function routingErrorMessage(raw: string): string | undefined {
  const match = /^PrimeAI:\s*(NO_PROVIDER_AVAILABLE|STREAM_INTERRUPTED|ROUTING_TIMEOUT)\b/.exec(raw);
  return match ? messages[match[1]] : undefined;
}
