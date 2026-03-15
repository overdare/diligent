// @summary Main application orchestrator: state management, RPC lifecycle, and inline prompt handling

import type {
  DiligentServerNotification,
  InitializeResponse,
  KnowledgeEntry,
  KnowledgeUpdateParams,
  LocalImageBlock,
  Mode,
  SessionSummary,
  SkillInfo,
  ThinkingEffort,
  ThreadReadResponse,
  ToolsListResponse,
  ToolsSetParams,
  ToolsSetResponse,
} from "@diligent/protocol";
import {
  DILIGENT_CLIENT_NOTIFICATION_METHODS,
  DILIGENT_CLIENT_REQUEST_METHODS,
  DILIGENT_SERVER_NOTIFICATION_METHODS,
  DILIGENT_SERVER_REQUEST_METHODS,
  DILIGENT_VERSION,
} from "@diligent/protocol";
import type { AgentEvent } from "@diligent/runtime/client";
import { findModelInfo, getThinkingEffortUsage, supportsThinkingNone } from "@diligent/runtime/client";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Button } from "./components/Button";
import { InputDock } from "./components/InputDock";
import { KnowledgeManagerModal } from "./components/KnowledgeManagerModal";
import { MessageList } from "./components/MessageList";
import { Modal } from "./components/Modal";
import { Panel } from "./components/Panel";
import { PlanPanel } from "./components/PlanPanel";
import { ProviderSettingsModal } from "./components/ProviderSettingsModal";
import { Sidebar } from "./components/Sidebar";
import { StatusDot } from "./components/StatusDot";
import { SteeringQueuePanel } from "./components/SteeringQueuePanel";
import { ToolSettingsModal } from "./components/ToolSettingsModal";
import { getReconnectAttemptLimit } from "./lib/rpc-client";
import type { SlashCommand } from "./lib/slash-commands";
import { buildCommandList, parseSlashCommand } from "./lib/slash-commands";
import {
  hydrateFromThreadRead,
  initialThreadState,
  type RenderItem,
  reduceServerNotification,
  type ThreadState,
} from "./lib/thread-store";
import { useProviderManager } from "./lib/use-provider-manager";
import { useRpcClient } from "./lib/use-rpc";
import { useServerRequests } from "./lib/use-server-requests";
import { useThreadManager } from "./lib/use-thread-manager";

type PendingImage = LocalImageBlock & { webUrl: string };

const MANUAL_COMPACTION_TOAST = "Manual compaction in progress…";

type AppAction =
  | { type: "notification"; payload: { notification: DiligentServerNotification; events: AgentEvent[] } }
  | { type: "hydrate"; payload: { threadId: string; mode: Mode; history: ThreadReadResponse } }
  | { type: "set_threads"; payload: SessionSummary[] }
  | { type: "set_mode"; payload: Mode }
  | { type: "local_user"; payload: { text: string; images: PendingImage[] } }
  | { type: "local_steer"; payload: string }
  | { type: "optimistic_thread"; payload: { threadId: string; message: string } }
  | { type: "show_info_toast"; payload: string }
  | { type: "clear_toast" };

function appReducer(state: ThreadState, action: AppAction): ThreadState {
  if (action.type === "notification")
    return reduceServerNotification(state, action.payload.notification, action.payload.events);
  if (action.type === "hydrate") {
    return hydrateFromThreadRead(
      { ...state, activeThreadId: action.payload.threadId, mode: action.payload.mode },
      action.payload.history,
    );
  }
  if (action.type === "set_mode") return { ...state, mode: action.payload };
  if (action.type === "set_threads") {
    // Merge: preserve optimistic firstUserMessage if the server hasn't persisted it yet
    const optimisticMessages = new Map(
      state.threadList.filter((t) => t.firstUserMessage).map((t) => [t.id, t.firstUserMessage!]),
    );
    const merged = action.payload.map((t) =>
      !t.firstUserMessage && optimisticMessages.has(t.id)
        ? { ...t, firstUserMessage: optimisticMessages.get(t.id) }
        : t,
    );
    return { ...state, threadList: merged };
  }
  if (action.type === "local_user") {
    const text = action.payload.text;
    const userItem: RenderItem = {
      id: `local-user-${Date.now()}`,
      kind: "user",
      text,
      images: action.payload.images.map((image) => ({
        url: image.webUrl,
        fileName: image.fileName,
        mediaType: image.mediaType,
      })),
      timestamp: Date.now(),
    };
    return { ...state, items: [...state.items, userItem] };
  }
  if (action.type === "local_steer") {
    return { ...state, pendingSteers: [...state.pendingSteers, action.payload] };
  }
  if (action.type === "optimistic_thread") {
    const { threadId, message } = action.payload;
    const now = new Date().toISOString();
    const existing = state.threadList.find((t) => t.id === threadId);
    if (existing) {
      // Thread already in list (e.g. empty thread from startNewThread) — update firstUserMessage if missing
      if (existing.firstUserMessage) return state;
      return {
        ...state,
        threadList: state.threadList.map((t) =>
          t.id === threadId ? { ...t, firstUserMessage: message, modified: now } : t,
        ),
      };
    }
    // Thread not yet in list — prepend optimistic entry
    const optimistic: SessionSummary = {
      id: threadId,
      path: "",
      cwd: "",
      created: now,
      modified: now,
      messageCount: 1,
      firstUserMessage: message,
    };
    return { ...state, threadList: [optimistic, ...state.threadList] };
  }
  if (action.type === "show_info_toast") {
    return {
      ...state,
      toast: {
        id: `info-${Date.now()}`,
        kind: "info",
        message: action.payload,
      },
    };
  }
  if (action.type === "clear_toast") return { ...state, toast: null };
  return state;
}

