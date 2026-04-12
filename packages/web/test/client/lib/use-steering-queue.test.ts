// @summary Tests for steering queue: attachment building, canSteer, steer RPC flow, and abort-restart dispatch
import { describe, expect, mock, test } from "bun:test";
import { DILIGENT_CLIENT_REQUEST_METHODS } from "@diligent/protocol";
import type { PendingImage } from "../../../src/client/lib/app-state";

// Mock React hooks before the module under test is loaded.
// useCallback returns the function directly; useRef returns a plain mutable box.
mock.module("react", () => ({
  useCallback: (fn: unknown) => fn,
  useRef: (initial: unknown) => ({ current: initial }),
}));

const { buildSteerAttachments, useSteeringQueue } = await import(
  "../../../src/client/lib/use-steering-queue"
);

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeMockRpc() {
  return { request: mock(async (_method: string, _params: unknown) => {}) };
}

function makeHook({
  activeInput = "",
  isBusy = false,
  pendingImages = [] as PendingImage[],
  activeThreadId = "thread-1" as string | null,
  items = [] as unknown[],
  rpc = makeMockRpc() as ReturnType<typeof makeMockRpc>,
} = {}) {
  const dispatch = mock((_action: unknown) => {});
  const clearThreadInput = mock((_id: string) => {});
  const clearPendingImages = mock(() => {});

  const hooks = useSteeringQueue({
    rpcRef: { current: rpc as never },
    stateRef: { current: { items } as never },
    dispatch,
    activeThreadId,
    currentModelRef: { current: "claude-model" },
    activeInput,
    pendingImages,
    isBusy,
    clearThreadInput,
    clearPendingImages,
  });

  return { ...hooks, dispatch, clearThreadInput, clearPendingImages, rpc };
}

// ─── buildSteerAttachments ────────────────────────────────────────────────────

describe("buildSteerAttachments", () => {
  test("maps PendingImage to protocol attachment format", () => {
    const images: PendingImage[] = [
      { type: "local_image", path: "/tmp/img.png", mediaType: "image/png", fileName: "img.png", webUrl: "blob:img" },
    ];
    expect(buildSteerAttachments(images)).toEqual([
      { type: "local_image", path: "/tmp/img.png", mediaType: "image/png", fileName: "img.png" },
    ]);
  });

  test("strips webUrl from output", () => {
    const images: PendingImage[] = [
      { type: "local_image", path: "/tmp/img.png", mediaType: "image/png", webUrl: "blob:img" },
    ];
    const result = buildSteerAttachments(images);
    expect("webUrl" in result[0]).toBe(false);
  });

  test("leaves fileName undefined when not provided", () => {
    const images: PendingImage[] = [
      { type: "local_image", path: "/tmp/img.png", mediaType: "image/png", webUrl: "blob:img" },
    ];
    expect(buildSteerAttachments(images)[0].fileName).toBeUndefined();
  });

  test("preserves order for multiple images", () => {
    const images: PendingImage[] = [
      { type: "local_image", path: "/a.png", mediaType: "image/png", webUrl: "blob:a" },
      { type: "local_image", path: "/b.jpg", mediaType: "image/jpeg", fileName: "b.jpg", webUrl: "blob:b" },
    ];
    const result = buildSteerAttachments(images);
    expect(result).toHaveLength(2);
    expect(result[0].path).toBe("/a.png");
    expect(result[1].mediaType).toBe("image/jpeg");
  });

  test("returns empty array for no images", () => {
    expect(buildSteerAttachments([])).toEqual([]);
  });
});

// ─── canSteer ────────────────────────────────────────────────────────────────

describe("canSteer", () => {
  test("is false when input is empty", () => {
    expect(makeHook({ activeInput: "", isBusy: true }).canSteer).toBe(false);
  });

  test("is false when thread is not busy", () => {
    expect(makeHook({ activeInput: "hello", isBusy: false }).canSteer).toBe(false);
  });

  test("is false when input is whitespace only", () => {
    expect(makeHook({ activeInput: "   ", isBusy: true }).canSteer).toBe(false);
  });

  test("is true when input has content and thread is busy", () => {
    expect(makeHook({ activeInput: "steer msg", isBusy: true }).canSteer).toBe(true);
  });
});

// ─── steerMessage ────────────────────────────────────────────────────────────

