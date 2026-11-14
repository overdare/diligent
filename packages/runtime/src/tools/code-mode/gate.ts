// @summary Agent-wide reader/writer gate shared by code mode nested calls and direct calls of nestable tools

interface Waiter {
  shared: boolean;
  admit: () => void;
}

/**
 * Mirrors the agent loop's batching rule across code mode: tools marked `supportParallel` may overlap,
 * every other tool runs alone. A yielded cell keeps dispatching nested calls while the model issues direct
 * calls, so both paths acquire the same gate (one per `CodeModeSession`, i.e. per agent). Waiters are
 * admitted in arrival order, so a waiting exclusive call is not starved by later shared ones.
 */
export class ToolGate {
  /** Admitted holders: n > 0 shared, -1 one exclusive, 0 free. */
  private holders = 0;
  private readonly waiting: Waiter[] = [];

  /** Resolves with a release function once admitted. Rejects with the abort reason if `signal` aborts first. */
  acquire(shared: boolean, signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted();
    if (this.waiting.length === 0 && this.admits(shared)) return Promise.resolve(this.enter(shared));
    const { promise, resolve, reject } = Promise.withResolvers<() => void>();
    const onAbort = () => {
      const index = this.waiting.indexOf(waiter);
      if (index >= 0) this.waiting.splice(index, 1);
      // A removed exclusive waiter may have been blocking shared waiters behind it.
      this.pump();
      reject(signal?.reason);
    };
    const waiter: Waiter = {
      shared,
      admit: () => {
        signal?.removeEventListener("abort", onAbort);
        resolve(this.enter(shared));
      },
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    this.waiting.push(waiter);
    return promise;
  }

  private admits(shared: boolean): boolean {
    return shared ? this.holders >= 0 : this.holders === 0;
  }

  private enter(shared: boolean): () => void {
    this.holders = shared ? this.holders + 1 : -1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holders = shared ? this.holders - 1 : 0;
      this.pump();
    };
  }

  private pump(): void {
    while (this.waiting.length > 0 && this.admits(this.waiting[0]!.shared)) this.waiting.shift()!.admit();
  }
}
