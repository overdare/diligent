// @summary Session startup, resume/hydration, and active-thread synchronization helpers for the CLI TUI

import { DILIGENT_CLIENT_NOTIFICATION_METHODS, DILIGENT_CLIENT_REQUEST_METHODS } from "@diligent/protocol";
import { formatModelRef, resolveModel } from "@diligent/runtime";
import { applyGoalSnapshot, goalStopMessage } from "@diligent/runtime/client";
import type { AppConfig } from "../config";
import { DEFAULT_PROVIDER, getDefaultModelRef, type ProviderName } from "../provider-manager";
import { buildWelcomeBanner } from "./app-presenter";
import type { AppRuntimeState } from "./app-runtime-state";
import type { ChatView } from "./components/chat-view";
import type { InputEditor } from "./components/input-editor";
import type { StatusBar } from "./components/status-bar";
import type { TUIRenderer } from "./framework/renderer";
import type { Terminal } from "./framework/terminal";
import type { InputHistory } from "./input-history";
import type { SpawnedAppServer } from "./rpc-client";
import type { SetupWizard } from "./setup-wizard";
import type { ThreadManager } from "./thread-manager";

export interface AppSessionLifecycleDeps {
  config: AppConfig;
  runtime: AppRuntimeState;
  terminal: Terminal;
  renderer: TUIRenderer;
  inputHistory: InputHistory;
  inputEditor: InputEditor;
  statusBar: StatusBar;
  chatView: ChatView;
  setupWizard: SetupWizard;
  threadManager: ThreadManager;
  pathsAvailable: boolean;
  getRpcClient: () => SpawnedAppServer | null;
  restartRpcClient: () => Promise<void>;
  options?: {
    resume?: boolean;
    resumeId?: string;
  };
  pkgVersion: string;
  setGoalsSupported?: (supported: boolean) => void;
}

export class AppSessionLifecycle {
  constructor(private deps: AppSessionLifecycleDeps) {}

  async start(): Promise<void> {
    await this.deps.inputHistory.load();
    this.deps.inputEditor.reloadHistory();

    this.deps.renderer.setFocus(this.deps.inputEditor);
    this.deps.renderer.start();

    await this.ensureConfiguredProviderOrFallback();

    this.deps.statusBar.update({
      model: formatModelRef(this.deps.config.model),
      contextWindow: this.deps.config.model.contextWindow,
      status: "idle",
      cwd: process.cwd(),
      mode: this.deps.runtime.currentMode,
      effort: this.deps.runtime.currentEffort,
      effortLabel: this.deps.runtime.currentEffort,
      fastMode: this.deps.runtime.currentFastMode,
      supportsFastMode: this.deps.config.model.supportsFastMode,
    });

    const welcomeLines = buildWelcomeBanner({
      version: this.deps.pkgVersion,
      modelId: formatModelRef(this.deps.config.model),
      cwd: process.cwd(),
      terminalColumns: this.deps.terminal.columns,
      yolo: Boolean(this.deps.config.diligent.yolo),
    });
    this.deps.chatView.addLines(welcomeLines);

    if (!this.deps.pathsAvailable) {
      throw new Error("No .diligent directory paths are available.");
    }

    await this.deps.restartRpcClient();

    const rpcClient = this.deps.getRpcClient();
    if (!rpcClient) {
      throw new Error("App server failed to start.");
    }

    const initialized = await rpcClient.request(DILIGENT_CLIENT_REQUEST_METHODS.INITIALIZE, {
      clientName: "diligent-tui",
      clientVersion: this.deps.pkgVersion,
      protocolVersion: 1,
    });
    this.deps.setGoalsSupported?.(initialized.capabilities?.goals === true);
    await rpcClient.notify(DILIGENT_CLIENT_NOTIFICATION_METHODS.INITIALIZED, { ready: true });

    await this.ensureThread();
    await this.syncActiveThreadState();

    this.deps.renderer.requestRender();
  }

  private async ensureConfiguredProviderOrFallback(): Promise<void> {
    const currentProvider = (this.deps.config.model.provider ?? DEFAULT_PROVIDER) as ProviderName;
    if (this.deps.config.providerManager.hasKeyFor(currentProvider)) {
      return;
    }

    const fallbackProvider = this.deps.config.providerManager.getConfiguredProviders()[0];
    if (fallbackProvider) {
      this.deps.config.model = resolveModel(getDefaultModelRef(fallbackProvider));
      return;
    }

    await this.deps.setupWizard.runSetupWizard();
  }

  async syncActiveThreadState(): Promise<void> {
    const threadId = this.deps.runtime.currentThreadId;
    const thread = await this.deps.threadManager.readThread();
    if (!thread || threadId !== this.deps.runtime.currentThreadId) return;

    this.deps.runtime.currentEffort = thread.currentEffort;
    this.deps.runtime.currentFastMode = thread.currentFastMode ?? false;
    const previous = this.deps.runtime.goalSnapshot.goal;
    this.deps.runtime.goalSnapshot = applyGoalSnapshot(this.deps.runtime.goalSnapshot ?? { goal: null, sequence: 0 }, {
      goal: thread.goal ?? null,
      sequence: thread.goalSequence ?? 0,
    });
    const goal = this.deps.runtime.goalSnapshot.goal;
    const stopMessage = goal && goalStopMessage(goal);
    if (
      stopMessage &&
      (previous?.id !== goal.id || previous?.status !== goal.status || previous?.reason !== goal.reason)
    ) {
      this.deps.chatView.addLines([stopMessage, "Resume: /goal resume"], { separateBefore: true });
    }

    let activeModel = this.deps.config.model;
    let modelId = formatModelRef(activeModel);
    let contextWindow = activeModel.contextWindow;

    if (thread.currentModel) {
      modelId = formatModelRef(thread.currentModel);
      try {
        activeModel = resolveModel(thread.currentModel);
        this.deps.config.model = activeModel;
        contextWindow = activeModel.contextWindow;
      } catch {
        activeModel = this.deps.config.model;
      }
    }

    this.deps.statusBar.update({
      model: modelId,
      contextWindow,
      effort: thread.currentEffort,
      effortLabel: thread.currentEffort,
      fastMode: this.deps.runtime.currentFastMode,
      supportsFastMode: activeModel.supportsFastMode,
      goal: goal
        ? {
            status: goal.status,
            tokensUsed: goal.tokensUsed,
            tokenBudget: goal.tokenBudget,
            turnsUsed: goal.turnsUsed,
            maxTurns: goal.maxTurns,
          }
        : undefined,
    });
    this.deps.renderer.requestRender();
  }

  private async ensureThread(): Promise<string | null> {
    if (this.deps.options?.resumeId) {
      return this.deps.threadManager.resumeThread(this.deps.options.resumeId);
    }
    if (this.deps.options?.resume) return this.deps.threadManager.resumeThread();
    return this.deps.threadManager.startNewThread();
  }
}
