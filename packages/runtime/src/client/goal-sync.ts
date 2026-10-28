// @summary Reconcile goal snapshots after missed notifications without overlapping reads
import type { ThreadGoalResponse } from "@diligent/protocol";

export function startGoalSync(options: {
  currentThreadId: () => string | null;
  read: (threadId: string) => Promise<ThreadGoalResponse>;
  publish: (threadId: string, snapshot: ThreadGoalResponse) => void;
  onError: (error: unknown) => void;
}): { refresh: () => Promise<void>; dispose: () => void } {
  let disposed = false;
  let pending: Promise<void> | undefined;
  const refresh = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (pending) return pending;
    const threadId = options.currentThreadId();
    if (!threadId) return Promise.resolve();
    pending = options
      .read(threadId)
      .then((snapshot) => {
        if (!disposed && threadId === options.currentThreadId()) options.publish(threadId, snapshot);
      })
      .catch((error: unknown) => {
        if (!disposed) options.onError(error);
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
  // Notifications are the fast path; this repairs a dropped final update even
  // when the transport remains connected and no more agent events arrive.
  const timer = setInterval(() => {
    void refresh();
  }, 5_000);
  void refresh();
  return {
    refresh,
    dispose: () => {
      disposed = true;
      clearInterval(timer);
    },
  };
}
