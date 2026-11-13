import type { AiChunk } from "astra-plugin-sdk";

export const accountLoginInstructions = "Чтобы воспользоваться PrimeAI, авторизуйтесь:\n\n1. Откройте вкладку **PrimeAI**.\n2. Нажмите **«Войти через Google»**.\n3. Завершите вход в открывшемся браузере и вернитесь в чат.\n\nПосле входа отправьте сообщение ещё раз.";

export async function* withAccountChat(
  authenticated: () => Promise<boolean>,
  complete: () => AsyncIterable<AiChunk | string>,
): AsyncIterable<AiChunk | string> {
  if (!await authenticated()) {
    yield { text: accountLoginInstructions };
    return;
  }
  yield* complete();
}
