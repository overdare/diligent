// @summary React hook for steering queue state: pending steers, abort-restart, and suppress-injected logic
import { DILIGENT_CLIENT_REQUEST_METHODS } from "@diligent/protocol";
import type { RefObject } from "react";
import { useCallback, useRef } from "react";
import type { WebRpcClient } from "./rpc-client";
import type { ThreadState } from "./thread-store";

type SteeringAction =
  | { type: "local_steer"; payload: string }
  | { type: "consume_first_pending_steer" }
  | { type: "local_user"; payload: { text: string; images: [] } }
  | { type: "optimistic_thread"; payload: { threadId: string; message: string } };

export function useSteeringQueue({
  rpcRef,
  stateRef,
  dispatch,
  activeThreadId,
  currentModelRef,
  activeInput,
  isBusy,
  clearThreadInput,
}: {
  rpcRef: RefObject<WebRpcClient | null>;
  stateRef: RefObject<ThreadState>;
  dispatch: (action: SteeringAction) => void;
  activeThreadId: string | null;
  currentModelRef: RefObject<string>;
  activeInput: string;
  isBusy: boolean;
  clearThreadInput: (threadId: string) => void;
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
      const hadItemsBeforeRestart = stateRef.current.items.length > 0;
      dispatch({ type: "consume_first_pending_steer" });
      dispatch({ type: "local_user", payload: { text: restartMessage, images: [] } });
      if (!hadItemsBeforeRestart) {
        dispatch({
          type: "optimistic_thread",
          payload: { threadId, message: restartMessage },
        });
      }

      await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_START, {
        threadId,
        message: restartMessage,
        content: [{ type: "text" as const, text: restartMessage }],
        model: currentModelRef.current || undefined,
      });
    },
    [rpcRef, stateRef, dispatch, currentModelRef],
  );

  const steerMessage = useCallback(async (): Promise<void> => {
    const rpc = rpcRef.current;
    if (!rpc || !activeThreadId || !canSteer) return;
    const threadId = activeThreadId;
    const content = activeInput.trim();
    clearThreadInput(threadId);
    dispatch({ type: "local_steer", payload: content });
    try {
      await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_STEER, {
        threadId,
        content,
        followUp: false,
      });
    } catch (error) {
      console.error(error);
    }
  }, [rpcRef, activeThreadId, canSteer, activeInput, clearThreadInput, dispatch]);

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
