// @summary Main application orchestrator: state management, RPC lifecycle, and inline prompt handling

import type {
  KnowledgeEntry,
  KnowledgeUpdateParams,
  SkillInfo,
  ThinkingEffort,
  ThreadReadResponse,
  ToolsListResponse,
  ToolsSetParams,
  ToolsSetResponse,
} from "@diligent/protocol";
import { DILIGENT_CLIENT_REQUEST_METHODS, DILIGENT_SERVER_REQUEST_METHODS } from "@diligent/protocol";
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
import { SteeringQueuePanel } from "./components/SteeringQueuePanel";
import { ToolSettingsModal } from "./components/ToolSettingsModal";
import { APP_PROJECT_NAME } from "./lib/app-config";
import { appReducer, type PendingImage } from "./lib/app-state";
import { getThreadIdFromUrl } from "./lib/app-utils";
import { createDesktopNotificationController, readDesktopNotificationsEnabled } from "./lib/desktop-notification";
import { supportsThinkingNone } from "./lib/model-thinking-helpers";
import { getReconnectAttemptLimit } from "./lib/rpc-client";
import type { SlashCommand } from "./lib/slash-commands";
import { buildCommandList } from "./lib/slash-commands";
import { initialThreadState } from "./lib/thread-store";
import { useAppActions } from "./lib/use-app-actions";
import { useAppBootstrap, useAppRpcBindings } from "./lib/use-app-lifecycle";
import { useProviderManager } from "./lib/use-provider-manager";
import { useRpcClient } from "./lib/use-rpc";
import { useServerRequests } from "./lib/use-server-requests";
import { useSteeringQueue } from "./lib/use-steering-queue";
import { clearDraftThreadInput, DRAFT_INPUT_KEY, useThreadManager } from "./lib/use-thread-manager";

