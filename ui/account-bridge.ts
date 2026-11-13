export async function callAccount<T>(method: string): Promise<T> {
  const bridge = window.astra;
  if (!bridge || typeof bridge.callBackend !== "function") throw new Error("Мост Astra ещё не готов. Перезапустите плагин.");
  const response = await bridge.callBackend(method, {});
  const result = typeof response === "string" ? JSON.parse(response) : response;
  if (!result || typeof result !== "object") throw new Error("Плагин вернул пустой ответ");
  if (typeof result.error === "string" && !("signedIn" in result)) throw new Error(result.error);
  return result as T;
}
