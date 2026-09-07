// @summary Tests for thread subscription switching
import { expect, mock, test } from "bun:test";
import { switchThreadSubscription } from "../../../../src/web/client/lib/use-thread-manager";

test("switchThreadSubscription unsubscribes previous thread before subscribing next thread", async () => {
  const rpc = {
    unsubscribe: mock(async (subscriptionId: string) => ({ ok: subscriptionId === "sub-old" })),
    subscribe: mock(async (threadId: string) => ({ subscriptionId: `sub:${threadId}` })),
  } as const;
  const activateThreadPrompts = mock(() => {});

  const next = await switchThreadSubscription({
    rpc: rpc as never,
    activeSubscription: { threadId: "thread-old", subscriptionId: "sub-old" },
    threadId: "thread-new",
    activateThreadPrompts,
  });

  expect(rpc.unsubscribe).toHaveBeenCalledWith("sub-old");
  expect(rpc.subscribe).toHaveBeenCalledWith("thread-new");
  expect(activateThreadPrompts).toHaveBeenCalledWith("thread-new");
  expect(next).toEqual({ threadId: "thread-new", subscriptionId: "sub:thread-new" });
});

test("switchThreadSubscription reuses active subscription when already on target thread", async () => {
  const rpc = {
    unsubscribe: mock(async () => ({ ok: true })),
    subscribe: mock(async () => ({ subscriptionId: "sub:thread-1" })),
  } as const;
  const activateThreadPrompts = mock(() => {});
  const activeSubscription = { threadId: "thread-1", subscriptionId: "sub:thread-1" };

  const next = await switchThreadSubscription({
    rpc: rpc as never,
    activeSubscription,
    threadId: "thread-1",
    activateThreadPrompts,
  });

  expect(rpc.unsubscribe).not.toHaveBeenCalled();
  expect(rpc.subscribe).not.toHaveBeenCalled();
  expect(activateThreadPrompts).toHaveBeenCalledWith("thread-1");
  expect(next).toBe(activeSubscription);
});
