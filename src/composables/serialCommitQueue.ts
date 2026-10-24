export const COMMIT_TIMEOUT_MESSAGE = "保存超时，请重试。";
const DEFAULT_COMMIT_TIMEOUT_MS = 20_000;

export function createSerialCommitQueue(options: { timeoutMs?: number } = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMIT_TIMEOUT_MS;
  let tail = Promise.resolve();

  return function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const settled = tail.then(async () => withTimeout(operation(), timeoutMs));
    tail = settled.then(
      () => undefined,
      () => undefined,
    );
    return settled;
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timerId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timerId = window.setTimeout(() => reject(new Error(COMMIT_TIMEOUT_MESSAGE)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timerId));
}
