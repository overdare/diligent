import { describe, expect, test } from "bun:test";
import { ThreadStore } from "../../src/state/thread-store";

describe("ThreadStore", () => {
  test("tracks initialize data, active thread, thread reads, and notifications", () => {
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
    store.setActiveThread("thread-1");
    store.setThreadRead("thread-1", {
      cwd: "/tmp",
      items: [],
      hasFollowUp: false,
      entryCount: 0,
      isRunning: false,
      currentEffort: "medium",
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
    expect(snapshot.activeThreadId).toBe("thread-1");
    expect(snapshot.threadReads["thread-1"]?.cwd).toBe("/tmp");
    expect(snapshot.activeThreadStatus).toBe("busy");
  });
});