describe("steerMessage", () => {
  test("sends TURN_STEER with trimmed content and mapped attachments", async () => {
    const images: PendingImage[] = [
      { type: "local_image", path: "/img.png", mediaType: "image/png", fileName: "img.png", webUrl: "blob:img" },
    ];
    const hook = makeHook({ activeInput: "  hello  ", isBusy: true, pendingImages: images });
    await hook.steerMessage();

    expect(hook.rpc.request).toHaveBeenCalledTimes(1);
    const [method, params] = hook.rpc.request.mock.calls[0] as [string, Record<string, unknown>];
    expect(method).toBe(DILIGENT_CLIENT_REQUEST_METHODS.TURN_STEER);
    expect(params.threadId).toBe("thread-1");
    expect(params.content).toBe("hello");
    expect(params.followUp).toBe(false);
    expect(params.attachments).toEqual([
      { type: "local_image", path: "/img.png", mediaType: "image/png", fileName: "img.png" },
    ]);
  });

  test("dispatches local_steer action before the RPC call", async () => {
    const dispatchCalls: unknown[] = [];
    const rpcCalls: string[] = [];
    const rpc = {
      request: mock(async (method: string) => {
        rpcCalls.push(method);
      }),
    };
    const dispatch = mock((action: unknown) => {
      dispatchCalls.push(action);
    });

    const hook = useSteeringQueue({
      rpcRef: { current: rpc as never },
      stateRef: { current: { items: [] } as never },
      dispatch,
      activeThreadId: "thread-1",
      currentModelRef: { current: "" },
      activeInput: "steer",
      pendingImages: [],
      isBusy: true,
      clearThreadInput: mock(() => {}),
      clearPendingImages: mock(() => {}),
    });

    await hook.steerMessage();

    expect(dispatchCalls[0]).toEqual({ type: "local_steer", payload: "steer" });
    expect(rpcCalls[0]).toBe(DILIGENT_CLIENT_REQUEST_METHODS.TURN_STEER);
  });

  test("is a no-op when rpc is null", async () => {
    const dispatch = mock(() => {});
    const hook = useSteeringQueue({
      rpcRef: { current: null },
      stateRef: { current: { items: [] } as never },
      dispatch,
      activeThreadId: "thread-1",
      currentModelRef: { current: "" },
      activeInput: "hello",
      pendingImages: [],
      isBusy: true,
      clearThreadInput: mock(() => {}),
      clearPendingImages: mock(() => {}),
    });
    await hook.steerMessage();
    expect(dispatch).not.toHaveBeenCalled();
  });

  test("is a no-op when canSteer is false (not busy)", async () => {
    const hook = makeHook({ activeInput: "hello", isBusy: false });
    await hook.steerMessage();
    expect(hook.rpc.request).not.toHaveBeenCalled();
    expect(hook.dispatch).not.toHaveBeenCalled();
  });
});

// ─── restartFromPendingAbortSteer ─────────────────────────────────────────────

describe("restartFromPendingAbortSteer", () => {
  test("dispatches optimistic_thread when thread has no existing items", async () => {
    const hook = makeHook({ items: [] });
    hook.pendingAbortRestartMessageRef.current = "restart me";
    await hook.restartFromPendingAbortSteer("thread-1");

    const dispatched = hook.dispatch.mock.calls.map((c: unknown[]) => c[0]);
    expect(dispatched).toContainEqual({
      type: "optimistic_thread",
      payload: { threadId: "thread-1", message: "restart me" },
    });
  });

  test("skips optimistic_thread when thread already has items", async () => {
    const hook = makeHook({ items: [{ id: "existing" }] });
    hook.pendingAbortRestartMessageRef.current = "restart me";
    await hook.restartFromPendingAbortSteer("thread-1");

    const dispatched = hook.dispatch.mock.calls.map((c: unknown[]) => c[0]);
    expect(dispatched.some((d: unknown) => (d as { type: string }).type === "optimistic_thread")).toBe(false);
  });

  test("always dispatches consume_first_pending_steer and local_user", async () => {
    const hook = makeHook({ items: [] });
    hook.pendingAbortRestartMessageRef.current = "restart me";
    await hook.restartFromPendingAbortSteer("thread-1");

    const dispatched = hook.dispatch.mock.calls.map((c: unknown[]) => c[0]);
    expect(dispatched).toContainEqual({ type: "consume_first_pending_steer" });
    expect(dispatched).toContainEqual({
      type: "local_user",
      payload: { text: "restart me", images: [] },
    });
  });

  test("clears pendingAbortRestartMessageRef before dispatching to prevent double-fire", async () => {
    let refAtFirstDispatch: string | null = "UNSET" as string | null;
    const dispatch = mock((action: unknown) => {
      if (refAtFirstDispatch === ("UNSET" as string | null)) {
        refAtFirstDispatch = hook.pendingAbortRestartMessageRef.current;
      }
    });
    const hook = useSteeringQueue({
      rpcRef: { current: makeMockRpc() as never },
      stateRef: { current: { items: [] } as never },
      dispatch,
      activeThreadId: "thread-1",
      currentModelRef: { current: "" },
      activeInput: "",
      pendingImages: [],
      isBusy: false,
      clearThreadInput: mock(() => {}),
      clearPendingImages: mock(() => {}),
    });
    hook.pendingAbortRestartMessageRef.current = "restart me";
    await hook.restartFromPendingAbortSteer("thread-1");

    expect(refAtFirstDispatch).toBeNull();
  });

  test("is a no-op when pendingAbortRestartMessageRef is null", async () => {
    const hook = makeHook();
    hook.pendingAbortRestartMessageRef.current = null;
    await hook.restartFromPendingAbortSteer("thread-1");
    expect(hook.dispatch).not.toHaveBeenCalled();
  });

  test("sends TURN_START with the restart message and thread id", async () => {
    const hook = makeHook({ items: [] });
    hook.pendingAbortRestartMessageRef.current = "resume work";
    await hook.restartFromPendingAbortSteer("thread-1");

    expect(hook.rpc.request).toHaveBeenCalledTimes(1);
    const [method, params] = hook.rpc.request.mock.calls[0] as [string, Record<string, unknown>];
    expect(method).toBe(DILIGENT_CLIENT_REQUEST_METHODS.TURN_START);
    expect(params.threadId).toBe("thread-1");
    expect(params.message).toBe("resume work");
    expect(params.content).toEqual([{ type: "text", text: "resume work" }]);
  });
});
