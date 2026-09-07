// @summary React hook for steering queue state: pending steers and queue edits

import { createLogger } from "@diligent/logging";
import type { PendingSteer } from "@diligent/protocol";
import { DILIGENT_CLIENT_REQUEST_METHODS } from "@diligent/protocol";
import type { RefObject } from "react";
import { useCallback } from "react";
import { type AgentContextItem, prependContextToMessage } from "./agent-native-bridge";
import type { PendingImage } from "./app-state";
import type { WebRpcClient } from "./rpc-client";
import { createUuidV4 } from "./uuid";

const logger = createLogger({ scope: "web.client.steering" });

type SteeringAction =
  | { type: "local_steer"; payload: PendingSteer }
  | { type: "cancel_pending_steer"; payload: { steerId: string } }
  | { type: "update_pending_steer"; payload: { steerId: string; content: string } };

export async function executeSteer({
  rpc,
  threadId,
  content,
  images,
  contextItems,
  dispatch,
  clearThreadInput,
  clearPendingImages,
  clearContextItems,
}: {
  rpc: WebRpcClient;
  threadId: string;
  content: string;
  images: PendingImage[];
  contextItems: AgentContextItem[];
  dispatch: (action: SteeringAction) => void;
  clearThreadInput: (threadId: string) => void;
  clearPendingImages: () => void;
  clearContextItems: () => void;
}): Promise<void> {
  const steerId = createClientSteerId();
  const message = prependContextToMessage(content, contextItems);
  clearThreadInput(threadId);
  clearPendingImages();
  clearContextItems();
  dispatch({
    type: "local_steer",
    payload: {
      id: steerId,
      content: message,
      ...(images.length ? { attachments: images.map(({ webUrl, ...image }) => image) } : {}),
    },
  });
  try {
    await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_STEER, {
      threadId,
      steerId,
      content: message,
      attachments: images.map((image) => ({
        type: "local_image" as const,
        path: image.path,
        mediaType: image.mediaType,
        fileName: image.fileName,
      })),
      followUp: false,
    });
  } catch (error) {
    dispatch({ type: "cancel_pending_steer", payload: { steerId } });
    logger.error("steer.send_failed", {
      message: "Failed to send steer",
      error,
      threadId,
      fields: { steerId },
    });
  }
}

export async function executeCancelSteer({
  rpc,
  threadId,
  steerId,
  dispatch,
}: {
  rpc: WebRpcClient;
  threadId: string;
  steerId: string;
  dispatch: (action: SteeringAction) => void;
}): Promise<void> {
  const result = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_STEER_CANCEL, { threadId, steerId });
  if (result.cancelled) dispatch({ type: "cancel_pending_steer", payload: { steerId } });
}

export async function executeUpdateSteer({
  rpc,
  threadId,
  steerId,
  content,
  dispatch,
}: {
  rpc: WebRpcClient;
  threadId: string;
  steerId: string;
  content: string;
  dispatch: (action: SteeringAction) => void;
}): Promise<void> {
  const result = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_STEER_UPDATE, {
    threadId,
    steerId,
    content,
  });
  if (result.updated) dispatch({ type: "update_pending_steer", payload: { steerId, content } });
}

export function useSteeringQueue({
  rpcRef,
  dispatch,
  activeThreadId,
  activeInput,
  pendingImages,
  contextItems,
  isBusy,
  clearThreadInput,
  clearPendingImages,
  clearContextItems,
}: {
  rpcRef: RefObject<WebRpcClient | null>;
  dispatch: (action: SteeringAction) => void;
  activeThreadId: string | null;
  activeInput: string;
  pendingImages: PendingImage[];
  contextItems: AgentContextItem[];
  isBusy: boolean;
  clearThreadInput: (threadId: string) => void;
  clearPendingImages: () => void;
  clearContextItems: () => void;
}) {
  const canSteer = (activeInput.trim().length > 0 || contextItems.length > 0) && isBusy;

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
      contextItems,
      dispatch,
      clearThreadInput,
      clearPendingImages,
      clearContextItems,
    });
  }, [
    rpcRef,
    activeThreadId,
    canSteer,
    activeInput,
    pendingImages,
    contextItems,
    clearThreadInput,
    clearPendingImages,
    clearContextItems,
    dispatch,
  ]);

  const handleSteer = useCallback(() => {
    void steerMessage();
  }, [steerMessage]);

  const cancelSteer = useCallback(
    (steerId: string) => {
      const rpc = rpcRef.current;
      if (!rpc || !activeThreadId) return;
      void executeCancelSteer({ rpc, threadId: activeThreadId, steerId, dispatch }).catch((error) => {
        logger.error("steer.cancel_failed", {
          message: "Failed to cancel steer",
          error,
          threadId: activeThreadId,
          fields: { steerId },
        });
      });
    },
    [rpcRef, activeThreadId, dispatch],
  );

  const updateSteer = useCallback(
    (steerId: string, content: string) => {
      const rpc = rpcRef.current;
      if (!rpc || !activeThreadId) return;
      void executeUpdateSteer({ rpc, threadId: activeThreadId, steerId, content, dispatch }).catch((error) => {
        logger.error("steer.update_failed", {
          message: "Failed to update steer",
          error,
          threadId: activeThreadId,
          fields: { steerId },
        });
      });
    },
    [rpcRef, activeThreadId, dispatch],
  );

  return {
    canSteer,
    steerMessage,
    handleSteer,
    cancelSteer,
    updateSteer,
  };
}

function createClientSteerId(): string {
  return `steer-${createUuidV4()}`;
}
