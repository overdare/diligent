// @summary Tests for use-steering-queue: canSteer computation, steerMessage RPC dispatch, abort-restart flow, and image attachments
import { expect, mock, test } from "bun:test";
import { DILIGENT_CLIENT_REQUEST_METHODS } from "@diligent/protocol";
import type { PendingImage } from "../../../src/client/lib/app-state";

// Mock React hooks before the module under test is imported.
// useRef → plain mutable ref; useCallback → identity (returns fn directly).
mock.module("react", () => ({
  useRef: <T>(initial: T): { current: T } => ({ current: initial }),
  useCallback: <T>(fn: T, _deps: unknown[]): T => fn,
}));

const { useSteeringQueue } = await import("../../../src/client/lib/use-steering-queue");

function makeRpc(requestImpl?: (method: string, params: unknown) => Promise<unknown>) {
  return { request: mock(requestImpl ?? (async () => {})) };
}

function makeQueue(overrides: {
  activeInput?: string;
  isBusy?: boolean;
  activeThreadId?: string | null;
  pendingImages?: PendingImage[];
  stateItems?: unknown[];
}) {
  const rpcRef = { current: makeRpc() };
  const stateRef = { current: { items: overrides.stateItems ?? [] } };
  const dispatch = mock(() => {});
  const clearThreadInput = mock(() => {});
  const clearPendingImages = mock(() => {});

  const result = useSteeringQueue({
    rpcRef,
    stateRef,
    dispatch,
    activeThreadId: overrides.activeThreadId ?? "thread-1",
    currentModelRef: { current: "claude-3" },
    activeInput: overrides.activeInput ?? "hello",
    pendingImages: overrides.pendingImages ?? [],
    isBusy: overrides.isBusy ?? true,
    clearThreadInput,
    clearPendingImages,
  });

  return { ...result, rpcRef, stateRef, dispatch, clearThreadInput, clearPendingImages };
}

// ─── canSteer ────────────────────────────────────────────────────────────────

test("canSteer is true when activeInput has non-whitespace content and thread is busy", () => {
  const { canSteer } = makeQueue({ activeInput: "hello", isBusy: true });
  expect(canSteer).toBe(true);
});

test("canSteer is false when activeInput is empty", () => {
  const { canSteer } = makeQueue({ activeInput: "", isBusy: true });
  expect(canSteer).toBe(false);
});

test("canSteer is false when activeInput is only whitespace", () => {
  const { canSteer } = makeQueue({ activeInput: "   ", isBusy: true });
  expect(canSteer).toBe(false);
});

test("canSteer is false when thread is not busy", () => {
  const { canSteer } = makeQueue({ activeInput: "hello", isBusy: false });
  expect(canSteer).toBe(false);
});

// ─── steerMessage ────────────────────────────────────────────────────────────

test("steerMessage sends TURN_STEER RPC with trimmed content and followUp: false", async () => {
  const { steerMessage, rpcRef } = makeQueue({ activeInput: "  send this  ", isBusy: true });

  await steerMessage();

  expect(rpcRef.current.request).toHaveBeenCalledTimes(1);
  const [method, params] = rpcRef.current.request.mock.calls[0] as [string, Record<string, unknown>];
  expect(method).toBe(DILIGENT_CLIENT_REQUEST_METHODS.TURN_STEER);
  expect(params.threadId).toBe("thread-1");
  expect(params.content).toBe("send this");
  expect(params.followUp).toBe(false);
});

test("steerMessage dispatches local_steer with trimmed content before the RPC call", async () => {
  const { steerMessage, dispatch } = makeQueue({ activeInput: "hello world", isBusy: true });

  await steerMessage();

  expect(dispatch).toHaveBeenCalledWith({ type: "local_steer", payload: "hello world" });
});

test("steerMessage clears thread input and pending images", async () => {
  const { steerMessage, clearThreadInput, clearPendingImages } = makeQueue({
    activeInput: "hello",
    isBusy: true,
  });

  await steerMessage();

  expect(clearThreadInput).toHaveBeenCalledWith("thread-1");
  expect(clearPendingImages).toHaveBeenCalledTimes(1);
});

test("steerMessage is a no-op when canSteer is false (not busy)", async () => {
  const { steerMessage, rpcRef, dispatch } = makeQueue({ activeInput: "hello", isBusy: false });

  await steerMessage();

  expect(rpcRef.current.request).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
});

