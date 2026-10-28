// @summary Goal reconciliation recovers missed updates without leaking stale thread responses
import { expect, spyOn, test } from "bun:test";
import type { ThreadGoalResponse } from "@diligent/protocol";
import { startGoalSync } from "../../src/client/goal-sync";

test("retries a failed snapshot read without concurrent requests", async () => {
  let attempts = 0;
  let resolve!: (snapshot: ThreadGoalResponse) => void;
  const delivered: ThreadGoalResponse[] = [];
  const errors: unknown[] = [];
  const sync = startGoalSync({
    currentThreadId: () => "thread",
    read: async () => {
      attempts++;
      if (attempts === 1) throw new Error("Disconnected");
      return new Promise<ThreadGoalResponse>((done) => {
        resolve = done;
      });
    },
    publish: (_threadId, snapshot) => {
      delivered.push(snapshot);
    },
    onError: (error) => {
      errors.push(error);
    },
  });
  try {
    await sync.refresh();
    expect(errors).toHaveLength(1);
    const retry = sync.refresh();
    const overlapping = sync.refresh();
    expect(attempts).toBe(2);
    const cleared = { goal: null, sequence: 7 };
    resolve(cleared);
    await Promise.all([retry, overlapping]);
    expect(delivered).toEqual([cleared]);
  } finally {
    sync.dispose();
  }
});

test("periodic reconciliation recovers updates without receiving any notification", async () => {
  let tick!: () => void;
  const realInterval = globalThis.setInterval;
  const interval = spyOn(globalThis, "setInterval").mockImplementation((handler) => {
    tick = handler as () => void;
    return realInterval(handler, 60_000);
  });
  let sequence = 1;
  const delivered: number[] = [];
  const sync = startGoalSync({
    currentThreadId: () => "thread",
    read: async () => ({ goal: null, sequence }),
    publish: (_id, snapshot) => {
      delivered.push(snapshot.sequence);
    },
    onError: () => {},
  });
  try {
    await sync.refresh();
    sequence = 2;
    tick();
    await sync.refresh();
    expect(delivered).toEqual([1, 2]);
    sync.dispose();
    tick();
    await sync.refresh();
    expect(delivered).toEqual([1, 2]);
  } finally {
    sync.dispose();
    interval.mockRestore();
  }
});

test("discard responses after a thread switch or disposal", async () => {
  let threadId = "first";
  let resolve!: (snapshot: ThreadGoalResponse) => void;
  const delivered: string[] = [];
  const sync = startGoalSync({
    currentThreadId: () => threadId,
    read: async () =>
      new Promise<ThreadGoalResponse>((done) => {
        resolve = done;
      }),
    publish: (id) => {
      delivered.push(id);
    },
    onError: () => {},
  });
  try {
    const first = sync.refresh();
    threadId = "second";
    resolve({ goal: null, sequence: 1 });
    await first;
    expect(delivered).toEqual([]);
    const second = sync.refresh();
    sync.dispose();
    resolve({ goal: null, sequence: 2 });
    await second;
    expect(delivered).toEqual([]);
  } finally {
    sync.dispose();
  }
});
