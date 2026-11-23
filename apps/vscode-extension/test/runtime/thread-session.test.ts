import { describe, expect, test } from "bun:test";
import { ThreadStore } from "../../src/state/thread-store";

describe("ThreadStore", () => {
  test("tracks initialize data, focused thread, and shared notification-derived status", () => {
    const store = new ThreadStore();

    store.setConnection("starting");
    store.setInitialize({
      serverName: "diligent",
      serverVersion: "0.0.1",
      protocolVersion: 1,
      capabilities: {
        supportsFollowUp: true,
        supportsApprovals: true,
        supportsUserInput: true,
      },
      availableModels: [
        {
          id: "gpt-test",
          provider: "openai",
          contextWindow: 128000,
          maxOutputTokens: 4096,
          supportsThinking: false,
        },
      ],
    });
    store.setThreads([
      {
        id: "thread-1",
        path: "/tmp/thread-1.jsonl",
        cwd: "/tmp",
        created: "2026-04-07T00:00:00.000Z",
        modified: "2026-04-07T00:00:00.000Z",
        messageCount: 1,
        firstUserMessage: "hello",
      },
    ]);
    store.setFocusedThread("thread-1");
    store.applyNotification({
      method: "turn/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        threadStatus: "busy",
      },
    });

    store.applyNotification({
      method: "thread/status/changed",
      params: {
        threadId: "thread-1",
        status: "busy",
      },
    });

    const snapshot = store.snapshot();
    expect(snapshot.connection).toBe("starting");
    expect(snapshot.availableModels?.[0]?.id).toBe("gpt-test");
    expect(snapshot.focusedThreadId).toBe("thread-1");
    expect(snapshot.threadStatuses["thread-1"]).toBe("busy");
  });

  test("updates running status from shared agent/event notification wrapper without needing thread/read refresh", () => {
    const store = new ThreadStore();
    store.setFocusedThread("thread-1");

    store.applyNotification({
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

    const snapshot = store.snapshot();
    expect(snapshot.threadStatuses["thread-1"]).toBe("busy");
    expect(snapshot.focusedThreadId).toBe("thread-1");
  });

  test("focused thread is explicit UI metadata and is not overwritten by thread started notification", () => {
    const store = new ThreadStore();
    store.setFocusedThread("thread-a");

    store.applyNotification({
      method: "thread/started",
      params: {
        threadId: "thread-b",
      },
    });

    expect(store.snapshot().focusedThreadId).toBe("thread-a");
  });

  test("applies thread name updates, including clearing a name, to the listed thread only", () => {
    const store = new ThreadStore();
    const summary = (id: string) => ({
      id,
      path: `/tmp/${id}.jsonl`,
      cwd: "/tmp",
      created: "2026-04-07T00:00:00.000Z",
      modified: "2026-04-07T00:00:00.000Z",
    });
    store.setThreads([summary("thread-1"), summary("thread-2")]);

    store.applyNotification({ method: "thread/name/updated", params: { threadId: "thread-1", name: "Triage" } });
    expect(store.snapshot().threads.map((thread) => thread.name)).toEqual(["Triage", undefined]);

    store.applyNotification({ method: "thread/name/updated", params: { threadId: "thread-1" } });
    expect(store.snapshot().threads[0]?.name).toBeUndefined();
  });
});
