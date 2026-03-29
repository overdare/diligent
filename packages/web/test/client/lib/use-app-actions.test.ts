// @summary Tests for web app action helpers that decide which composer input state to clear on send and first-thread setup

import { expect, mock, test } from "bun:test";
import type { PendingImage } from "../../../src/client/lib/app-state";
import { clearComposerInputAfterSend, prepareNewThreadForFirstMessage } from "../../../src/client/lib/use-app-actions";

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
      return { threadId: "thread-1" };
    }
    if (method === "effort/set") {
      return { effort: "high" };
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
    expect(request.mock.calls.map((call) => call[0])).toEqual(["thread/start", "effort/set"]);
    expect(activateServerThread).toHaveBeenCalledWith("thread-1");
    expect(dispatch.mock.calls).toEqual([
      [{ type: "hydrate", payload: { threadId: "thread-1", mode: "default", history } }],
      [{ type: "local_user", payload: { text: "hello", images } }],
    ]);
    expect(applySessionModel).toHaveBeenCalledWith("gpt-5");
    expect(request).toHaveBeenNthCalledWith(2, "effort/set", { threadId: "thread-1", effort: "high" });
  } finally {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    } else {
      delete (globalThis as { window?: Window }).window;
    }
  }
});
