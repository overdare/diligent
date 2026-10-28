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
  DILIGENT_CLIENT_REQUEST_METHODS,
  DILIGENT_SERVER_NOTIFICATION_METHODS,
  DILIGENT_VERSION,
} from "@diligent/protocol";
import { startGoalSync } from "@diligent/runtime/client";
import { type Dispatch, type MutableRefObject, type RefObject, type SetStateAction, useEffect } from "react";
import { type ConsentState, ConsentStateSchema, WEB_CONSENT_GET_METHOD } from "../../shared/consent-protocol";
import {
  deriveAgentEvents,
  hasInFlightRenderItems,
  shouldMarkAttentionThread,
  shouldRehydrateAfterIdleStatus,
  toNotificationParams,
} from "./app-notification";
import type { AppAction } from "./app-state";
import { getThreadIdFromUrl, readLastThreadId, replaceDraftUrl } from "./app-utils";
import type { WebRpcClient } from "./rpc-client";
import type { ThreadState } from "./thread-store";
import type { OpenThreadOptions } from "./use-thread-manager";

const logger = createLogger({ scope: "web.client.lifecycle" });

export function useGoalReconciliation(
  rpcRef: RefObject<WebRpcClient | null>,
  threadId: string | null,
  connected: boolean,
  enabled: boolean,
  dispatch: Dispatch<AppAction>,
) {
  useEffect(() => {
    const rpc = rpcRef.current;
    if (!rpc || !connected || !enabled || !threadId) return;
    const sync = startGoalSync({
      currentThreadId: () => threadId,
      read: (id) => rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_GOAL_GET, { threadId: id }),
      publish: (id, snapshot) => dispatch({ type: "set_goal_snapshot", payload: { threadId: id, ...snapshot } }),
      onError: (error) => logger.debug("goal.sync_failed", { message: "Goal state sync unavailable", error }),
    });
    const refresh = () => {
      void sync.refresh();
    };
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      sync.dispose();
    };
  }, [rpcRef, threadId, connected, enabled, dispatch]);
}

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
  openThread: (threadId: string, options?: OpenThreadOptions) => Promise<boolean>;
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
        // initialize can wait on remote consent checks; session storage reads must not queue behind it.
        const initialized = rpc
          .initialize({
            clientName: "diligent-web",
            clientVersion: DILIGENT_VERSION,
            protocolVersion: 1,
          })
          .then((result) => {
            const meta = result as WebInitializeResponse;
            if (cancelled) return;
            setCwd(meta.cwd ?? "");
            setEffortState(meta.effort ?? "medium");
            setFastModeState(meta.fastMode ?? false);
            setSkills(meta.skills ?? []);
            setRuntimeVersion(meta.serverVersion ?? "");
            setGoalsSupported(meta.capabilities.goals === true);
            if (meta.consent) setConsent(meta.consent);
            setInitialModel(meta.currentModel, meta.availableModels ?? []);
            rpc.notify(DILIGENT_CLIENT_NOTIFICATION_METHODS.INITIALIZED, { ready: true });
            // The gateway sync is off the initialize path; until it lands the first-run notice stays hidden.
            void rpc
              .requestRaw(WEB_CONSENT_GET_METHOD, {})
              .then((value) => {
                if (!cancelled) setConsent(ConsentStateSchema.parse(value));
              })
              .catch((error) => {
                logger.debug("consent.sync_failed", { message: "Consent sync unavailable", error });
              });
            // Provider readiness and the composer must not wait for session storage.
            void refreshProviders(rpc);
          });

        let listing: Promise<SessionSummary[] | undefined> | undefined;
        const startListing = () => {
          listing ??= refreshThreadList(rpc);
          return listing;
        };
        const requestedThreadId = initialThreadId ?? initialUrlThreadId;
        const selectedThreadId = requestedThreadId ?? readLastThreadId();
        if (selectedThreadId && canRestore()) {
          // The opened conversation gets session storage first; the sidebar scan waits until it is ready,
          // since on a network drive the scan would otherwise hold the disk the history reads need.
          // Session model/effort must land after initialize's defaults, never under them.
          const shown = await openThread(selectedThreadId, {
            beforeMetadata: initialized,
            quietIfUnavailable: !requestedThreadId,
          });
          // A requested conversation that failed keeps its error on screen instead of switching away.
          if (shown || requestedThreadId) {
            startListing();
            await initialized;
            return;
          }
        }
        startListing();
        await initialized;
        if (cancelled) return;

        // Reuse the sidebar scan instead of issuing a second full-history lookup.
        const threads = await startListing();
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
