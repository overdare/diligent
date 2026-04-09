// @summary Tests for web app action helpers that decide which composer input state to clear on send and first-thread setup

import { expect, mock, test } from "bun:test";
import type { Mode } from "@diligent/protocol";
import type { PendingImage } from "../../../src/client/lib/app-state";
import {
  clearComposerInputAfterSend,
  prepareNewThreadForFirstMessage,
  runThreadCompaction,
} from "../../../src/client/lib/use-app-actions";

test("clearComposerInputAfterSend clears draft input when sending first message from new conversation", () => {
  const clearThreadInput = mock(() => {});
  const clearDraftInput = mock(() => {});

  clearComposerInputAfterSend({
    activeThreadId: null,
    clearThreadInput,
    clearDraftInput,
  });

  expect(clearDraftInput).toHaveBeenCalledTimes(1);
  expect(clearThreadInput).not.toHaveBeenCalled();
});

test("clearComposerInputAfterSend clears active thread input for existing conversations", () => {
  const clearThreadInput = mock(() => {});
  const clearDraftInput = mock(() => {});

  clearComposerInputAfterSend({
    activeThreadId: "thread-1",
    clearThreadInput,
    clearDraftInput,
  });

  expect(clearThreadInput).toHaveBeenCalledWith("thread-1");
  expect(clearDraftInput).not.toHaveBeenCalled();
});

test("prepareNewThreadForFirstMessage subscribes and hydrates before starting optimistic first message flow", async () => {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    value: {
      location: { pathname: "/" },
      history: { replaceState: mock(() => {}) },
    },
    configurable: true,
    writable: true,
  });

  const request = mock(async (method: string, params: unknown) => {
    if (method === "thread/start") {
      expect(params).toEqual({ cwd: "/repo", mode: "default", effort: "high", model: "gpt-5" });
      return { threadId: "thread-1" };
    }
    throw new Error(`unexpected method: ${method} ${JSON.stringify(params)}`);
  });
  const rpc = { request } as never;
  const history = {
    cwd: "/repo",
    items: [],
    entryCount: 0,
    isRunning: true,
    currentEffort: "medium",
    currentModel: "gpt-5",
  };
  const activateServerThread = mock(async (threadId: string) => {
    expect(threadId).toBe("thread-1");
    return history;
  });
  const applySessionModel = mock(async () => {});
  const dispatch = mock(() => {});
  const images: PendingImage[] = [];

  try {
    const result = await prepareNewThreadForFirstMessage({
      rpc,
      mode: "default",
      cwd: "/repo",
      model: "gpt-5",
      effort: "high",
      activateServerThread,
      applySessionModel,
      dispatch,
      message: "hello",
      images,
    });

    expect(result).toEqual({ threadId: "thread-1", history });
    expect(request.mock.calls.map((call) => call[0])).toEqual(["thread/start"]);
    expect(activateServerThread).toHaveBeenCalledWith("thread-1");
    expect(dispatch.mock.calls).toEqual([
      [{ type: "hydrate", payload: { threadId: "thread-1", mode: "default", history } }],
      [{ type: "local_user", payload: { text: "hello", images } }],
    ]);
    expect(applySessionModel).toHaveBeenCalledWith("gpt-5");
  } finally {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    } else {
      delete (globalThis as { window?: Window }).window;
    }
  }
});

test("prepareNewThreadForFirstMessage passes medium effort through thread start without extra effort request", async () => {
  const request = mock(async (method: string, params: unknown) => {
    if (method === "thread/start") {
      expect(params).toEqual({ cwd: "/repo", mode: "default", effort: "medium", model: "gpt-5" });
      return { threadId: "thread-2" };
    }
    throw new Error(`unexpected method: ${method} ${JSON.stringify(params)}`);
  });
  const rpc = { request } as never;
  const history = {
    cwd: "/repo",
    items: [],
    entryCount: 0,
    isRunning: false,
    currentEffort: "medium",
    currentModel: "gpt-5",
  };
  const activateServerThread = mock(async () => history);
  const applySessionModel = mock(async () => {});
  const dispatch = mock(() => {});

  const result = await prepareNewThreadForFirstMessage({
    rpc,
    mode: "default",
    cwd: "/repo",
    model: "gpt-5",
    effort: "medium",
    activateServerThread,
    applySessionModel,
    dispatch,
    message: "hello",
    images: [],
  });

  expect(result).toEqual({ threadId: "thread-2", history });
  expect(request.mock.calls.map((call) => call[0])).toEqual(["thread/start"]);
});

test("turn/steer request schema accepts image attachments", async () => {
  const { DiligentClientRequestSchema } = await import("@diligent/protocol");

  expect(
    DiligentClientRequestSchema.safeParse({
      method: "turn/steer",
      params: {
        threadId: "thread-1",
        content: "check this image",
        attachments: [{ type: "local_image", path: "/tmp/shot.png", mediaType: "image/png", fileName: "shot.png" }],
        followUp: false,
      },
    }).success,
  ).toBe(true);
});

test("runThreadCompaction waits without client RPC timeout and hydrates after success", async () => {
  const request = mock(async (method: string, params: unknown, timeoutMs?: number) => {
    if (method === "thread/compact/start") {
      expect(params).toEqual({ threadId: "thread-1" });
      expect(timeoutMs).toBeNull();
      return { compacted: true };
    }
    if (method === "thread/read") {
      expect(params).toEqual({ threadId: "thread-1" });
      return {
        cwd: "/repo",
        items: [],
        entryCount: 1,
        isRunning: false,
        currentEffort: "medium",
        currentModel: "gpt-5",
      };
    }
    throw new Error(`unexpected method: ${method}`);
  });
  const dispatch = mock(() => {});
  const rpc = { request } as never;

  await runThreadCompaction({
    rpc,
    threadId: "thread-1",
    mode: "default" as Mode,
    dispatch,
  });

  expect(request.mock.calls.map((call) => call[0])).toEqual(["thread/compact/start", "thread/read"]);
  expect(dispatch.mock.calls).toEqual([
    [
      {
        type: "hydrate",
        payload: {
          threadId: "thread-1",
          mode: "default",
          history: {
            cwd: "/repo",
            items: [],
            entryCount: 1,
            isRunning: false,
            currentEffort: "medium",
            currentModel: "gpt-5",
          },
        },
      },
    ],
  ]);
});

test("runThreadCompaction surfaces compaction request errors and clears compacting state", async () => {
  const request = mock(async () => {
    throw new Error("RPC timeout for thread/compact/start");
  });
  const dispatch = mock(() => {});
  const rpc = { request } as never;

  await runThreadCompaction({
    rpc,
    threadId: "thread-1",
    mode: "default" as Mode,
    dispatch,
  });

  expect(dispatch.mock.calls).toEqual([
    [
      {
        type: "compaction_error",
      },
    ],
    [
      {
        type: "show_info_toast",
        payload: "RPC timeout for thread/compact/start",
      },
    ],
  ]);
});
