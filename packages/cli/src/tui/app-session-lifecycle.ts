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
    if (!thread) return;

    const hasSnapshotItems = Array.isArray(thread.items) && thread.items.length > 0;
    if (!hasSnapshotItems) return;

    this.deps.chatView.addLines([`  ${t.dim}─── Resuming session ───${t.reset}`, ""]);

    for (const item of thread.items) {
      if (item.type === "compaction") {
        this.deps.chatView.addLines([`  ${t.dim}[Compacted: ${item.summary}]${t.reset}`, ""]);
        continue;
      }
      if (item.type === "userMessage") {
        const text =
          typeof item.message.content === "string"
            ? item.message.content
            : item.message.content
                .filter((block) => block.type === "text")
                .map((block) => block.text)
                .join("");
        if (text.trim()) this.deps.chatView.addUserMessage(text);
        continue;
      }
      if (item.type === "agentMessage") {
        const thinking = item.message.content
          .filter((block) => block.type === "thinking")
          .map((block) => block.thinking)
          .join("");
        if (thinking.trim()) this.deps.chatView.addThinkingMessage(thinking, item.reasoningDurationMs);

        const text = item.message.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("");
        if (text.length > 0) this.deps.chatView.addAssistantMessage(text);
        continue;
      }
      if (item.type === "toolCall" && typeof item.output === "string") {
        this.deps.chatView.addToolResultMessage({
          role: "tool_result",
          toolCallId: item.toolCallId,
          toolName: item.toolName,
          output: item.output,
          isError: item.isError ?? false,
          timestamp:
            typeof item.startedAt === "number" && typeof item.durationMs === "number"
              ? item.startedAt + item.durationMs
              : (item.timestamp ?? Date.now()),
          render: item.render,
        });
      }
    }

    this.deps.chatView.addLines(["", `  ${t.dim}─── Continue ───${t.reset}`, ""]);
  }
}
