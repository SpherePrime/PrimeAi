import { callAccount } from "./account-bridge";
interface AuthState { signedIn: boolean; waiting: boolean; email: string; error: string }

export function mountAccount(): void {
  const panel = document.createElement("section");
  panel.className = "account-login";
  panel.innerHTML = '<div class="account-card"><div class="account-brand">/// PrimeAI</div><h1>Войдите, чтобы начать</h1><p>Один аккаунт Prime для доступа к моделям и инструментам PrimeAI.</p><button type="button">Войти через Google</button><p role="status">Проверка сессии…</p></div>';
  document.body.prepend(panel);
  const button = panel.querySelector("button")!;
  const status = panel.querySelector('[role="status"]')!;
  let signedIn = false;
  const update = async () => {
    try {
      const auth = await callAccount<AuthState>("getAuth");
      if (!auth) return;
      const justSignedIn = !signedIn && auth.signedIn;
      signedIn = auth.signedIn;
      panel.className = signedIn ? "account-session" : "account-login";
      const header = document.querySelector(".pv-top-actions");
      if (signedIn && header && panel.parentElement !== header) header.append(panel);
      if (!signedIn && panel.parentElement !== document.body) document.body.prepend(panel);
      const card = panel.firstElementChild as HTMLElement;
      card.className = signedIn ? "" : "account-card";
      for (const element of Array.from(card.children)) {
        if (element instanceof HTMLElement && element !== button && element !== status) element.hidden = signedIn;
      }
      if (justSignedIn) void window.astra?.callBackend("refreshModels", {}).catch(() => {});
      button.textContent = signedIn ? "Выйти" : auth.waiting ? "Отменить вход" : "Войти через Google";
      status.textContent = auth.error || (signedIn ? auth.email : auth.waiting ? "Завершите вход в браузере…" : "Для работы плагина необходим вход");
      for (const element of Array.from(document.body.children)) {
        if (element instanceof HTMLElement && element !== panel && !["SCRIPT", "STYLE"].includes(element.tagName)) element.hidden = !signedIn;
      }
    } catch (error) { status.textContent = `Не удалось проверить авторизацию: ${error instanceof Error ? error.message : String(error)}`; }
  };
  button.addEventListener("click", () => {
    void (async () => {
      const auth = await callAccount<AuthState>("getAuth");
      await callAccount<AuthState>(signedIn || auth?.waiting ? "logout" : "loginGoogle");
      await update();
    })().catch((error) => { status.textContent = `Не удалось выполнить вход: ${error instanceof Error ? error.message : String(error)}`; });
  });
  void update();
  window.setInterval(() => { void update(); }, 1000);
}
