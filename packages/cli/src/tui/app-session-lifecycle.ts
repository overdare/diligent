// @summary Session startup, resume/hydration, and active-thread synchronization helpers for the CLI TUI

import { DILIGENT_CLIENT_NOTIFICATION_METHODS, DILIGENT_CLIENT_REQUEST_METHODS } from "@diligent/protocol";
import { getThinkingEffortLabel, resolveModel } from "@diligent/runtime";
import type { AppConfig } from "../config";
import type { ProviderName } from "../provider-manager";
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
import { t } from "./theme";
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
}

export class AppSessionLifecycle {
  constructor(private deps: AppSessionLifecycleDeps) {}

  async start(): Promise<void> {
    await this.deps.inputHistory.load();
    this.deps.inputEditor.reloadHistory();

    this.deps.renderer.setFocus(this.deps.inputEditor);
    this.deps.renderer.start();

    this.deps.statusBar.update({
      model: this.deps.config.model.id,
      contextWindow: this.deps.config.model.contextWindow,
      status: "idle",
      cwd: process.cwd(),
      mode: this.deps.runtime.currentMode,
      effort: this.deps.runtime.currentEffort,
      effortLabel: getThinkingEffortLabel(this.deps.runtime.currentEffort, this.deps.config.model),
    });

    const currentProvider = (this.deps.config.model.provider ?? "anthropic") as ProviderName;
    if (!this.deps.config.providerManager.hasKeyFor(currentProvider)) {
      await this.deps.setupWizard.runSetupWizard();
    }

    const welcomeLines = buildWelcomeBanner({
      version: this.deps.pkgVersion,
      modelId: this.deps.config.model.id,
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

    await rpcClient.request(DILIGENT_CLIENT_REQUEST_METHODS.INITIALIZE, {
      clientName: "diligent-tui",
      clientVersion: this.deps.pkgVersion,
      protocolVersion: 1,
    });
    await rpcClient.notify(DILIGENT_CLIENT_NOTIFICATION_METHODS.INITIALIZED, { ready: true });

    const resumedId = await this.ensureThread();
    await this.syncActiveThreadState();
    if (resumedId) {
      await this.hydrateThreadHistory();
    }

    this.deps.renderer.requestRender();
  }

  async syncActiveThreadState(): Promise<void> {
    const thread = await this.deps.threadManager.readThread();
    if (!thread) return;

    this.deps.runtime.currentEffort = thread.currentEffort;

    let activeModel = this.deps.config.model;
    let modelId = activeModel.id;
    let contextWindow = activeModel.contextWindow;

    if (thread.currentModel) {
      modelId = thread.currentModel;
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
      effortLabel: getThinkingEffortLabel(thread.currentEffort, activeModel),
    });
    this.deps.renderer.requestRender();
  }

  private async ensureThread(): Promise<string | null> {
    let resumedId: string | null = null;
    if (this.deps.options?.resumeId) {
      resumedId = await this.deps.threadManager.resumeThread(this.deps.options.resumeId);
      if (!resumedId) {
        this.deps.chatView.addLines([`  ${t.error}Session not found: ${this.deps.options.resumeId}${t.reset}`]);
        await this.deps.threadManager.startNewThread();
      }
    } else if (this.deps.options?.resume) {
      resumedId = await this.deps.threadManager.resumeThread();
      if (!resumedId) {
        await this.deps.threadManager.startNewThread();
      }
    } else {
      await this.deps.threadManager.startNewThread();
    }
    return resumedId;
  }

  private async hydrateThreadHistory(): Promise<void> {
    const thread = await this.deps.threadManager.readThread();
    if (!thread?.transcript?.length) return;

    this.deps.chatView.addLines([`  ${t.dim}─── Resuming session ───${t.reset}`, ""]);

    for (const entry of thread.transcript) {
      if (entry.type === "compaction") {
        this.deps.chatView.addLines([`  ${t.dim}[Compacted: ${entry.summary}]${t.reset}`, ""]);
      } else if (entry.type === "message") {
        const msg = entry.message;
        if (msg.role === "user") {
          const text =
            typeof msg.content === "string"
              ? msg.content
              : msg.content
                  .filter((b) => b.type === "text")
                  .map((b) => (b as { text: string }).text)
                  .join("");
          if (text.trim()) this.deps.chatView.addUserMessage(text);
        } else if (msg.role === "assistant") {
          const thinkingBlocks = msg.content.filter((b) => b.type === "thinking");
          if (thinkingBlocks.length > 0) {
            const fullThinking = thinkingBlocks.map((b) => (b as { thinking: string }).thinking).join("");
            if (fullThinking.trim()) this.deps.chatView.addThinkingMessage(fullThinking);
          }

          const textBlocks = msg.content.filter((b) => b.type === "text");
          if (textBlocks.length > 0) {
            const fullText = textBlocks.map((b) => (b as { text: string }).text).join("");
            this.deps.chatView.addAssistantMessage(fullText);
          }
        } else if (msg.role === "tool_result") {
          this.deps.chatView.addToolResultMessage(msg);
        }
      }
    }

    this.deps.chatView.addLines(["", `  ${t.dim}─── Continue ───${t.reset}`, ""]);
  }
}