// ---------------------------------------------------------------------------
// URL ↔ threadId helpers
// ---------------------------------------------------------------------------

/** Extract threadId from the current URL path (e.g. "/abc123" → "abc123"). Returns null if at root. */
function getThreadIdFromUrl(): string | null {
  const path = window.location.pathname.replace(/^\/+/, "");
  return path || null;
}

/** Replace current URL with `/{threadId}` (used for initial load so back doesn't double-stack). */
function replaceThreadUrl(threadId: string): void {
  if (getThreadIdFromUrl() !== threadId) {
    window.history.replaceState(null, "", `/${threadId}`);
  }
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function extensionForImageType(mediaType: string): string {
  switch (mediaType) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return ".bin";
  }
}

export function normalizeImageFileName(file: File, index: number, timestamp = Date.now()): string {
  const trimmedName = file.name?.trim() ?? "";
  if (trimmedName.length > 0) return trimmedName;
  return `pasted-image-${timestamp}-${index}${extensionForImageType(file.type)}`;
}

export function App() {
  const wsUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/rpc`;
  const { rpcRef, connection, reconnectAttempts, retryConnection } = useRpcClient(wsUrl);
  const providerMgr = useProviderManager(rpcRef);
  const activeThreadIdRef = useRef<string | null>(null);
  const [state, dispatch] = useReducer(appReducer, initialThreadState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [cwd, setCwd] = useState<string>("");
  const cwdRef = useRef<string>("");
  cwdRef.current = cwd;
  const modeRef = useRef(state.mode);
  modeRef.current = state.mode;
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [effort, setEffortState] = useState<ThinkingEffort>("medium");
  const [showProviderModal, setShowProviderModal] = useState(false);
  const [showToolModal, setShowToolModal] = useState(false);
  const [showKnowledgeModal, setShowKnowledgeModal] = useState(false);
  const [focusedProvider, setFocusedProvider] = useState<string | null>(null);
  const [oauthPending, setOauthPending] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  // Threads needing attention (turn completed, approval/user-input buffered while user is elsewhere)
  const [attentionThreadIds, setAttentionThreadIds] = useState<Set<string>>(new Set());
  // Skills received from server at init
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  // Build full slash command list (builtins + skills)
  const slashCommands: SlashCommand[] = useMemo(() => buildCommandList(skills), [skills]);

  const markAttention = useCallback((threadId: string) => {
    setAttentionThreadIds((prev) => {
      if (prev.has(threadId)) return prev;
      const next = new Set(prev);
      next.add(threadId);
      return next;
    });
  }, []);

  const serverRequests = useServerRequests(rpcRef, activeThreadIdRef, markAttention);

  // Keep ref in sync so onConnected closure can read latest activeThreadId
  activeThreadIdRef.current = state.activeThreadId;

  const clearAttention = useCallback((threadId: string) => {
    setAttentionThreadIds((prev) => {
      if (!prev.has(threadId)) return prev;
      const next = new Set(prev);
      next.delete(threadId);
      return next;
    });
  }, []);

  const closeModals = useCallback(() => {
    setShowKnowledgeModal(false);
    setShowToolModal(false);
  }, []);

  const threadMgr = useThreadManager({
    rpcRef,
    dispatch,
    activeThreadIdRef,
    modeRef,
    cwdRef,
    applySessionModel: providerMgr.applySessionModel,
    currentModelRef: providerMgr.currentModelRef,
    setEffortState,
    activateServerThread: serverRequests.activateThread,
    clearAttention,
    closeModals,
  });

  const getRpc = useCallback(() => rpcRef.current, [rpcRef]);

  // Register notification + server request listeners on the rpc instance created by useRpcClient.
  // Connection bootstrap is handled in a separate effect so initialize becomes the bootstrap source.
  // biome-ignore lint/correctness/useExhaustiveDependencies: adapterRef.current methods are accessed via ref intentionally
  useEffect(() => {
    const rpc = getRpc();
    if (!rpc) return;

    rpc.onNotification((notification: DiligentServerNotification) => {
      if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.ACCOUNT_LOGIN_COMPLETED) {
        const params = notification.params;
        if (params.success) {
          setOauthPending(false);
          setOauthError(null);
        } else {
          setOauthPending(false);
          setOauthError(params.error ?? "OAuth flow failed");
        }
        providerMgr.onAccountLoginCompleted(params);
        return;
      }
      if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.ACCOUNT_UPDATED) {
        void providerMgr.onAccountUpdated(notification.params);
        return;
      }
      // Mark non-active threads as needing attention when their turn completes
      if (
        notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED &&
        "threadId" in notification.params &&
        activeThreadIdRef.current &&
        notification.params.threadId !== activeThreadIdRef.current
      ) {
        markAttention(notification.params.threadId);
      }

      // Refresh sidebar on status changes: busy picks up new sessions, idle picks up completed ones
      if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED) {
        console.log("[App][thread-status] notification", {
          notificationThreadId: notification.params.threadId,
          status: notification.params.status,
          activeThreadId: activeThreadIdRef.current,
          currentUiThreadStatus: stateRef.current.threadStatus,
          itemCount: stateRef.current.items.length,
        });
        void threadMgr.refreshThreadList(rpc);
        // Re-hydrate if any items are still showing as in-flight (notifications missed during disconnect)
        const params = notification.params as { status?: string };
        if (params.status === "idle") {
          const hasInFlightItems = stateRef.current.items.some(
            (i) =>
              (i.kind === "tool" && i.status === "streaming") ||
              (i.kind === "assistant" && !(i as { thinkingDone: boolean }).thinkingDone),
          );
          if (hasInFlightItems) {
            const threadId = activeThreadIdRef.current;
            if (threadId) {
              console.log("[App] thread/status/changed idle with in-flight items — re-hydrating thread", threadId);
              void rpc
                .request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, { threadId })
                .then((history) => {
                  console.log("[App][thread-status] rehydrate after idle notification", {
                    threadId,
                    isRunning: history.isRunning,
                    messageCount: history.messages.length,
                    entryCount: history.entryCount,
                  });
                  threadMgr.adapterRef.current.reset();
                  dispatch({ type: "hydrate", payload: { threadId, mode: stateRef.current.mode, history } });
                })
                .catch(console.error);
            }
          }
        }
      }
      const events = threadMgr.adapterRef.current.toAgentEvents(notification);
      dispatch({ type: "notification", payload: { notification, events } });
    });
    rpc.onServerRequest((requestId, request) => serverRequests.handleServerRequest(requestId, request));
  }, [
    threadMgr.refreshThreadList,
    providerMgr.onAccountLoginCompleted,
    providerMgr.onAccountUpdated,
    serverRequests.handleServerRequest,
    markAttention,
    getRpc,
  ]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: adapterRef.current.reset is accessed via ref intentionally
  useEffect(() => {
    if (connection !== "connected") {
      return;
    }

    const rpc = rpcRef.current;
    if (!rpc) return;

    let cancelled = false;

    const bootstrap = async (): Promise<void> => {
      try {
        const meta = (await rpc.initialize({
          clientName: "diligent-web",
          clientVersion: DILIGENT_VERSION,
          protocolVersion: 1,
        })) as InitializeResponse;
        if (cancelled) return;

        setCwd(meta.cwd ?? "");
        setEffortState(meta.effort ?? "medium");
        setSkills(meta.skills ?? []);
        threadMgr.adapterRef.current.reset();
        providerMgr.setInitialModel(meta.currentModel ?? "", meta.availableModels ?? []);
        rpc.notify(DILIGENT_CLIENT_NOTIFICATION_METHODS.INITIALIZED, { ready: true });

        const mode = meta.mode ?? "default";

        const prevThreadId = activeThreadIdRef.current;
        if (prevThreadId) {
          const resumed = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_RESUME, { threadId: prevThreadId });
          if (!cancelled && resumed.found && resumed.threadId) {
            const history = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, {
              threadId: resumed.threadId,
            });
            if (cancelled) return;
            dispatch({ type: "hydrate", payload: { threadId: resumed.threadId, mode, history } });
            setEffortState(history.currentEffort);
            replaceThreadUrl(resumed.threadId);
            await providerMgr.applySessionModel(history.currentModel);
            await threadMgr.refreshThreadList(rpc);
            return;
          }
        }

        const urlThreadId = getThreadIdFromUrl();
        if (urlThreadId) {
          const resumed = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_RESUME, { threadId: urlThreadId });
          if (!cancelled && resumed.found && resumed.threadId) {
            const history = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, {
              threadId: resumed.threadId,
            });
            if (cancelled) return;
            dispatch({ type: "hydrate", payload: { threadId: resumed.threadId, mode, history } });
            setEffortState(history.currentEffort);
            replaceThreadUrl(resumed.threadId);
            await providerMgr.applySessionModel(history.currentModel);
            await threadMgr.refreshThreadList(rpc);
            return;
          }
        }

        const mostRecent = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_RESUME, { mostRecent: true });
        if (!cancelled && mostRecent.found && mostRecent.threadId) {
          const history = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, {
            threadId: mostRecent.threadId,
          });
          if (cancelled) return;
          dispatch({ type: "hydrate", payload: { threadId: mostRecent.threadId, mode, history } });
          setEffortState(history.currentEffort);
          replaceThreadUrl(mostRecent.threadId);
          await providerMgr.applySessionModel(history.currentModel);
          await threadMgr.refreshThreadList(rpc);
          return;
        }

        const started = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_START, {
          cwd: (meta.cwd ?? cwdRef.current) || "/",
          mode,
        });
        if (cancelled) return;
        const history = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, { threadId: started.threadId });
        if (cancelled) return;
        dispatch({ type: "hydrate", payload: { threadId: started.threadId, mode, history } });
        setEffortState(history.currentEffort);
        replaceThreadUrl(started.threadId);
        await threadMgr.refreshThreadList(rpc);
      } catch (error) {
        console.error(error);
      } finally {
        await providerMgr.refreshProviders(rpc);
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [
    connection,
    providerMgr.setInitialModel,
    providerMgr.applySessionModel,
    providerMgr.refreshProviders,
    threadMgr.refreshThreadList,
    rpcRef,
  ]);

  const startNewThread = threadMgr.startNewThread;
  const openThread = threadMgr.openThread;

  // Handle browser back/forward navigation between threads
  useEffect(() => {
    const handlePopState = () => {
      const urlThreadId = getThreadIdFromUrl();
      if (urlThreadId && urlThreadId !== activeThreadIdRef.current) {
        void openThread(urlThreadId);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [openThread]);

  // Temporarily disable the browser context menu across the whole web app.
  // Area-specific right-click actions can be attached later on top of this.
  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };
    window.addEventListener("contextmenu", handleContextMenu);
    return () => window.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  useEffect(() => {
    if (!state.toast) return;
    if (state.toast.kind === "error") {
      console.error("[diligent]", state.toast.message);
    }
    if (state.toast.fatal) return;
    const id = setTimeout(() => dispatch({ type: "clear_toast" }), 4000);
    return () => clearTimeout(id);
  }, [state.toast]);

  const isBusy = state.threadStatus === "busy";
  const showCompactingIndicator = isCompacting;
  const activeInput = state.activeThreadId ? (threadMgr.threadInputs[state.activeThreadId] ?? "") : "";
  const setActiveInput = useCallback(
    (value: string) => {
      const threadId = state.activeThreadId;
      if (!threadId) return;
      threadMgr.setThreadInputs((prev) => {
        const next = value.length > 0 ? { ...prev, [threadId]: value } : { ...prev };
        if (value.length === 0) delete next[threadId];
        return next;
      });
    },
    [state.activeThreadId, threadMgr.setThreadInputs],
  );
  const clearThreadInput = useCallback(
    (threadId: string) => {
      threadMgr.setThreadInputs((prev) => {
        if (!(threadId in prev)) return prev;
        const next = { ...prev };
        delete next[threadId];
        return next;
      });
    },
    [threadMgr.setThreadInputs],
  );
  const canSend = (activeInput.trim().length > 0 || pendingImages.length > 0) && !isBusy && !isUploadingImages;
  const canSteer = activeInput.trim().length > 0 && isBusy;
  const currentModelInfo = providerMgr.availableModels.find((m) => m.id === providerMgr.currentModel);
  const supportsVision = currentModelInfo?.supportsVision === true;
  const supportsThinking = currentModelInfo?.supportsThinking === true;

  const sendMessage = async () => {
    const rpc = rpcRef.current;
    if (!rpc || !state.activeThreadId || !canSend) return;
    const threadId = state.activeThreadId;
    const message = activeInput.trim();
    const images = pendingImages;
    clearThreadInput(threadId);
    setPendingImages([]);
    dispatch({ type: "local_user", payload: { text: message, images } });
    // If this is the first message in the thread, immediately add an optimistic sidebar entry
    if (state.items.length === 0 && state.activeThreadId) {
      dispatch({
        type: "optimistic_thread",
        payload: { threadId: state.activeThreadId, message: message || "[image]" },
      });
    }
    try {
      const content = [
        ...(message ? [{ type: "text" as const, text: message }] : []),
        ...images.map((image) => ({
          type: "local_image" as const,
          path: image.path,
          mediaType: image.mediaType,
          fileName: image.fileName,
        })),
      ];
      await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_START, {
        threadId: state.activeThreadId,
        message,
        attachments: images.map((image) => ({
          type: "local_image" as const,
          path: image.path,
          mediaType: image.mediaType,
          fileName: image.fileName,
        })),
        content,
        model: providerMgr.currentModelRef.current || undefined,
      });
    } catch (error) {
      console.error(error);
    }
  };

  const steerMessage = async () => {
    const rpc = rpcRef.current;
    if (!rpc || !state.activeThreadId || !canSteer) return;
    const threadId = state.activeThreadId;
    const content = activeInput.trim();
    clearThreadInput(threadId);
    dispatch({ type: "local_steer", payload: content });
    try {
      await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_STEER, {
        threadId: state.activeThreadId,
        content,
        followUp: false,
      });
    } catch (error) {
      console.error(error);
    }
  };

  const confirmDeleteThread = threadMgr.confirmDeleteThread;

  const interruptTurn = async () => {
    const rpc = rpcRef.current;
    if (!rpc || !state.activeThreadId) return;
    console.log("[App] Stop pressed — sending turn/interrupt for thread", state.activeThreadId);
    try {
      const result = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_INTERRUPT, {
        threadId: state.activeThreadId,
      });
      console.log("[App] turn/interrupt response:", result);
    } catch (error) {
      console.error("[App] turn/interrupt failed:", error);
    }
  };

  const setMode = async (mode: Mode) => {
    const rpc = rpcRef.current;
    if (!rpc || !state.activeThreadId) return;
    await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.MODE_SET, { threadId: state.activeThreadId, mode });
    dispatch({ type: "set_mode", payload: mode });
  };

  const setEffort = useCallback(
    async (e: ThinkingEffort) => {
      const rpc = getRpc();
      if (!rpc || !state.activeThreadId) return;
      const currentModelInfo = findModelInfo(providerMgr.availableModels, providerMgr.currentModel);
      if (e === "none" && currentModelInfo?.supportsThinking && !supportsThinkingNone(currentModelInfo)) {
        dispatch({ type: "show_info_toast", payload: "This model does not support minimal thinking." });
        return;
      }
      await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.EFFORT_SET, { threadId: state.activeThreadId, effort: e });
      setEffortState(e);
    },
    [providerMgr, state.activeThreadId, getRpc],
  );

  const handleCompactionClick = () => {
    void (async () => {
      const rpc = rpcRef.current;
      if (!rpc || !state.activeThreadId || isCompacting) return;
      setIsCompacting(true);
      dispatch({ type: "show_info_toast", payload: MANUAL_COMPACTION_TOAST });
      try {
        await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_COMPACT_START, { threadId: state.activeThreadId });
        const history = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, {
          threadId: state.activeThreadId,
        });
        dispatch({ type: "hydrate", payload: { threadId: state.activeThreadId, mode: state.mode, history } });
        dispatch({ type: "show_info_toast", payload: "Thread compacted." });
      } catch (error) {
        dispatch({
          type: "show_info_toast",
          payload: error instanceof Error ? error.message : "Manual compaction failed.",
        });
      } finally {
        setIsCompacting(false);
      }
    })();
  };

  const handleAddImages = async (files: FileList | File[]): Promise<void> => {
    const rpc = rpcRef.current;
    if (!rpc || isUploadingImages) return;

    const list = Array.from(files);
    if (pendingImages.length + list.length > 4) {
      dispatch({ type: "show_info_toast", payload: "You can attach up to 4 images per message." });
      return;
    }
    if (!supportsVision) {
      dispatch({ type: "show_info_toast", payload: "The selected model does not support image input." });
      return;
    }

    const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
    const uploaded: PendingImage[] = [];
    const uploadTimestamp = Date.now();

    setIsUploadingImages(true);
    try {
      for (const [index, file] of list.entries()) {
        const normalizedFileName = normalizeImageFileName(file, index, uploadTimestamp);
        if (!allowedTypes.has(file.type)) {
          dispatch({ type: "show_info_toast", payload: `Unsupported image type: ${normalizedFileName}` });
          return;
        }
        if (file.size > 10 * 1024 * 1024) {
          dispatch({ type: "show_info_toast", payload: `Image exceeds 10 MB: ${normalizedFileName}` });
          return;
        }

        const dataBase64 = await fileToBase64(file);
        const result = await rpc.webRequest(DILIGENT_CLIENT_REQUEST_METHODS.IMAGE_UPLOAD, {
          threadId: state.activeThreadId ?? undefined,
          fileName: normalizedFileName,
          mediaType: file.type as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
          dataBase64,
        });
        uploaded.push(result.attachment as PendingImage);
      }

      setPendingImages((prev) => [...prev, ...uploaded]);
    } catch (error) {
      dispatch({ type: "show_info_toast", payload: "Failed to upload images." });
      console.error(error);
    } finally {
      setIsUploadingImages(false);
    }
  };

  const handleRemovePendingImage = (path: string) => {
    setPendingImages((prev) => prev.filter((image) => image.path !== path));
  };

  // ---------------------------------------------------------------------------
  // Slash command handling
  // ---------------------------------------------------------------------------

  const handleSlashCommand = useCallback(
    (name: string, arg?: string) => {
      const rpc = rpcRef.current;
      const activeThreadId = state.activeThreadId;

      if (activeThreadId) {
        clearThreadInput(activeThreadId);
      }

      switch (name) {
        case "help": {
          const names = slashCommands.map((c) => `/${c.name}`).join(", ");
          dispatch({ type: "show_info_toast", payload: `Commands: ${names}` });
          return;
        }
        case "new":
          void startNewThread();
          return;
        case "resume":
          if (!arg) {
            dispatch({ type: "show_info_toast", payload: "Usage: /resume <thread-id>" });
            return;
          }
          void openThread(arg);
          return;
        case "model": {
          if (!arg) {
            dispatch({ type: "show_info_toast", payload: "Usage: /model <model-id>" });
            return;
          }

          const exists = providerMgr.availableModels.some((model) => model.id === arg);
          if (!exists) {
            dispatch({ type: "show_info_toast", payload: `Unknown model: ${arg}` });
            return;
          }

          void providerMgr.changeModel(arg).then(() => {
            const modelInfo = providerMgr.availableModels.find((model) => model.id === arg);
            if (effort === "none" && modelInfo && !supportsThinkingNone(modelInfo)) {
              setEffortState("medium");
              dispatch({ type: "show_info_toast", payload: `Model switched to ${arg}. Thinking adjusted to medium.` });
              return;
            }
            dispatch({ type: "show_info_toast", payload: `Model switched to ${arg}` });
          });
          return;
        }
        case "effort": {
          const modelInfo = findModelInfo(providerMgr.availableModels, providerMgr.currentModel);
          if (modelInfo && !modelInfo.supportsThinking) {
            dispatch({ type: "show_info_toast", payload: "This model does not support thinking effort settings." });
            return;
          }
          const usage = `/effort <${getThinkingEffortUsage(modelInfo)}>`;
          if (!arg) {
            dispatch({ type: "show_info_toast", payload: `Usage: ${usage}` });
            return;
          }
          const raw = arg.toLowerCase();
          const normalized = raw === "minimal" ? "none" : raw;
          if (
            normalized !== "none" &&
            normalized !== "low" &&
            normalized !== "medium" &&
            normalized !== "high" &&
            normalized !== "max"
          ) {
            dispatch({ type: "show_info_toast", payload: `Unknown effort: ${arg}. Usage: ${usage}` });
            return;
          }
          void setEffort(normalized as ThinkingEffort);
          return;
        }
        default: {
          // Check if it's a skill command — send as message for server-side skill invocation
          const isSkill = slashCommands.some((c) => c.name === name && c.isSkill);
          if (isSkill && rpc && activeThreadId) {
            const message = arg ? `/${name} ${arg}` : `/${name}`;
            dispatch({ type: "local_user", payload: { text: message, images: [] } });
            void rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_START, {
              threadId: activeThreadId,
              message,
              content: [{ type: "text" as const, text: message }],
            });
            return;
          }
          dispatch({ type: "show_info_toast", payload: `Unknown command: /${name}` });
          return;
        }
      }
    },
    [
      rpcRef,
      slashCommands,
      state.activeThreadId,
      startNewThread,
      openThread,
      providerMgr,
      clearThreadInput,
      effort,
      setEffort,
    ],
  );

  // Intercept slash commands on send
  const handleSend = useCallback(() => {
    const parsed = parseSlashCommand(activeInput);
    if (parsed) {
      const cmd = slashCommands.find((c) => c.name === parsed.name);
      if (cmd) {
        handleSlashCommand(parsed.name, parsed.args);
        return;
      }
    }
    void sendMessage();
    // biome-ignore lint/correctness/useExhaustiveDependencies: sendMessage is stable enough
  }, [activeInput, slashCommands, handleSlashCommand, sendMessage]);

  useEffect(() => {
    if (effort !== "none") return;
    if (!currentModelInfo) return;
    if (supportsThinkingNone(currentModelInfo)) return;
    setEffortState("medium");
  }, [effort, currentModelInfo]);

  const listTools = useCallback(async (): Promise<ToolsListResponse> => {
    const rpc = rpcRef.current;
    if (!rpc) {
      throw new Error("WebSocket is not connected");
    }
    return rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.TOOLS_LIST, {
      threadId: state.activeThreadId ?? undefined,
    });
  }, [rpcRef, state.activeThreadId]);

  const saveTools = useCallback(
    async (params: ToolsSetParams): Promise<ToolsSetResponse> => {
      const rpc = rpcRef.current;
      if (!rpc) {
        throw new Error("WebSocket is not connected");
      }
      return rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.TOOLS_SET, params);
    },
    [rpcRef],
  );

  const listKnowledge = useCallback(
    async (threadId?: string): Promise<{ data: KnowledgeEntry[] }> => {
      const rpc = rpcRef.current;
      if (!rpc) {
        throw new Error("WebSocket is not connected");
      }
      return rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.KNOWLEDGE_LIST, {
        threadId,
        limit: 500,
      });
    },
    [rpcRef],
  );

  const updateKnowledge = useCallback(
    async (params: KnowledgeUpdateParams): Promise<{ entry?: KnowledgeEntry; deleted?: boolean }> => {
      const rpc = rpcRef.current;
      if (!rpc) {
        throw new Error("WebSocket is not connected");
      }
      return rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.KNOWLEDGE_UPDATE, params);
    },
    [rpcRef],
  );

  const threadTitle = useMemo(() => {
    const active = state.threadList.find((t) => t.id === state.activeThreadId);
    const raw = active?.firstUserMessage ?? state.items.find((i) => i.kind === "user")?.text ?? "";
    return raw.length > 40 ? `${raw.slice(0, 40)}…` : raw;
  }, [state.activeThreadId, state.threadList, state.items]);

  const statusDotColor: "success" | "accent" | "danger" =
    state.threadStatus === "idle" ? "success" : state.threadStatus === "busy" ? "accent" : "danger";
  const statusDotPulse = state.threadStatus !== "idle";

  const showPlan = state.planState?.steps.some((s) => s.status !== "done");

  const showConnectionModal = connection === "reconnecting" || (connection === "disconnected" && reconnectAttempts > 0);
  const retryLimit = getReconnectAttemptLimit();

  return (
    <div className="h-screen bg-bg text-text">
      <div className="mx-auto grid h-full max-w-app grid-cols-1 gap-2 p-2 lg:grid-cols-[280px_1fr]">
        <Sidebar
          cwd={cwd}
          threadList={state.threadList}
          activeThreadId={state.activeThreadId}
          attentionThreadIds={attentionThreadIds}
          onNewThread={() => void startNewThread()}
          onOpenThread={(id) => void openThread(id)}
          onDeleteThread={(id) => threadMgr.setPendingDeleteThreadId(id)}
          providers={providerMgr.providers}
          onOpenProviders={(p) => {
            setFocusedProvider(p ?? null);
            setShowProviderModal(true);
          }}
          onOpenTools={() => {
            setShowKnowledgeModal(false);
            setShowToolModal(true);
          }}
          onOpenKnowledge={() => {
            setShowToolModal(false);
            setShowKnowledgeModal(true);
          }}
        />

        <Panel className="relative flex min-h-0 flex-col overflow-hidden">
          {/* Thread title bar */}
          <div className="flex shrink-0 items-center gap-2.5 border-b border-text/10 px-4 py-2.5">
            <StatusDot color={statusDotColor} pulse={statusDotPulse} size="md" />
            {(state.threadStatus !== "idle" || showCompactingIndicator) && (
              <span
                className={`shrink-0 font-mono text-xs ${showCompactingIndicator || state.threadStatus === "busy" ? "text-accent" : "text-danger"}`}
              >
                {showCompactingIndicator
                  ? "Compacting..."
                  : state.threadStatus === "busy"
                    ? "Running..."
                    : state.threadStatus}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">
              {threadTitle || "new conversation"}
            </span>
          </div>

          <MessageList
            items={state.items}
            threadStatus={showCompactingIndicator ? "busy" : state.threadStatus}
            onSelectPrompt={(p) => setActiveInput(p)}
            approvalPrompt={
              serverRequests.approvalPrompt?.request.method === DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST
                ? {
                    request: serverRequests.approvalPrompt.request.params.request,
                    onDecide: serverRequests.resolveApproval,
                  }
                : null
            }
            questionPrompt={
              serverRequests.questionPrompt
                ? {
                    request: serverRequests.questionPrompt.request,
                    answers: serverRequests.answers,
                    onAnswerChange: (id, val) => serverRequests.setAnswers((prev) => ({ ...prev, [id]: val })),
                    onSubmit: () => serverRequests.resolveQuestion(serverRequests.answers),
                    onCancel: () => serverRequests.resolveQuestion({}),
                  }
                : null
            }
          />

          {showPlan && <PlanPanel planState={state.planState!} />}

          <SteeringQueuePanel pendingSteers={state.pendingSteers} />

          <InputDock
            input={activeInput}
            onInputChange={setActiveInput}
            onSend={handleSend}
            onSteer={() => void steerMessage()}
            onInterrupt={() => void interruptTurn()}
            onCompactionClick={handleCompactionClick}
            isCompacting={isCompacting}
            canSend={canSend}
            canSteer={canSteer}
            threadStatus={state.threadStatus}
            mode={state.mode}
            onModeChange={(m) => void setMode(m)}
            effort={effort}
            onEffortChange={(e) => void setEffort(e)}
            currentModel={providerMgr.currentModel}
            availableModels={providerMgr.availableModels}
            onModelChange={(m) => void providerMgr.changeModel(m)}
            usage={state.usage}
            currentContextTokens={state.currentContextTokens}
            contextWindow={
              providerMgr.availableModels.find((m) => m.id === providerMgr.currentModel)?.contextWindow ?? 0
            }
            hasProvider={providerMgr.providers.some((p) => p.configured)}
            onOpenProviders={() => setShowProviderModal(true)}
            supportsVision={supportsVision}
            supportsThinking={supportsThinking}
            pendingImages={pendingImages.map((image) => ({
              path: image.path,
              url: image.webUrl,
              fileName: image.fileName,
            }))}
            isUploadingImages={isUploadingImages}
            onAddImages={(files) => void handleAddImages(files)}
            onRemoveImage={handleRemovePendingImage}
            onSlashCommand={handleSlashCommand}
            slashCommands={slashCommands}
          />

          {showToolModal ? (
            <ToolSettingsModal
              threadId={state.activeThreadId}
              onList={listTools}
              onSave={saveTools}
              onClose={() => setShowToolModal(false)}
              className="absolute inset-0 z-40 bg-black/35"
            />
          ) : null}

          {showKnowledgeModal ? (
            <KnowledgeManagerModal
              threadId={state.activeThreadId}
              onList={listKnowledge}
              onUpdate={updateKnowledge}
              onClose={() => setShowKnowledgeModal(false)}
              className="absolute inset-0 z-40 bg-black/35"
            />
          ) : null}
        </Panel>
      </div>

      {state.toast ? (
        <div
          className={`toast-animate fixed bottom-12 left-1/2 -translate-x-1/2 rounded-md border px-3 py-2 text-sm shadow-panel ${
            state.toast.kind === "error"
              ? "border-danger/40 bg-surface text-danger"
              : "border-accent/40 bg-surface text-accent"
          } ${state.toast.fatal ? "cursor-pointer" : ""}`}
          onClick={state.toast.fatal ? () => dispatch({ type: "clear_toast" }) : undefined}
        >
          {state.toast.message}
          {state.toast.fatal && <span className="ml-2 opacity-50">×</span>}
        </div>
      ) : null}

      {showProviderModal ? (
        <ProviderSettingsModal
          providers={providerMgr.providers}
          focusProvider={focusedProvider ?? undefined}
          oauthPending={oauthPending}
          oauthError={oauthError}
          onSet={providerMgr.handleSetProviderKey}
          onRemove={providerMgr.handleRemoveProviderKey}
          onOAuthStart={async () => {
            setOauthPending(true);
            setOauthError(null);
            const result = await providerMgr.handleOAuthStart("chatgpt");
            // Server opens the browser server-side (works in both regular browser and Tauri)
            return result;
          }}
          onClose={() => {
            setShowProviderModal(false);
            setFocusedProvider(null);
            setOauthError(null);
          }}
        />
      ) : null}

      {threadMgr.pendingDeleteThreadId ? (
        <Modal
          title="Delete conversation?"
          description="This will permanently delete the conversation file. This action cannot be undone."
          onCancel={() => threadMgr.setPendingDeleteThreadId(null)}
          onConfirm={() => void confirmDeleteThread()}
        >
          <div className="flex items-center justify-end gap-2">
            <Button intent="ghost" size="sm" onClick={() => threadMgr.setPendingDeleteThreadId(null)}>
              Cancel
            </Button>
            <Button intent="danger" size="sm" onClick={() => void confirmDeleteThread()}>
              Delete
            </Button>
          </div>
        </Modal>
      ) : null}

      {showConnectionModal ? (
        <Modal
          title={connection === "reconnecting" ? "Connection lost" : "Reconnect failed"}
          description={
            connection === "reconnecting"
              ? `WebSocket disconnected. Retrying... (${Math.min(reconnectAttempts, retryLimit)}/${retryLimit})`
              : `Automatic retry stopped after ${retryLimit} attempts.`
          }
          onConfirm={connection === "disconnected" ? retryConnection : undefined}
        >
          {connection === "reconnecting" ? (
            <div className="text-sm text-muted">Please wait while we restore the session.</div>
          ) : (
            <div className="flex items-center justify-end gap-2">
              <Button intent="ghost" size="sm" onClick={retryConnection}>
                Retry now
              </Button>
            </div>
          )}
        </Modal>
      ) : null}
    </div>
  );
}
