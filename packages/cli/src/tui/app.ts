// @summary Main TUI application component managing the agent loop and interface
import type {
  AgentEvent,
  ApprovalRequest,
  ApprovalResponse,
  DiligentPaths,
  SkillMetadata,
  UserInputRequest,
} from "@diligent/core";
import { ProtocolNotificationAdapter } from "@diligent/core";
import type {
  DiligentServerNotification,
  DiligentServerRequest,
  DiligentServerRequestResponse,
  Mode as ProtocolMode,
} from "@diligent/protocol";
import {
  DILIGENT_CLIENT_NOTIFICATION_METHODS,
  DILIGENT_CLIENT_REQUEST_METHODS,
  DILIGENT_SERVER_NOTIFICATION_METHODS,
  DILIGENT_SERVER_REQUEST_METHODS,
} from "@diligent/protocol";
import { version as pkgVersion } from "../../package.json";
import type { AppConfig } from "../config";
import { DEFAULT_PROVIDER, type ProviderName } from "../provider-manager";
import { type CommandHandler, createCommandHandler } from "./command-handler";
import { registerBuiltinCommands } from "./commands/builtin/index";
import { CommandRegistry } from "./commands/registry";
import { ApprovalDialog } from "./components/approval-dialog";
import { ChatView } from "./components/chat-view";
import { ConfirmDialog, type ConfirmDialogOptions } from "./components/confirm-dialog";
import { InputEditor } from "./components/input-editor";
import { QuestionInput } from "./components/question-input";
import { StatusBar } from "./components/status-bar";
import { type ConfigManager, createConfigManager } from "./config-manager";
import { Container } from "./framework/container";
import { matchesKey } from "./framework/keys";
import { OverlayStack } from "./framework/overlay";
import { TUIRenderer } from "./framework/renderer";
import { StdinBuffer } from "./framework/stdin-buffer";
import { Terminal } from "./framework/terminal";
import { InputHistory } from "./input-history";
import type { SpawnedAppServer } from "./rpc-client";
import { type SpawnRpcClientOptions, spawnCliAppServer } from "./rpc-framed-client";
import { createSetupWizard, type SetupWizard } from "./setup-wizard";
import { t } from "./theme";
import { createThreadManager, type ThreadManager } from "./thread-manager";

export interface AppOptions {
  resume?: boolean;
  rpcClientFactory?: (options: SpawnRpcClientOptions) => Promise<SpawnedAppServer>;
}

export class App {
  private terminal: Terminal;
  private renderer: TUIRenderer;
  private overlayStack: OverlayStack;
  private stdinBuffer: StdinBuffer;
  private root: Container;

  // Components
  private chatView: ChatView;
  private inputEditor: InputEditor;
  private statusBar: StatusBar;

  // Commands & Skills
  private commandRegistry: CommandRegistry;
  private skills: SkillMetadata[];

  // History
  private inputHistory: InputHistory;

