// @summary Lets conversation history reads go ahead of background session-list scanning on the same disk

/**
 * History pages are what the reader is waiting on; the sidebar listing is not. Both read session files,
 * and on a slow (network) drive a listing pass can hold the disk for tens of seconds, so the listing
 * waits before each file while any history read is in flight.
 */
export class HistoryPriority {
  private active = 0;
  private idleWaiters: Array<() => void> = [];

  async run<T>(read: () => Promise<T>): Promise<T> {
    this.active++;
    try {
      return await read();
    } finally {
      this.active--;
      if (this.active === 0) {
        const waiters = this.idleWaiters;
        this.idleWaiters = [];
        for (const resolve of waiters) resolve();
      }
    }
  }

  /** Resolves immediately when no history read is in flight. */
  idle(): Promise<void> {
    if (this.active === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }
}
