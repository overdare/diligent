// @summary Tests for app-level reducer behavior extracted from App orchestrator

import { expect, test } from "bun:test";
import { appReducer } from "../../../src/client/lib/app-state";
import { initialThreadState } from "../../../src/client/lib/thread-store";

test("set_threads keeps optimistic first message when server value is empty", () => {
  const seeded = {
    ...initialThreadState,
    threadList: [
      {
        id: "t1",
        path: "",
        cwd: "",
        created: "2026-01-01T00:00:00.000Z",
        modified: "2026-01-01T00:00:00.000Z",
        messageCount: 1,
        firstUserMessage: "hello optimistic",
      },
    ],
  };

  const next = appReducer(seeded, {
    type: "set_threads",
    payload: [
      {
        id: "t1",
        path: "",
        cwd: "",
        created: "2026-01-01T00:00:00.000Z",
        modified: "2026-01-02T00:00:00.000Z",
        messageCount: 1,
      },
    ],
  });

  expect(next.threadList[0]?.firstUserMessage).toBe("hello optimistic");
});

test("optimistic_thread prepends a new thread when absent", () => {
  const next = appReducer(initialThreadState, {
    type: "optimistic_thread",
    payload: { threadId: "t-new", message: "first message" },
  });

  expect(next.threadList[0]?.id).toBe("t-new");
  expect(next.threadList[0]?.firstUserMessage).toBe("first message");
  expect(next.threadList[0]?.messageCount).toBe(1);
});

test("optimistic_thread updates existing thread missing first message", () => {
  const seeded = {
    ...initialThreadState,
    threadList: [
      {
        id: "t1",
        path: "",
        cwd: "",
        created: "2026-01-01T00:00:00.000Z",
        modified: "2026-01-01T00:00:00.000Z",
        messageCount: 0,
      },
    ],
  };

  const next = appReducer(seeded, {
    type: "optimistic_thread",
    payload: { threadId: "t1", message: "seeded now" },
  });

  expect(next.threadList).toHaveLength(1);
  expect(next.threadList[0]?.firstUserMessage).toBe("seeded now");
});

test("consume_first_pending_steer removes head entry only", () => {
  const seeded = {
    ...initialThreadState,
    pendingSteers: ["a", "b", "c"],
  };

  const next = appReducer(seeded, { type: "consume_first_pending_steer" });

  expect(next.pendingSteers).toEqual(["b", "c"]);
});
