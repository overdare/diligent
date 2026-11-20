// @summary FIFO reader/writer gate: shared tool calls overlap, exclusive tool calls run alone

interface Waiter {
  shared: boolean;
  admit: () => void;
}

/**
 * Tools marked `supportParallel` acquire shared access and may overlap; every other tool acquires exclusive
 * access and runs alone. Waiters are admitted in arrival order, so a waiting exclusive call is not starved by
 * later shared ones and calls never overtake an earlier exclusive call.
 *
 * The agent loop uses one gate per tool batch to schedule the model's calls. Code mode keeps one gate per agent
 * so a yielded cell's nested calls and the model's direct calls of nestable tools never overlap unsafely.
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