  // State
  private isProcessing = false;
  private rpcClient: SpawnedAppServer | null = null;
  private notificationAdapter = new ProtocolNotificationAdapter();
  private currentThreadId: string | null = null;
  private pendingTurn: {
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;
  private currentMode: ProtocolMode;

  // Extracted modules
  private threadManager: ThreadManager;
  private configManager: ConfigManager;
  private commandHandler: CommandHandler;
  private setupWizard: SetupWizard;

  constructor(
    private config: AppConfig,
    private paths?: DiligentPaths,
    private options?: AppOptions,
  ) {
    this.currentMode = config.mode;
    this.terminal = new Terminal();
    this.overlayStack = new OverlayStack();
    this.stdinBuffer = new StdinBuffer();

    // Initialize command registry
    this.skills = config.skills ?? [];
    this.commandRegistry = new CommandRegistry();
    registerBuiltinCommands(this.commandRegistry, this.skills);

    const requestRender = () => this.renderer.requestRender();

    // Input history (loaded async in start())
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    this.inputHistory = new InputHistory(`${home}/.config/diligent/history`);

    // Build component tree
    this.chatView = new ChatView({ requestRender });
    this.inputEditor = new InputEditor(
      {
        onSubmit: (text) => {
          if (this.isProcessing) {
            this.commandHandler.handleSteering(text);
          } else {
            this.commandHandler.handleSubmit(text);
          }
        },
        onCancel: () => this.handleCancel(),
        onExit: () => this.shutdown(),
        onComplete: (partial) => this.commandRegistry.complete(partial),
        onCompleteDetailed: (partial) => this.commandRegistry.completeDetailed(partial),
        history: this.inputHistory,
      },
      requestRender,
    );
    this.statusBar = new StatusBar();

    this.root = new Container();
    this.root.addChild(this.chatView);
    this.root.addChild(this.inputEditor);
    this.root.addChild(this.statusBar);

    this.renderer = new TUIRenderer(this.terminal, this.root);
    this.renderer.setOverlayStack(this.overlayStack);

    // Wire extracted modules
    this.threadManager = createThreadManager({
      getRpcClient: () => this.rpcClient,
      getCurrentMode: () => this.currentMode,
      setCurrentThreadId: (id) => {
        this.currentThreadId = id;
      },
      updateStatusBar: (updates) => this.statusBar.update(updates),
    });

    this.configManager = createConfigManager({
      getRpcClient: () => this.rpcClient,
      getCurrentThreadId: () => this.currentThreadId,
      getConfig: () => this.config,
      setConfig: (c) => {
        this.config = c;
      },
      getPaths: () => this.paths,
      setCurrentMode: (mode) => {
        this.currentMode = mode;
      },
      restartRpcClient: async () => {
        await this.restartRpcClient();
      },
      setSkills: (s) => {
        this.skills = s;
      },
      setCommandRegistry: (r) => {
        this.commandRegistry = r;
      },
      updateStatusBar: (updates) => this.statusBar.update(updates),
      displayError: (msg) => {
        this.chatView.addLines([`  ${t.error}${msg}${t.reset}`]);
      },
      requestRender: () => this.renderer.requestRender(),
    });

    this.commandHandler = createCommandHandler({
      getRpcClient: () => this.rpcClient,
      getCurrentThreadId: () => this.currentThreadId,
      getConfig: () => this.config,
      getCommandRegistry: () => this.commandRegistry,
      getSkills: () => this.skills,
      getCurrentMode: () => this.currentMode,
      getIsProcessing: () => this.isProcessing,
      setIsProcessing: (val) => {
        this.isProcessing = val;
      },
      setPendingTurn: (turn) => {
        this.pendingTurn = turn;
      },
      addUserMessage: (text) => this.chatView.addUserMessage(text),
      addLines: (lines) => this.chatView.addLines(lines),
      clearActive: () => this.chatView.clearActive(),
      handleAgentStartEvent: () => this.chatView.handleEvent({ type: "agent_start" }),
      handleTurnError: (err) => {
        this.chatView.handleEvent({
          type: "error",
          error: {
            message: err instanceof Error ? err.message : String(err),
            name: err instanceof Error ? err.name : "Error",
          },
          fatal: false,
        });
      },
      updateStatusBar: (updates) => this.statusBar.update(updates),
      requestRender: () => this.renderer.requestRender(),
      showOverlay: (c, o) => this.overlayStack.show(c, o),
      confirm: (o) => this.confirm(o),
      shutdown: () => this.shutdown(),
      onModelChanged: (modelId) => {
        this.statusBar.update({ model: modelId });
        this.renderer.requestRender();
      },
      threadManager: this.threadManager,
      configManager: this.configManager,
    });

    this.setupWizard = createSetupWizard({
      config: this.config,
      addLines: (lines) => this.chatView.addLines(lines),
      requestRender: () => this.renderer.requestRender(),
      showOverlay: (c, o) => this.overlayStack.show(c, o),
      buildCommandContext: () => this.commandHandler.buildCommandContext(),
      updateStatusBar: (updates) => this.statusBar.update(updates),
    });
  }

  async start(): Promise<void> {
    // Load persistent input history
    await this.inputHistory.load();
    this.inputEditor.reloadHistory();

    // Start terminal and rendering first (overlays need renderer to be active)
    this.terminal.start(
      (data) => this.handleInput(data),
      () => this.renderer.requestRender(),
    );
    this.renderer.setFocus(this.inputEditor);
    this.renderer.start();

    // Update status bar with model info and cwd
    this.statusBar.update({
      model: this.config.model.id,
      contextWindow: this.config.model.contextWindow,
      status: "idle",
      cwd: process.cwd(),
      mode: this.currentMode,
    });

    // Setup wizard: if current provider has no API key, prompt user
    const currentProvider = (this.config.model.provider ?? DEFAULT_PROVIDER) as ProviderName;
    if (!this.config.providerManager.hasKeyFor(currentProvider)) {
      await this.setupWizard.runSetupWizard();
    }

    // Show welcome banner
    this.chatView.addLines(this.buildWelcomeBanner());

    if (!this.paths) {
      throw new Error("No .diligent directory paths are available.");
    }

    await this.restartRpcClient();

    const rpcClient = this.rpcClient;
    if (!rpcClient) {
      throw new Error("App server failed to start.");
    }

    await rpcClient.request(DILIGENT_CLIENT_REQUEST_METHODS.INITIALIZE, {
      clientName: "diligent-tui",
      clientVersion: pkgVersion,
      protocolVersion: 1,
    });
    await rpcClient.notify(DILIGENT_CLIENT_NOTIFICATION_METHODS.INITIALIZED, { ready: true });

    if (this.options?.resume) {
      const resumedId = await this.threadManager.resumeThread();
      if (!resumedId) {
        await this.threadManager.startNewThread();
      }
    } else {
      await this.threadManager.startNewThread();
    }

    this.renderer.requestRender();
  }

  private async restartRpcClient(): Promise<void> {
    this.rpcClient?.setNotificationListener(null);
    this.rpcClient?.setServerRequestHandler(null);
    await this.rpcClient?.dispose().catch(() => {});
    const spawnFn = this.options?.rpcClientFactory ?? spawnCliAppServer;
    this.rpcClient = await spawnFn({
      cwd: process.cwd(),
      yolo: this.config.diligent.yolo,
      onStderrLine: (line) => this.handleAppServerStderr(line),
    });
    this.rpcClient.setNotificationListener((notification) => this.handleServerNotification(notification));
    this.rpcClient.setServerRequestHandler((request) => this.handleServerRequest(request));
  }

  private handleInput(data: string): void {
    const sequences = this.stdinBuffer.split(data);

    for (const seq of sequences) {
      // Inline question in chat takes input priority over overlay and editor
      if (this.chatView.hasActiveQuestion()) {
        this.chatView.handleQuestionInput(seq);
        this.renderer.requestRender();
        continue;
      }

      // Overlay takes all input when visible
      if (this.overlayStack.hasVisible()) {
        const topComponent = this.overlayStack.getTopComponent();
        topComponent?.handleInput?.(seq);
        this.renderer.requestRender();
        continue;
      }

      // Shift+Tab: cycle collaboration mode (available always when no overlay)
      if (matchesKey(seq, "shift+tab")) {
        this.cycleMode();
        continue;
      }

      if (matchesKey(seq, "ctrl+c") || matchesKey(seq, "escape")) {
        this.handleCancel();
      } else {
        this.inputEditor.handleInput(seq);
      }
    }
  }

  private cycleMode(): void {
    const modes: ProtocolMode[] = ["default", "plan", "execute"];
    const idx = modes.indexOf(this.currentMode);
    const next = modes[(idx + 1) % modes.length];
    this.configManager.setMode(next);
  }

  private handleAgentEvent(event: AgentEvent): void {
    this.chatView.handleEvent(event);

    // Update status bar with usage info
    if (event.type === "usage") {
      this.statusBar.update({
        tokensUsed: event.usage.inputTokens,
      });
    } else if (event.type === "status_change") {
      this.statusBar.update({ status: event.status });
    }
  }

  private handleCancel(): void {
    if (this.isProcessing && this.rpcClient && this.currentThreadId) {
      void this.rpcClient
        .request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_INTERRUPT, { threadId: this.currentThreadId })
        .catch(() => {});
      this.chatView.clearActive();
      this.chatView.addLines([`  ${t.dim}Cancelled.${t.reset}`]);
      this.pendingTurn?.resolve();
    } else if (!this.isProcessing) {
      this.shutdown();
    }
  }

