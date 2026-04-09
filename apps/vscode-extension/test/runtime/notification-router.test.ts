import { describe, expect, test } from "bun:test";
import { routeNotification } from "../../src/runtime/notification-router";

describe("notification-router", () => {
  test("routes shared agent/event as direct panel live update", () => {
    const route = routeNotification({
      method: "agent/event",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        event: {
          type: "status_change",
          status: "busy",
        },
        threadStatus: "busy",
      },
    });

    expect(route.threadId).toBe("thread-1");
    expect(route.agentEvent?.type).toBe("status_change");
    expect(route.shouldReconcileThread).toBe(false);
  });

  test("routes terminal turn notifications to reconcile boundary", () => {
    const route = routeNotification({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        threadStatus: "idle",
      },
    });

    expect(route.threadId).toBe("thread-1");
    expect(route.agentEvent).toBeNull();
    expect(route.shouldReconcileThread).toBe(true);
  });

  test("routes thread started to thread-list refresh", () => {
    const route = routeNotification({
      method: "thread/started",
      params: {
        threadId: "thread-1",
      },
    });

    expect(route.threadId).toBe("thread-1");
    expect(route.shouldRefreshThreads).toBe(true);
  });
});
