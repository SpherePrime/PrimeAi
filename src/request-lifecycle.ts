export function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void operation.catch(() => {});
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const aborted = () => { signal.removeEventListener("abort", aborted); reject(signal.reason); };
    signal.addEventListener("abort", aborted, { once: true });
    operation.then(value => { signal.removeEventListener("abort", aborted); resolve(value); }, error => { signal.removeEventListener("abort", aborted); reject(error); });
  });
}

export function cancellableIterable<T>(source: AsyncIterable<T>, controller: AbortController): AsyncIterableIterator<T> {
  const iterator = source[Symbol.asyncIterator]();
  return {
    [Symbol.asyncIterator]() { return this; },
    next: () => iterator.next(),
    return: async () => {
      controller.abort();
      return iterator.return ? iterator.return() : { done: true, value: undefined };
    },
    throw: async (error: unknown) => {
      controller.abort(error);
      if (iterator.throw) return iterator.throw(error);
      throw error;
    },
  };
}