  private handleAppServerStderr(_line: string): void {
    // App-server stderr (operational logs) is intentionally suppressed in TUI.
    // Errors surface as RPC error responses, not as raw log lines.
  }

  private async handleServerNotification(notification: DiligentServerNotification): Promise<void> {
    const threadId = "threadId" in notification.params ? notification.params.threadId : undefined;
    if (threadId && this.currentThreadId && threadId !== this.currentThreadId) {
      return;
    }

    const agentEvents = this.notificationAdapter.toAgentEvents(notification);
    for (const event of agentEvents) {
      this.handleAgentEvent(event);
    }

    if (
      notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED &&
      this.currentThreadId &&
      notification.params.threadId === this.currentThreadId
    ) {
      this.pendingTurn?.resolve();
    }

    if (
      notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.ERROR &&
      this.pendingTurn &&
      (!notification.params.threadId || notification.params.threadId === this.currentThreadId)
    ) {
      this.pendingTurn.reject(new Error(notification.params.error.message));
    }

    this.renderer.requestRender();
  }

  private async handleServerRequest(request: DiligentServerRequest): Promise<DiligentServerRequestResponse> {
    if (request.method === DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST) {
      const decision = await this.handleApprove(request.params.request);
      return {
        method: DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST,
        result: { decision },
      };
    }

    const result = await this.handleAsk(request.params.request);
    return {
      method: DILIGENT_SERVER_REQUEST_METHODS.USER_INPUT_REQUEST,
      result,
    };
  }

