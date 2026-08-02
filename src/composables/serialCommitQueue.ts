export function createSerialCommitQueue() {
  let tail = Promise.resolve();

  return function enqueue<T>(operation: () => Promise<T>) {
    const pending = tail.then(operation);
    tail = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  };
}
