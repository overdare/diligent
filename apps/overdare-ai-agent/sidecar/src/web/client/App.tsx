// @summary Main application component: pure composition of hooks and sub-components

import type { ErrorRecovery } from "@diligent/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { ConnectionModal } from "./components/ConnectionModal";
import { DeleteThreadModal } from "./components/DeleteThreadModal";
import type { FeedbackReportSubmission } from "./components/FeedbackReportModal";
import { FeedbackReportModal } from "./components/FeedbackReportModal";
import { FirstRunNoticeModal } from "./components/FirstRunNoticeModal";
import { GoalStatus } from "./components/GoalStatus";
import { InputDock } from "./components/InputDock";
import { KnowledgeManagerModal } from "./components/KnowledgeManagerModal";
import { McpServersModal } from "./components/McpServersModal";
import { MessageList } from "./components/MessageList";
import { Panel } from "./components/Panel";
import { PlanPanel } from "./components/PlanPanel";
import { ProviderSettingsModal } from "./components/ProviderSettingsModal";
import { ResponsiveSidebar } from "./components/ResponsiveSidebar";
import { Sidebar } from "./components/Sidebar";
import { SteeringQueuePanel } from "./components/SteeringQueuePanel";
import { Toast } from "./components/Toast";
import { ToolSettingsModal } from "./components/ToolSettingsModal";
import {
  createFeedbackReportTarget,
  type FeedbackReportTarget,
  formatFeedbackReceiptToast,
} from "./lib/feedback-report";
import { modelOptionKey } from "./lib/model-thinking-helpers";
import { resolveWebSocketUrl } from "./lib/rpc-client";
import type { RenderItem } from "./lib/thread-store";
import { hasPendingUserInputTool } from "./lib/thread-utils";
import { useAgentNativeBridge } from "./lib/use-agent-native-bridge";
import { useAppState } from "./lib/use-app-state";
import { useChatFileDrop } from "./lib/use-chat-file-drop";
import { useProviderManager } from "./lib/use-provider-manager";
import { useRpcClient } from "./lib/use-rpc";

const MOBILE_SIDEBAR_QUERY = "(max-width: 639px)";

interface FeedbackReportSelection extends FeedbackReportTarget {
  sessionId: string;
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const handleChange = () => setMatches(mediaQuery.matches);

    handleChange();
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [query]);

  return matches;
}

