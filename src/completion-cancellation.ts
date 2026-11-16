import { AsyncLocalStorage } from "node:async_hooks";

interface CompletionCall {
  cancelled?: boolean;
  on(event: string, listener: () => void): unknown;
  removeListener(event: string, listener: () => void): unknown;
}

const requests = new AsyncLocalStorage<AbortSignal>();

export function completionSignal(): AbortSignal | undefined {
  return requests.getStore();
}

export function bindCompletionCancellation(app: unknown): void {
  const wrapper = app as { instance?: unknown };
  const transport = (wrapper.instance ?? app) as { handleAiComplete(call: CompletionCall): Promise<void> };
  const original = transport.handleAiComplete;
  if (typeof original !== "function") throw new Error("Unsupported Astra SDK completion transport");
  transport.handleAiComplete = async function(call) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    call.on("cancelled", cancel);
    if (call.cancelled) cancel();
    try {
      await requests.run(controller.signal, () => original.call(this, call));
    } finally {
      controller.abort();
      call.removeListener("cancelled", cancel);
    }
  };
}