test("steerMessage is a no-op when activeThreadId is null", async () => {
  const { steerMessage, rpcRef } = makeQueue({ activeInput: "hello", isBusy: true, activeThreadId: null });

  await steerMessage();

  expect(rpcRef.current.request).not.toHaveBeenCalled();
});

test("steerMessage includes image attachments in the RPC request", async () => {
  const images: PendingImage[] = [
    { path: "/tmp/img.png", mediaType: "image/png", fileName: "img.png" },
  ];
  const { steerMessage, rpcRef } = makeQueue({ activeInput: "with image", isBusy: true, pendingImages: images });

  await steerMessage();

  const [, params] = rpcRef.current.request.mock.calls[0] as [string, Record<string, unknown>];
  expect(params.attachments).toEqual([{ type: "local_image", path: "/tmp/img.png", mediaType: "image/png", fileName: "img.png" }]);
});

test("steerMessage sends empty attachments array when no pending images", async () => {
  const { steerMessage, rpcRef } = makeQueue({ activeInput: "no images", isBusy: true, pendingImages: [] });

  await steerMessage();

  const [, params] = rpcRef.current.request.mock.calls[0] as [string, Record<string, unknown>];
  expect(params.attachments).toEqual([]);
});

// ─── restartFromPendingAbortSteer ─────────────────────────────────────────────

test("restartFromPendingAbortSteer sends TURN_START with the pending message", async () => {
  const { restartFromPendingAbortSteer, rpcRef, pendingAbortRestartMessageRef } = makeQueue({
    isBusy: false,
    stateItems: [],
  });

  pendingAbortRestartMessageRef.current = "resume this";
  await restartFromPendingAbortSteer("thread-1");

  expect(rpcRef.current.request).toHaveBeenCalledTimes(1);
  const [method, params] = rpcRef.current.request.mock.calls[0] as [string, Record<string, unknown>];
  expect(method).toBe(DILIGENT_CLIENT_REQUEST_METHODS.TURN_START);
  expect(params.threadId).toBe("thread-1");
  expect(params.message).toBe("resume this");
});

test("restartFromPendingAbortSteer dispatches consume_first_pending_steer and local_user", async () => {
  const { restartFromPendingAbortSteer, dispatch, pendingAbortRestartMessageRef } = makeQueue({
    isBusy: false,
    stateItems: [],
  });

  pendingAbortRestartMessageRef.current = "continue after abort";
  await restartFromPendingAbortSteer("thread-1");

  const calls = dispatch.mock.calls.map((c) => c[0]);
  expect(calls).toContainEqual({ type: "consume_first_pending_steer" });
  expect(calls).toContainEqual({ type: "local_user", payload: { text: "continue after abort", images: [] } });
});

test("restartFromPendingAbortSteer clears pendingAbortRestartMessageRef after use", async () => {
  const { restartFromPendingAbortSteer, pendingAbortRestartMessageRef } = makeQueue({ isBusy: false });

  pendingAbortRestartMessageRef.current = "some message";
  await restartFromPendingAbortSteer("thread-1");

  expect(pendingAbortRestartMessageRef.current).toBeNull();
});

test("restartFromPendingAbortSteer is a no-op when pendingAbortRestartMessageRef is null", async () => {
  const { restartFromPendingAbortSteer, rpcRef, dispatch } = makeQueue({ isBusy: false });

  // pendingAbortRestartMessageRef.current starts as null (from mocked useRef)
  await restartFromPendingAbortSteer("thread-1");

  expect(rpcRef.current.request).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
});

test("restartFromPendingAbortSteer dispatches optimistic_thread when there are no existing items", async () => {
  const { restartFromPendingAbortSteer, dispatch, pendingAbortRestartMessageRef } = makeQueue({
    isBusy: false,
    stateItems: [],
  });

  pendingAbortRestartMessageRef.current = "first message";
  await restartFromPendingAbortSteer("thread-1");

  const calls = dispatch.mock.calls.map((c) => c[0]);
  expect(calls).toContainEqual({
    type: "optimistic_thread",
    payload: { threadId: "thread-1", message: "first message" },
  });
});

test("restartFromPendingAbortSteer skips optimistic_thread when there are existing items", async () => {
  const { restartFromPendingAbortSteer, dispatch, pendingAbortRestartMessageRef } = makeQueue({
    isBusy: false,
    stateItems: [{ kind: "user" }],
  });

  pendingAbortRestartMessageRef.current = "follow-up";
  await restartFromPendingAbortSteer("thread-1");

  const types = dispatch.mock.calls.map((c) => (c[0] as { type: string }).type);
  expect(types).not.toContain("optimistic_thread");
});