  /** Show a confirmation dialog overlay */
  async confirm(options: ConfirmDialogOptions): Promise<boolean> {
    return this.showConfirm(options);
  }

  private showConfirm(options: ConfirmDialogOptions): Promise<boolean> {
    return new Promise((resolve) => {
      const dialog = new ConfirmDialog(options, (confirmed) => {
        handle.hide();
        this.renderer.setFocus(this.inputEditor);
        this.renderer.requestRender();
        resolve(confirmed);
      });
      const handle = this.overlayStack.show(dialog, { anchor: "center" });
      this.renderer.requestRender();
    });
  }

  /** approve callback — evaluate/remember now lives in the agent loop */
  private async handleApprove(request: ApprovalRequest): Promise<ApprovalResponse> {
    return this.showApprovalDialog(request);
  }

  /** ask callback — show TextInput overlay for each question sequentially */
  private async handleAsk(request: UserInputRequest): Promise<import("@diligent/core").UserInputResponse> {
    const answers: Record<string, string | string[]> = {};
    for (const question of request.questions) {
      answers[question.id] = await this.showTextInputOverlay(question);
    }
    return { answers };
  }

  /** Show approval dialog overlay — returns Once/Always/Reject */
  private showApprovalDialog(request: ApprovalRequest): Promise<ApprovalResponse> {
    return new Promise((resolve) => {
      const dialog = new ApprovalDialog(
        {
          toolName: request.toolName,
          permission: request.permission,
          description: request.description,
          details: request.details?.command
            ? String(request.details.command)
            : (request.details?.file_path ?? request.details?.path)
              ? String(request.details.file_path ?? request.details.path)
              : undefined,
        },
        (response) => {
          handle.hide();
          this.renderer.setFocus(this.inputEditor);
          this.renderer.requestRender();
          resolve(response);
        },
      );
      const handle = this.overlayStack.show(dialog, { anchor: "center" });
      this.renderer.requestRender();
    });
  }

  /** Show question input inline in the chat stream */
  private showTextInputOverlay(question: import("@diligent/core").UserInputQuestion): Promise<string | string[]> {
    return new Promise((resolve) => {
      const input = new QuestionInput(
        {
          header: question.header,
          question: question.question,
          options: question.options,
          allowMultiple: question.allow_multiple,
          allowOther: question.is_other,
          masked: question.is_secret,
          placeholder: question.is_secret ? "enter value\u2026" : undefined,
        },
        (value) => {
          this.chatView.setActiveQuestion(null);
          this.renderer.requestRender();
          if (Array.isArray(value)) {
            resolve(value);
            return;
          }
          resolve(value ?? "");
        },
      );
      this.chatView.setActiveQuestion(input);
      this.renderer.requestRender();
    });
  }

  /** Stop the TUI */
  stop(): void {
    this.overlayStack.clear();
    this.renderer.stop();
    this.terminal.stop();
    void this.rpcClient?.dispose().catch(() => {});
  }

  private buildWelcomeBanner(): string[] {
    const cwd = process.cwd();
    const home = process.env.HOME ?? "";
    const dir = home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;

    const boxWidth = Math.min(54, Math.max(44, this.terminal.columns - 2));
    const inner = boxWidth - 4; // 2 borders + 2 spaces padding

    const pad = (s: string) => s + " ".repeat(Math.max(0, inner - s.length));
    const truncate = (s: string) => (s.length > inner ? `${s.slice(0, inner - 1)}\u2026` : s);

    const title = `>_ diligent (v${pkgVersion})`;
    const modelLine = truncate(`model:     ${this.config.model.id}`);
    const dirLine = truncate(`directory: ${dir}`);
    const yoloLine = this.config.diligent.yolo ? truncate("yolo:      ON ⚡ all permissions auto-approved") : "";

    const row = (s: string) => `${t.dim}│ ${pad(s)} │${t.reset}`;

    return [
      `${t.dim}╭${"─".repeat(boxWidth - 2)}╮${t.reset}`,
      `${t.dim}│${t.reset} ${t.bold}${pad(title)}${t.reset} ${t.dim}│${t.reset}`,
      row(""),
      row(modelLine),
      row(dirLine),
      ...(yoloLine ? [`${t.dim}│${t.reset} ${t.warn}${pad(yoloLine)}${t.reset} ${t.dim}│${t.reset}`] : []),
      `${t.dim}╰${"─".repeat(boxWidth - 2)}╯${t.reset}`,
      "",
      `${t.dim}  Tip: /help for commands · ctrl+c to cancel · ctrl+d to exit${t.reset}`,
      "",
    ];
  }

  private shutdown(): void {
    this.stop();
    this.terminal.write(`\n${t.dim}Goodbye!${t.reset}\n`);
    process.exit(0);
  }
}
