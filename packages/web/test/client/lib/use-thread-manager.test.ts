// @summary Tests for web thread manager helpers that manage draft composer input entries and subscriptions

import { expect, mock, test } from "bun:test";
import {
  clearDraftThreadInput,
  DRAFT_INPUT_KEY,
  switchThreadSubscription,
} from "../../../src/client/lib/use-thread-manager";

test("clearDraftThreadInput removes only the draft composer entry", () => {
  const next = clearDraftThreadInput({
    [DRAFT_INPUT_KEY]: "stale draft",
    "thread-1": "keep this",
  });

  expect(next).toEqual({
    "thread-1": "keep this",
  });
});

test("clearDraftThreadInput returns same object when no draft entry exists", () => {
  const original = { "thread-1": "keep this" };
  const next = clearDraftThreadInput(original);

  expect(next).toBe(original);
});

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