export function App() {
  const wsUrl = resolveWebSocketUrl(window.location, import.meta.env.VITE_RPC_URL);
  const { rpcRef, connection, reconnectAttempts, retryConnection, retryLimit, showConnectionModal } =
    useRpcClient(wsUrl);
  const providerMgr = useProviderManager(rpcRef);

  const {
    state,
    dispatch,
    cwd,
    sidebarOpen,
    setSidebarOpen,
    showProviderModal,
    setShowProviderModal,
    showToolModal,
    setShowToolModal,
    showKnowledgeModal,
    setShowKnowledgeModal,
    showMcpModal,
    setShowMcpModal,
    mcpRefreshNonce,
    focusedProvider,
    oauthPending,
    oauthError,
    attentionThreadIds,
    runtimeVersion,
    consent,
    updateConsent,
    submitFeedback,
    desktopNotificationsEnabled,
    setDesktopNotificationsEnabled,
    slashCommands,
    goalsSupported,
    activeInput,
    activeContextItems,
    setActiveInput,
    removeActiveContextItem,
    clearActiveContextItems,
    updateActiveContextItems,
    canSend,
    supportsVision,
    supportsThinking,
    threadTitle,
    pendingImagePreviews,
    effort,
    fastMode,
    isUploadingImages,
    showImageUploadIndicator,
    threadMgr,
    steeringQueue,
    actions,
    listTools,
    saveTools,
    listSkills,
    saveSkills,
    listExperiments,
    saveExperiments,
    listSubagents,
    saveSubagents,
    setSkills,
    listKnowledge,
    updateKnowledge,
    listMcpServers,
    mcpLoginStart,
    mcpLogout,
    loadChildThread,
    handleOpenProviders,
    handleOpenProvider,
    handleQuickConnectChatGPT,
    handleProviderModalClose,
    handleProviderOAuthStart,
    handleProviderOAuthCancel,
    approvalPrompt,
    questionPrompt,
  } = useAppState({ rpcRef, providerMgr, connection, reconnectAttempts });

  const { startNewThread, openThread, confirmDeleteThread } = threadMgr;
  const { handleSteer, canSteer, cancelSteer, updateSteer } = steeringQueue;
  const {
    handleSend,
    handleInterrupt,
    handleRetryLastTurn,
    handleModeChange,
    handleEffortChange,
    handleModelChange,
    handleCompactionClick,
    handleAddImagesToDock,
    handleRemovePendingImage,
    handleSlashCommand,
    handleGoalPause,
    handleGoalResume,
    handleGoalClear,
  } = actions;

  useAgentNativeBridge({ updateContextItems: updateActiveContextItems });
  const hasBlockingPrompt = Boolean(approvalPrompt || questionPrompt || hasPendingUserInputTool(state.items));
  const sidebarIsOverlay = useMediaQuery(MOBILE_SIDEBAR_QUERY);
  const mainContentIsInert = sidebarOpen && sidebarIsOverlay;
  const sidebarTriggerRef = useRef<HTMLElement | null>(null);
  const [feedbackReport, setFeedbackReport] = useState<FeedbackReportSelection | null>(null);
  const handleChatFileDrop = useChatFileDrop({
    enabled:
      providerMgr.hasProvider &&
      connection === "connected" &&
      !isUploadingImages &&
      !mainContentIsInert &&
      !showProviderModal &&
      !showToolModal &&
      !showKnowledgeModal &&
      !showMcpModal &&
      !showConnectionModal &&
      !threadMgr.pendingDeleteThreadId &&
      !feedbackReport &&
      !(consent && !consent.noticeAcknowledged),
    onAddImages: handleAddImagesToDock,
  });
  const closeSidebar = useCallback(() => setSidebarOpen(false), [setSidebarOpen]);
  const handleSidebarNewThread = useCallback(() => {
    void startNewThread();
    if (sidebarIsOverlay) {
      closeSidebar();
    }
  }, [closeSidebar, sidebarIsOverlay, startNewThread]);
  const handleSidebarOpenThread = useCallback(
    (id: string) => {
      void openThread(id);
      if (sidebarIsOverlay) {
        closeSidebar();
      }
    },
    [closeSidebar, openThread, sidebarIsOverlay],
  );
  const setPendingDeleteThreadId = threadMgr.setPendingDeleteThreadId;
  const handleSidebarDeleteThread = useCallback(
    (id: string) => setPendingDeleteThreadId(id),
    [setPendingDeleteThreadId],
  );
  const handleReportMessage = useCallback(
    (item: Extract<RenderItem, { kind: "user" | "assistant" }>) => {
      if (!state.activeThreadId) return;
      setFeedbackReport({
        sessionId: state.activeThreadId,
        ...createFeedbackReportTarget(item),
      });
    },
    [state.activeThreadId],
  );
  const handleErrorRecovery = useCallback(
    (recovery: ErrorRecovery) => {
      switch (recovery.kind) {
        case "configure_provider":
          if (recovery.provider) handleOpenProvider(recovery.provider);
          else handleOpenProviders();
          return;
        case "start_new_thread":
          void startNewThread();
          return;
        case "retry":
          handleRetryLastTurn();
          return;
      }
    },
    [handleOpenProvider, handleOpenProviders, handleRetryLastTurn, startNewThread],
  );
  const handleCancelFeedbackReport = useCallback(() => setFeedbackReport(null), []);
  const handleSubmitFeedbackReport = useCallback(
    async ({ clientReportId, category, description }: FeedbackReportSubmission) => {
      if (!feedbackReport) return;
      await submitFeedback({
        clientReportId,
        sessionId: feedbackReport.sessionId,
        messageId: feedbackReport.messageId,
        category,
        ...(description !== undefined ? { description } : {}),
      });
      setFeedbackReport(null);
      dispatch({ type: "show_info_toast", payload: formatFeedbackReceiptToast() });
    },
    [dispatch, feedbackReport, submitFeedback],
  );

  useEffect(() => {
    if (!sidebarOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeSidebar();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeSidebar, sidebarOpen]);

  useEffect(() => {
    if (mainContentIsInert) {
      sidebarTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>("#app-sidebar [data-sidebar-initial-focus]")?.focus();
      });
      return;
    }

    if (sidebarTriggerRef.current && document.contains(sidebarTriggerRef.current)) {
      sidebarTriggerRef.current.focus();
    }
    sidebarTriggerRef.current = null;
  }, [mainContentIsInert]);

  return (
    <div className="h-screen overflow-hidden bg-bg-sunken text-text">
      <div className="relative flex h-full bg-bg-sunken">
        <ResponsiveSidebar open={sidebarOpen}>
          <Sidebar
            cwd={cwd}
            threadList={state.threadList}
            activeThreadId={state.activeThreadId}
            attentionThreadIds={attentionThreadIds}
            isLoading={threadMgr.isLoadingThreads}
            error={threadMgr.threadListError}
            onNewThread={handleSidebarNewThread}
            onOpenThread={handleSidebarOpenThread}
            onDeleteThread={handleSidebarDeleteThread}
            onClose={closeSidebar}
          />
        </ResponsiveSidebar>

        <Panel
          onDrop={handleChatFileDrop}
          aria-hidden={mainContentIsInert ? true : undefined}
          inert={mainContentIsInert}
          className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-dark !rounded-none !border-0"
        >
          <AppHeader
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
            onNewThread={handleSidebarNewThread}
            threadStatus={state.threadStatus}
            isCompacting={state.isCompacting}
            threadTitle={threadTitle}
            onOpenKnowledge={() => {
              setShowToolModal(false);
              setShowKnowledgeModal(true);
            }}
            onOpenConfig={() => {
              setShowKnowledgeModal(false);
              setShowToolModal(true);
            }}
          />

          <div className="relative flex min-h-0 flex-1 flex-col">
            {threadMgr.historyError ? (
              // Overlaid rather than stacked above the list: a status line that comes and goes must not
              // move the transcript the reader is looking at.
              <div className="absolute inset-x-0 top-0 z-10 flex flex-col bg-surface-dark/90">
                <div role="alert" className="px-7 py-2 text-sm text-danger">
                  {threadMgr.historyError}
                  {state.activeThreadId ? (
                    <button
                      type="button"
                      className="ml-3 underline"
                      onClick={() => void threadMgr.openThread(state.activeThreadId!)}
                    >
                      Retry opening
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <MessageList
              threadId={state.activeThreadId}
              items={state.items}
              threadStatus={state.threadStatus}
              threadCwd={state.activeThreadCwd ?? undefined}
              hasProvider={providerMgr.effectiveHasProvider}
              oauthPending={oauthPending}
              onOpenProviders={handleOpenProviders}
              onQuickConnectChatGPT={handleQuickConnectChatGPT}
              isCompacting={state.isCompacting}
              approvalPrompt={approvalPrompt}
              questionPrompt={questionPrompt}
              onLoadChildThread={loadChildThread}
              onReportMessage={handleReportMessage}
              onErrorRecovery={handleErrorRecovery}
              hasEarlierHistory={Boolean(state.historyCursor)}
              isLoadingEarlierHistory={threadMgr.isLoadingEarlier}
              earlierHistoryFailed={threadMgr.earlierHistoryFailed}
              onLoadEarlierHistory={threadMgr.loadEarlierHistory}
            />
          </div>

          {state.planState?.steps.some((s) => s.status !== "done") && <PlanPanel planState={state.planState!} />}

          {goalsSupported && state.goal ? (
            <GoalStatus
              goal={state.goal}
              onPause={handleGoalPause}
              onResume={handleGoalResume}
              onClear={handleGoalClear}
            />
          ) : null}

          <SteeringQueuePanel
            pendingSteers={state.pendingSteers}
            onCancelSteer={cancelSteer}
            onUpdateSteer={updateSteer}
          />

          {!providerMgr.hasProvider && state.items.length > 0 ? (
            <div className="mx-3 mb-2 flex items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-text-soft">
              <span>Provider disconnected.</span>
              <button
                type="button"
                onClick={handleOpenProviders}
                className="rounded-md border border-danger/40 bg-danger/15 px-2.5 py-1 text-xs font-medium text-danger transition hover:bg-danger/25"
              >
                Reconnect
              </button>
            </div>
          ) : null}

          <InputDock
            input={activeInput}
            onInputChange={setActiveInput}
            onSend={handleSend}
            onSteer={handleSteer}
            onInterrupt={handleInterrupt}
            onCompactionClick={handleCompactionClick}
            isCompacting={state.isCompacting}
            canSend={canSend}
            canSteer={canSteer}
            threadStatus={state.threadStatus}
            goalStatus={goalsSupported ? state.goal?.status : undefined}
            mode={state.mode}
            onModeChange={handleModeChange}
            effort={effort}
            onEffortChange={handleEffortChange}
            fastMode={fastMode}
            onFastModeChange={actions.handleFastModeChange}
            currentModel={providerMgr.currentModel ? modelOptionKey(providerMgr.currentModel) : ""}
            availableModels={providerMgr.availableModels}
            onModelChange={handleModelChange}
            currentContextTokens={state.currentContextTokens}
            contextWindow={providerMgr.contextWindow}
            hasProvider={providerMgr.hasProvider}
            hasBlockingPrompt={hasBlockingPrompt}
            supportsVision={supportsVision}
            supportsThinking={supportsThinking}
            pendingImages={pendingImagePreviews}
            contextItems={activeContextItems}
            isUploadingImages={isUploadingImages}
            showImageUploadIndicator={showImageUploadIndicator}
            onAddImages={handleAddImagesToDock}
            onRemoveImage={handleRemovePendingImage}
            onRemoveContextItem={removeActiveContextItem}
            onClearContextItems={clearActiveContextItems}
            onSlashCommand={handleSlashCommand}
            slashCommands={slashCommands}
          />

          {feedbackReport ? (
            <FeedbackReportModal
              target={feedbackReport}
              onSubmit={handleSubmitFeedbackReport}
              onCancel={handleCancelFeedbackReport}
            />
          ) : null}

          {showToolModal ? (
            <ToolSettingsModal
              threadId={state.activeThreadId}
              runtimeVersion={runtimeVersion}
              providers={providerMgr.providers}
              desktopNotificationsEnabled={desktopNotificationsEnabled}
              consent={consent}
              onConsentChange={updateConsent}
              onList={listTools}
              onSave={saveTools}
              onListSkills={listSkills}
              onSaveSkills={saveSkills}
              onListExperiments={listExperiments}
              onSaveExperiments={saveExperiments}
              onListSubagents={listSubagents}
              onSaveSubagents={saveSubagents}
              onSkillsChange={setSkills}
              onDesktopNotificationsEnabledChange={setDesktopNotificationsEnabled}
              onOpenProviders={() => {
                setShowProviderModal(true);
              }}
              onOpenMcpServers={() => {
                setShowToolModal(false);
                setShowMcpModal(true);
              }}
              onClose={() => setShowToolModal(false)}
              className="absolute inset-0 z-40 bg-overlay/35"
            />
          ) : null}

          {showMcpModal ? (
            <McpServersModal
              refreshSignal={mcpRefreshNonce}
              onList={listMcpServers}
              onLoginStart={mcpLoginStart}
              onLogout={mcpLogout}
              onClose={() => setShowMcpModal(false)}
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

      {state.toast ? <Toast toast={state.toast} onDismiss={() => dispatch({ type: "clear_toast" })} /> : null}

      {showProviderModal ? (
        <ProviderSettingsModal
          providers={providerMgr.providers}
          focusProvider={focusedProvider ?? undefined}
          oauthPending={oauthPending}
          oauthError={oauthError}
          onSet={providerMgr.handleSetProviderKey}
          onRemove={providerMgr.handleRemoveProviderKey}
          onOAuthStart={handleProviderOAuthStart}
          onOAuthCancel={handleProviderOAuthCancel}
          onClose={handleProviderModalClose}
        />
      ) : null}

      {threadMgr.pendingDeleteThreadId ? (
        <DeleteThreadModal
          onCancel={() => threadMgr.setPendingDeleteThreadId(null)}
          onConfirm={() => void confirmDeleteThread()}
        />
      ) : null}

      {showConnectionModal ? (
        <ConnectionModal
          isReconnecting={connection === "reconnecting"}
          reconnectAttempts={reconnectAttempts}
          retryLimit={retryLimit}
          onRetry={retryConnection}
        />
      ) : null}

      {consent && !consent.noticeAcknowledged ? (
        <FirstRunNoticeModal
          privacyPolicyUrl={consent.privacyPolicyUrl}
          onGetStarted={() => void updateConsent({ noticeAcknowledged: true })}
        />
      ) : null}
    </div>
  );
}
