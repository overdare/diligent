// @summary App lifecycle hooks for RPC notification wiring and bootstrap resume flow

import { createLogger } from "@diligent/logging";
import type {
  DiligentServerNotification,
  DiligentServerRequest,
  InitializeResponse,
  ModelRef,
  PendingSteer,
  ProviderAuthStatus,
  SessionSummary,
  SkillInfo,
  ThinkingEffort,
} from "@diligent/protocol";
import {
  DILIGENT_CLIENT_NOTIFICATION_METHODS,
  DILIGENT_SERVER_NOTIFICATION_METHODS,
  DILIGENT_VERSION,
} from "@diligent/protocol";
import { type Dispatch, type MutableRefObject, type RefObject, type SetStateAction, useEffect } from "react";
import type { ConsentState } from "../../shared/consent-protocol";
import {
  deriveAgentEvents,
  hasInFlightRenderItems,
  shouldMarkAttentionThread,
  shouldRehydrateAfterIdleStatus,
  toNotificationParams,
} from "./app-notification";
import type { AppAction } from "./app-state";
import { getThreadIdFromUrl, replaceDraftUrl } from "./app-utils";
import type { WebRpcClient } from "./rpc-client";
import type { ThreadState } from "./thread-store";

const logger = createLogger({ scope: "web.client.lifecycle" });

type WebInitializeResponse = InitializeResponse & { consent?: ConsentState };

function hasNotificationThreadId(params: unknown): params is { threadId: string } {
  return typeof (params as { threadId?: unknown } | null)?.threadId === "string";
}

export function shouldDispatchNotificationToActiveThread(
  notification: DiligentServerNotification,
  activeThreadId: string | null,
): boolean {
  if (!hasNotificationThreadId(notification.params)) {
    return true;
  }
  // Identity notifications can arrive before thread/read hydration. Dispatch
  // them only for the current thread so hydrate actions remain the single path
  // that swaps MessageList history during thread changes.
  if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STARTED) {
    return notification.params.threadId === activeThreadId;
  }
  if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_RESUMED) {
    return notification.params.threadId === activeThreadId;
  }
  if (activeThreadId === null) {
    return false;
  }
  return notification.params.threadId === activeThreadId;
}

type SteeringRefs = {
  pendingAbortRestartSteerRef: MutableRefObject<PendingSteer | null>;
  restartFromPendingAbortSteer: (threadId: string) => Promise<void>;
};

export function useAppRpcBindings({
  rpcRef,
  activeThreadIdRef,
  stateRef,
  dispatch,
  refreshThreadList,
  refreshThreadHistory,
  onAccountLoginCompleted,
  onAccountUpdated,
  onMcpLoginCompleted,
  markAttention,
  onBackgroundNotification,
  handleServerRequest,
  steering,
  setOauthPending,
  setOauthError,
}: {
  rpcRef: RefObject<WebRpcClient | null>;
  activeThreadIdRef: RefObject<string | null>;
  stateRef: RefObject<ThreadState>;
  dispatch: Dispatch<AppAction>;
  refreshThreadList: (rpc?: WebRpcClient | null) => Promise<unknown>;
  refreshThreadHistory: (threadId: string) => Promise<void>;
  onAccountLoginCompleted: (params: { loginId: string | null; success: boolean; error: string | null }) => void;
  onAccountUpdated: (params: { providers: ProviderAuthStatus[] }) => Promise<void>;
  onMcpLoginCompleted: (params: { server: string; success: boolean; error: string | null }) => void;
  markAttention: (threadId: string) => void;
  onBackgroundNotification: (notification: DiligentServerNotification) => void;
  handleServerRequest: (requestId: number, request: DiligentServerRequest) => void;
  steering: SteeringRefs;
  setOauthPending: Dispatch<SetStateAction<boolean>>;
  setOauthError: Dispatch<SetStateAction<string | null>>;
}) {
  useEffect(() => {
    const rpc = rpcRef.current;
    if (!rpc) return;

    rpc.onNotification((notification) => {
      const notificationParams = toNotificationParams(notification);

      if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.ACCOUNT_LOGIN_COMPLETED) {
        const params = notification.params;
        if (params.success) {
          setOauthPending(false);
          setOauthError(null);
        } else {
          setOauthPending(false);
          setOauthError(params.error ?? "OAuth flow failed");
        }
        onAccountLoginCompleted(params);
        return;
      }

      if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.ACCOUNT_UPDATED) {
        void onAccountUpdated(notification.params);
        return;
      }

      if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.MCP_LOGIN_COMPLETED) {
        onMcpLoginCompleted({
          server: notification.params.server,
          success: notification.params.success,
          error: notification.params.error ?? null,
        });
        return;
      }

      const attentionThreadId = shouldMarkAttentionThread(notification, notificationParams, activeThreadIdRef.current);
      if (attentionThreadId) {
        markAttention(attentionThreadId);
      }

      if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED) {
        onBackgroundNotification(notification);
      }

      if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED) {
        if (!notificationParams) {
          return;
        }
        void refreshThreadList(rpc);

        const rehydrateThreadId = shouldRehydrateAfterIdleStatus(
          notification,
          notificationParams,
          hasInFlightRenderItems(stateRef.current.items),
          activeThreadIdRef.current,
        );
        if (rehydrateThreadId) {
          void refreshThreadHistory(rehydrateThreadId);
        }
      }

      const events = deriveAgentEvents(notification);
      if (shouldDispatchNotificationToActiveThread(notification, activeThreadIdRef.current)) {
        dispatch({ type: "notification", payload: { notification, events } });
      }

      if (
        notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_INTERRUPTED &&
        notificationParams &&
        typeof notificationParams.threadId === "string" &&
        notificationParams.threadId === activeThreadIdRef.current &&
        steering.pendingAbortRestartSteerRef.current
      ) {
        const interruptedThreadId = notificationParams.threadId;
        queueMicrotask(() => {
          void steering.restartFromPendingAbortSteer(interruptedThreadId);
        });
      }
    });

    rpc.onServerRequest((requestId, request) => handleServerRequest(requestId, request));
  }, [
    rpcRef,
    activeThreadIdRef,
    stateRef,
    dispatch,
    refreshThreadList,
    refreshThreadHistory,
    onAccountLoginCompleted,
    onAccountUpdated,
    onMcpLoginCompleted,
    markAttention,
    onBackgroundNotification,
    handleServerRequest,
    steering,
    setOauthPending,
    setOauthError,
  ]);
}