export function App() {
  useEffect(() => {
    document.title = APP_PROJECT_NAME;
  }, []);

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
  const childThreadCacheRef = useRef<Map<string, ThreadReadResponse>>(new Map());
  const desktopNotificationsRef = useRef(createDesktopNotificationController());
  const [desktopNotificationsEnabled, setDesktopNotificationsEnabled] = useState(() =>
    readDesktopNotificationsEnabled(),
  );
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

  const serverRequests = useServerRequests(
    rpcRef,
    activeThreadIdRef,
    markAttention,
    (requestId, request) => void desktopNotificationsRef.current.notifyForServerRequest(requestId, request),
  );

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
    applySessionModel: providerMgr.applySessionModel,
    resetDraftModel: providerMgr.resetDraftModel,
    setEffortState,
    activateThreadPrompts: serverRequests.activateThread,
    clearAttention,
    closeModals,
  });

  const loadChildThread = useCallback(
    async (childThreadId: string): Promise<ThreadReadResponse> => {
      const cached = childThreadCacheRef.current.get(childThreadId);
      if (cached) return cached;
      const rpc = rpcRef.current;
      if (!rpc) throw new Error("WebSocket is not connected");
      const response = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, { threadId: childThreadId });
      childThreadCacheRef.current.set(childThreadId, response);
      return response;
    },
    [rpcRef],
  );

  const startNewThread = threadMgr.startNewThread;
  const openThread = threadMgr.openThread;

  useEffect(() => {
    desktopNotificationsRef.current.setEnabled(desktopNotificationsEnabled);
  }, [desktopNotificationsEnabled]);

  useEffect(() => {
    void desktopNotificationsRef.current.attachActionHandler((threadId) => {
      void openThread(threadId);
    });
  }, [openThread]);

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
  const activeInputKey = state.activeThreadId ?? DRAFT_INPUT_KEY;
  const activeInput = threadMgr.threadInputs[activeInputKey] ?? "";
  const setActiveInput = useCallback(
    (value: string) => {
      const inputKey = state.activeThreadId ?? DRAFT_INPUT_KEY;
      threadMgr.setThreadInputs((prev) => {
        const next = value.length > 0 ? { ...prev, [inputKey]: value } : { ...prev };
        if (value.length === 0) delete next[inputKey];
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
  const clearDraftInput = useCallback(() => {
    threadMgr.setThreadInputs((prev) => clearDraftThreadInput(prev));
  }, [threadMgr.setThreadInputs]);
  const canSend = (activeInput.trim().length > 0 || pendingImages.length > 0) && !isBusy && !isUploadingImages;
  const steeringQueue = useSteeringQueue({
    rpcRef,
    stateRef,
    dispatch,
    activeThreadId: state.activeThreadId,
    currentModelRef: providerMgr.currentModelRef,
    activeInput,
    isBusy,
    clearThreadInput,
  });

  useAppRpcBindings({
    rpcRef,
    activeThreadIdRef,
    stateRef,
    dispatch,
    refreshThreadList: threadMgr.refreshThreadList,
    onAccountLoginCompleted: providerMgr.onAccountLoginCompleted,
    onAccountUpdated: providerMgr.onAccountUpdated,
    markAttention,
    onBackgroundNotification: (notification) =>
      void desktopNotificationsRef.current.notifyForNotification(notification),
    handleServerRequest: serverRequests.handleServerRequest,
    steering: {
      pendingAbortRestartMessageRef: steeringQueue.pendingAbortRestartMessageRef,
      suppressNextSteeringInjectedRef: steeringQueue.suppressNextSteeringInjectedRef,
      restartFromPendingAbortSteer: steeringQueue.restartFromPendingAbortSteer,
    },
    setOauthPending,
    setOauthError,
  });

  useAppBootstrap({
    connection,
    rpcRef,
    activeThreadIdRef,
    dispatch,
    setCwd,
    setEffortState,
    setSkills,
    setInitialModel: providerMgr.setInitialModel,
    applySessionModel: providerMgr.applySessionModel,
    refreshThreadList: threadMgr.refreshThreadList,
    refreshProviders: providerMgr.refreshProviders,
  });

  const currentModelInfo = providerMgr.availableModels.find((m) => m.id === providerMgr.currentModel);
  const supportsVision = currentModelInfo?.supportsVision === true;
  const supportsThinking = currentModelInfo?.supportsThinking === true;

  const confirmDeleteThread = threadMgr.confirmDeleteThread;

  const {
    handleSend,
    handleInterrupt,
    handleModeChange,
    handleEffortChange,
    handleModelChange,
    handleCompactionClick,
    handleAddImagesToDock,
    handleRemovePendingImage,
    handleSlashCommand,
  } = useAppActions({
    rpcRef,
    state,
    stateRef,
    dispatch,
    activeInput,
    pendingImages,
    canSend,
    isUploadingImages,
    isCompacting,
    supportsVision,
    effort,
    slashCommands,
    currentModel: providerMgr.currentModel,
    availableModels: providerMgr.availableModels,
    currentModelRef: providerMgr.currentModelRef,
    clearThreadInput,
    clearDraftInput,
    setPendingImages,
    setIsUploadingImages,
    setIsCompacting,
    setEffortState,
    changeModel: providerMgr.changeModel,
    startNewThread,
    openThread,
    steeringControl: {
      pendingAbortRestartMessageRef: steeringQueue.pendingAbortRestartMessageRef,
      suppressNextSteeringInjectedRef: steeringQueue.suppressNextSteeringInjectedRef,
    },
    modeRef,
    cwdRef,
    applySessionModel: providerMgr.applySessionModel,
    activateServerThread: threadMgr.activateServerThread,
    refreshThreadList: threadMgr.refreshThreadList,
  });

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

  const showPlan = state.planState?.steps.some((s) => s.status !== "done");

  const showConnectionModal = connection === "reconnecting" || (connection === "disconnected" && reconnectAttempts > 0);
  const retryLimit = getReconnectAttemptLimit();
  const contextWindow = useMemo(
    () => providerMgr.availableModels.find((m) => m.id === providerMgr.currentModel)?.contextWindow ?? 0,
    [providerMgr.availableModels, providerMgr.currentModel],
  );
  const hasProvider = useMemo(() => providerMgr.providers.some((p) => p.configured), [providerMgr.providers]);
  const hasResolvedProviderStatus = providerMgr.providerStatusResolved;
  const effectiveHasProvider = hasProvider || !hasResolvedProviderStatus;
  const pendingImagePreviews = useMemo(
    () =>
      pendingImages.map((image) => ({
        path: image.path,
        url: image.webUrl,
        fileName: image.fileName,
      })),
    [pendingImages],
  );
  const handleQuestionAnswerChange = useCallback(
    (id: string, val: string | string[]) => serverRequests.setAnswers((prev) => ({ ...prev, [id]: val })),
    [serverRequests.setAnswers],
  );
  const handleQuestionSubmit = useCallback(
    () => serverRequests.resolveQuestion(serverRequests.answers),
    [serverRequests],
  );
  const handleQuestionCancel = useCallback(() => serverRequests.resolveQuestion({}), [serverRequests]);
  const handleOpenProviders = useCallback(() => {
    setFocusedProvider(null);
    setShowProviderModal(true);
  }, []);
  const handleQuickConnectChatGPT = useCallback(() => {
    setOauthPending(true);
    setOauthError(null);
    void providerMgr.handleOAuthStart("chatgpt").catch((error) => {
      setOauthPending(false);
      setOauthError(error instanceof Error ? error.message : "Failed to start OAuth");
      setFocusedProvider("chatgpt");
      setShowProviderModal(true);
    });
  }, [providerMgr]);
  const { handleSteer, canSteer } = steeringQueue;
  const approvalPrompt = useMemo(
    () =>
      serverRequests.approvalPrompt?.request.method === DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST
        ? {
            request: serverRequests.approvalPrompt.request.params.request,
            onDecide: serverRequests.resolveApproval,
          }
        : null,
    [serverRequests.approvalPrompt, serverRequests.resolveApproval],
  );
  const questionPrompt = useMemo(
    () =>
      serverRequests.questionPrompt
        ? {
            request: serverRequests.questionPrompt.request,
            answers: serverRequests.answers,
            onAnswerChange: handleQuestionAnswerChange,
            onSubmit: handleQuestionSubmit,
            onCancel: handleQuestionCancel,
          }
        : null,
    [
      serverRequests.questionPrompt,
      serverRequests.answers,
      handleQuestionAnswerChange,
      handleQuestionSubmit,
      handleQuestionCancel,
    ],
  );

  return (
    <div className="h-screen bg-bg text-text">
      <div className="mx-auto grid h-full max-w-[1480px] grid-cols-1 gap-3 px-3 py-3 lg:grid-cols-[300px_1fr] lg:px-4 lg:py-4">
        <Sidebar
          cwd={cwd}
          threadList={state.threadList}
          activeThreadId={state.activeThreadId}
          attentionThreadIds={attentionThreadIds}
          onNewThread={() => void startNewThread()}
          onOpenThread={(id) => void openThread(id)}
          onDeleteThread={(id) => threadMgr.setPendingDeleteThreadId(id)}
          onOpenTools={() => {
            setShowKnowledgeModal(false);
            setShowToolModal(true);
          }}
          onOpenKnowledge={() => {
            setShowToolModal(false);
            setShowKnowledgeModal(true);
          }}
        />

        <Panel className="relative flex min-h-0 flex-col overflow-hidden border-border/100 bg-surface-dark">
          {/* Thread title bar */}
          <div className="flex shrink-0 items-center gap-3 border-b border-border/100 bg-surface-dark px-5 py-3">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--color-icon-success)]" aria-hidden="true" />
            {(state.threadStatus !== "idle" || showCompactingIndicator) && (
              <span
                className={`shrink-0 font-mono text-xs ${showCompactingIndicator || state.threadStatus === "busy" ? "text-text-success" : "text-danger"}`}
              >
                {showCompactingIndicator
                  ? "Compacting..."
                  : state.threadStatus === "busy"
                    ? "Running..."
                    : state.threadStatus}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate font-mono text-xs uppercase tracking-[0.12em] text-muted/90">
              {threadTitle || "new conversation"}
            </span>
          </div>

          <MessageList
            items={state.items}
            threadStatus={state.threadStatus}
            threadCwd={state.activeThreadCwd ?? undefined}
            hasProvider={effectiveHasProvider}
            oauthPending={oauthPending}
            onOpenProviders={handleOpenProviders}
            onQuickConnectChatGPT={handleQuickConnectChatGPT}
            approvalPrompt={approvalPrompt}
            questionPrompt={questionPrompt}
            onLoadChildThread={loadChildThread}
          />

          {showPlan && <PlanPanel planState={state.planState!} />}

          <SteeringQueuePanel pendingSteers={state.pendingSteers} />

          <InputDock
            input={activeInput}
            onInputChange={setActiveInput}
            onSend={handleSend}
            onSteer={handleSteer}
            onInterrupt={handleInterrupt}
            onCompactionClick={handleCompactionClick}
            isCompacting={isCompacting}
            canSend={canSend}
            canSteer={canSteer}
            threadStatus={state.threadStatus}
            mode={state.mode}
            onModeChange={handleModeChange}
            effort={effort}
            onEffortChange={handleEffortChange}
            currentModel={providerMgr.currentModel}
            availableModels={providerMgr.availableModels}
            onModelChange={handleModelChange}
            usage={state.usage}
            currentContextTokens={state.currentContextTokens}
            contextWindow={contextWindow}
            hasProvider={hasProvider}
            supportsVision={supportsVision}
            supportsThinking={supportsThinking}
            pendingImages={pendingImagePreviews}
            isUploadingImages={isUploadingImages}
            onAddImages={handleAddImagesToDock}
            onRemoveImage={handleRemovePendingImage}
            onSlashCommand={handleSlashCommand}
            slashCommands={slashCommands}
          />

          {showToolModal ? (
            <ToolSettingsModal
              threadId={state.activeThreadId}
              providers={providerMgr.providers}
              desktopNotificationsEnabled={desktopNotificationsEnabled}
              onList={listTools}
              onSave={saveTools}
              onDesktopNotificationsEnabledChange={setDesktopNotificationsEnabled}
              onOpenProviders={() => {
                setFocusedProvider(hasProvider ? null : "chatgpt");
                setShowProviderModal(true);
              }}
              onClose={() => setShowToolModal(false)}
              className="absolute inset-0 z-40 bg-overlay/35"
            />
          ) : null}

          {showKnowledgeModal ? (
            <KnowledgeManagerModal
              threadId={state.activeThreadId}
              onList={listKnowledge}
              onUpdate={updateKnowledge}
              onClose={() => setShowKnowledgeModal(false)}
              className="absolute inset-0 z-40 bg-overlay/35"
            />
          ) : null}
        </Panel>
      </div>

      {state.toast ? (
        <div
          className={`toast-animate fixed bottom-12 left-1/2 -translate-x-1/2 rounded-md border px-3 py-2 text-sm shadow-panel ${
            state.toast.kind === "error"
              ? "border-danger/40 bg-surface-default text-danger"
              : "border-accent/40 bg-surface-default text-accent"
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
