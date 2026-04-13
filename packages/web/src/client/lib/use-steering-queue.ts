// @summary React hook for steering queue state: pending steers, abort-restart, and suppress-injected logic
import { DILIGENT_CLIENT_REQUEST_METHODS } from "@diligent/protocol";
import type { RefObject } from "react";
import { useCallback, useRef } from "react";
import type { PendingImage } from "./app-state";
import type { WebRpcClient } from "./rpc-client";
import type { ThreadState } from "./thread-store";

type SteeringAction =
  | { type: "local_steer"; payload: string }
  | { type: "consume_first_pending_steer" }
  | { type: "local_user"; payload: { text: string; images: PendingImage[] } }
  | { type: "optimistic_thread"; payload: { threadId: string; message: string } };

export async function executeSteer({
  rpc,
  threadId,
  content,
  images,
  dispatch,
  clearThreadInput,
  clearPendingImages,
}: {
  rpc: WebRpcClient;
  threadId: string;
  content: string;
  images: PendingImage[];
  dispatch: (action: SteeringAction) => void;
  clearThreadInput: (threadId: string) => void;
  clearPendingImages: () => void;
}): Promise<void> {
  clearThreadInput(threadId);
  clearPendingImages();
  dispatch({ type: "local_steer", payload: content });
  try {
    await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_STEER, {
      threadId,
      content,
      attachments: images.map((image) => ({
        type: "local_image" as const,
        path: image.path,
        mediaType: image.mediaType,
        fileName: image.fileName,
      })),
      followUp: false,
    });
  } catch (error) {
    console.error(error);
  }
}

export async function executeRestartFromAbort({
  rpc,
  threadId,
  restartMessage,
  hadItemsBeforeRestart,
  model,
  dispatch,
}: {
  rpc: WebRpcClient;
  threadId: string;
  restartMessage: string;
  hadItemsBeforeRestart: boolean;
  model: string | undefined;
  dispatch: (action: SteeringAction) => void;
}): Promise<void> {
  dispatch({ type: "consume_first_pending_steer" });
  dispatch({ type: "local_user", payload: { text: restartMessage, images: [] } });
  if (!hadItemsBeforeRestart) {
    dispatch({ type: "optimistic_thread", payload: { threadId, message: restartMessage } });
  }
  await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_START, {
    threadId,
    message: restartMessage,
    content: [{ type: "text" as const, text: restartMessage }],
    model,
  });
}

export function useSteeringQueue({
  rpcRef,
  stateRef,
  dispatch,
  activeThreadId,
  currentModelRef,
  activeInput,
  pendingImages,
  isBusy,
  clearThreadInput,
  clearPendingImages,
}: {
  rpcRef: RefObject<WebRpcClient | null>;
  stateRef: RefObject<ThreadState>;
  dispatch: (action: SteeringAction) => void;
  activeThreadId: string | null;
  currentModelRef: RefObject<string>;
  activeInput: string;
  pendingImages: PendingImage[];
  isBusy: boolean;
  clearThreadInput: (threadId: string) => void;
  clearPendingImages: () => void;
}) {
  const pendingAbortRestartMessageRef = useRef<string | null>(null);
  const suppressNextSteeringInjectedRef = useRef(false);

  const canSteer = activeInput.trim().length > 0 && isBusy;

  const restartFromPendingAbortSteer = useCallback(
    async (threadId: string): Promise<void> => {
      const rpc = rpcRef.current;
      const restartMessage = pendingAbortRestartMessageRef.current;
      if (!rpc || !restartMessage) {
        return;
      }

      pendingAbortRestartMessageRef.current = null;
      await executeRestartFromAbort({
        rpc,
        threadId,
        restartMessage,
        hadItemsBeforeRestart: stateRef.current.items.length > 0,
        model: currentModelRef.current || undefined,
        dispatch,
      });
    },
    [rpcRef, stateRef, dispatch, currentModelRef],
  );

  const steerMessage = useCallback(async (): Promise<void> => {
    const rpc = rpcRef.current;
    if (!rpc || !activeThreadId || !canSteer) return;
    const threadId = activeThreadId;
    const content = activeInput.trim();
    const images = pendingImages;
    await executeSteer({
      rpc,
      threadId,
      content,
      images,
      dispatch,
      clearThreadInput,
      clearPendingImages,
    });
  }, [rpcRef, activeThreadId, canSteer, activeInput, pendingImages, clearThreadInput, clearPendingImages, dispatch]);

  const handleSteer = useCallback(() => {
    void steerMessage();
  }, [steerMessage]);

  return {
    canSteer,
    pendingAbortRestartMessageRef,
    suppressNextSteeringInjectedRef,
    restartFromPendingAbortSteer,
    steerMessage,
    handleSteer,
  };
}