export function useAppBootstrap({
  connection,
  rpcRef,
  activeThreadIdRef,
  dispatch,
  setCwd,
  setEffortState,
  setFastModeState,
  setSkills,
  setRuntimeVersion,
  setGoalsSupported,
  setConsent,
  setInitialModel,
  openThread,
  refreshThreadList,
  refreshProviders,
}: {
  connection: "connecting" | "connected" | "reconnecting" | "disconnected";
  rpcRef: RefObject<WebRpcClient | null>;
  activeThreadIdRef: RefObject<string | null>;
  dispatch: Dispatch<AppAction>;
  setCwd: Dispatch<SetStateAction<string>>;
  setEffortState: Dispatch<SetStateAction<ThinkingEffort>>;
  setFastModeState: Dispatch<SetStateAction<boolean>>;
  setSkills: Dispatch<SetStateAction<SkillInfo[]>>;
  setRuntimeVersion: Dispatch<SetStateAction<string>>;
  setGoalsSupported: Dispatch<SetStateAction<boolean>>;
  setConsent: (consent: ConsentState | null) => void;
  setInitialModel: (model: ModelRef | undefined, models?: InitializeResponse["availableModels"]) => void;
  openThread: (threadId: string) => Promise<void>;
  refreshThreadList: (rpc?: WebRpcClient | null) => Promise<SessionSummary[] | undefined>;
  refreshProviders: (rpc?: WebRpcClient | null) => Promise<void>;
}) {
  useEffect(() => {
    if (connection !== "connected") {
      return;
    }

    const rpc = rpcRef.current;
    if (!rpc) return;

    let cancelled = false;
    let userInteracted = false;
    const initialThreadId = activeThreadIdRef.current;
    const initialUrlThreadId = getThreadIdFromUrl();
    const stopRestoring = () => {
      userInteracted = true;
    };
    const interactionEvents = ["pointerdown", "keydown", "input", "drop"] as const;
    for (const event of interactionEvents) window.addEventListener(event, stopRestoring, true);
    const canRestore = () =>
      !cancelled &&
      !userInteracted &&
      activeThreadIdRef.current === initialThreadId &&
      getThreadIdFromUrl() === initialUrlThreadId;

    const bootstrap = async (): Promise<void> => {
      try {
        const meta = (await rpc.initialize({
          clientName: "diligent-web",
          clientVersion: DILIGENT_VERSION,
          protocolVersion: 1,
        })) as WebInitializeResponse;
        if (cancelled) return;

        setCwd(meta.cwd ?? "");
        setEffortState(meta.effort ?? "medium");
        setFastModeState(meta.fastMode ?? false);
        setSkills(meta.skills ?? []);
        setRuntimeVersion(meta.serverVersion ?? "");
        setGoalsSupported(meta.capabilities.goals === true);
        setConsent(meta.consent ?? null);
        setInitialModel(meta.currentModel, meta.availableModels ?? []);
        rpc.notify(DILIGENT_CLIENT_NOTIFICATION_METHODS.INITIALIZED, { ready: true });

        // Provider readiness and the composer must not wait for session storage.
        void refreshProviders(rpc);
        const listing = refreshThreadList(rpc);
        const selectedThreadId = initialThreadId ?? initialUrlThreadId;
        if (selectedThreadId && canRestore()) {
          await openThread(selectedThreadId);
          return;
        }

        // Reuse the sidebar scan instead of issuing a second full-history lookup.
        const threads = await listing;
        if (!canRestore()) return;
        const latest = threads?.[0];
        if (latest) {
          await openThread(latest.id);
          return;
        }
        if (!canRestore()) return;
        dispatch({ type: "reset_draft", payload: { mode: "default" } });
        replaceDraftUrl();
      } catch (error) {
        if (!cancelled)
          dispatch({
            type: "show_info_toast",
            payload: error instanceof Error ? error.message : "Could not restore conversation.",
          });
        logger.error("bootstrap.failed", {
          message: "Failed to bootstrap Diligent web client",
          error,
        });
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
      for (const event of interactionEvents) window.removeEventListener(event, stopRestoring, true);
    };
  }, [
    connection,
    rpcRef,
    activeThreadIdRef,
    dispatch,
    setCwd,
    setEffortState,
    setFastModeState,
    setSkills,
    setRuntimeVersion,
    setGoalsSupported,
    setConsent,
    setInitialModel,
    openThread,
    refreshThreadList,
    refreshProviders,
  ]);
}
