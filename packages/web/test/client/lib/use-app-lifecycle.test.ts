// @summary Tests for web RPC lifecycle helpers that gate notifications to the active thread view

import { expect, test } from "bun:test";
import type { DiligentServerNotification } from "@diligent/protocol";
import { shouldDispatchNotificationToActiveThread } from "../../../src/client/lib/use-app-lifecycle";

test("draft view ignores thread-scoped notifications from existing threads", () => {
  const notification: DiligentServerNotification = {
    method: "thread/status/changed",
    params: {
      threadId: "running-thread",
      status: "busy",
      threadStatus: "busy",
    },
  };

  expect(shouldDispatchNotificationToActiveThread(notification, null)).toBe(false);
});

test("active thread view still accepts matching thread notifications", () => {
  const notification: DiligentServerNotification = {
    method: "item/delta",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      delta: {
        type: "messageText",
        itemId: "item-1",
        delta: "hello",
      },
    },
  };

  expect(shouldDispatchNotificationToActiveThread(notification, "thread-1")).toBe(true);
  expect(shouldDispatchNotificationToActiveThread(notification, "thread-2")).toBe(false);
});

test("thread start and resume notifications are always dispatched", () => {
  const started: DiligentServerNotification = {
    method: "thread/started",
    params: { threadId: "thread-1" },
  };
  const resumed: DiligentServerNotification = {
    method: "thread/resumed",
    params: { threadId: "thread-1" },
  };

  expect(shouldDispatchNotificationToActiveThread(started, null)).toBe(true);
  expect(shouldDispatchNotificationToActiveThread(resumed, null)).toBe(true);
});
