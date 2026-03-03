// @summary Main TUI application component managing the agent loop and interface
import type {
  AgentEvent,
  AgentRegistry,
  ApprovalRequest,
  ApprovalResponse,
  DiligentAppServerConfig,
  DiligentPaths,
  ModeKind,
  SkillMetadata,
  UserInputRequest,
} from "@diligent/core";
import {
  createPermissionEngine,
  createYoloPermissionEngine,
  DiligentAppServer,
  ensureDiligentDir,
  resolveModel,
} from "@diligent/core";
import type {
  DiligentServerNotification,
  DiligentServerRequest,
  DiligentServerRequestResponse,
  Mode as ProtocolMode,
  SessionSummary,
  ThreadReadResponse,
} from "@diligent/protocol";
import { version as pkgVersion } from "../../package.json";
import type { AppConfig } from "../config";
import { loadConfig } from "../config";
import { DEFAULT_MODELS, PROVIDER_HINTS, PROVIDER_NAMES, type ProviderName } from "../provider-manager";
import { registerBuiltinCommands } from "./commands/builtin/index";
import { promptSaveKey } from "./commands/builtin/provider";
import { parseCommand } from "./commands/parser";
import { CommandRegistry } from "./commands/registry";
import type { CommandContext } from "./commands/types";
import { ApprovalDialog } from "./components/approval-dialog";
import { ChatView } from "./components/chat-view";
import { ConfirmDialog, type ConfirmDialogOptions } from "./components/confirm-dialog";
import { InputEditor } from "./components/input-editor";
import { ListPicker, type ListPickerItem } from "./components/list-picker";
import { QuestionInput } from "./components/question-input";
import { StatusBar } from "./components/status-bar";
import { TextInput } from "./components/text-input";
import { Container } from "./framework/container";
import { matchesKey } from "./framework/keys";
import { OverlayStack } from "./framework/overlay";
import { TUIRenderer } from "./framework/renderer";
import { StdinBuffer } from "./framework/stdin-buffer";
import { Terminal } from "./framework/terminal";
import { InputHistory } from "./input-history";
import { LocalAppServerRpcClient, ProtocolNotificationAdapter } from "./rpc-client";
import { t } from "./theme";
import { buildTools } from "./tools";

export interface AppOptions {
  resume?: boolean;
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
  private rpcClient: LocalAppServerRpcClient | null = null;
  private notificationAdapter = new ProtocolNotificationAdapter();
  private currentThreadId: string | null = null;
  private pendingTurn: {
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;
  private currentMode: ProtocolMode;
  private agentRegistry: AgentRegistry | undefined;
  private permissionEngine: ReturnType<typeof createPermissionEngine> | undefined;

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
            this.handleSteering(text);
          } else {
            this.handleSubmit(text);
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
    this.statusBar.update({ model: this.config.model.id, status: "idle", cwd: process.cwd(), mode: this.currentMode });

    // Setup wizard: if current provider has no API key, prompt user
    const currentProvider = (this.config.model.provider ?? "anthropic") as ProviderName;
    if (!this.config.providerManager.hasKeyFor(currentProvider)) {
      await this.runSetupWizard();
    }

    // Show welcome banner
    this.chatView.addLines(this.buildWelcomeBanner());

    // Initialize PermissionEngine — yolo mode auto-approves everything
    this.permissionEngine = this.config.diligent.yolo
      ? createYoloPermissionEngine()
      : createPermissionEngine(this.config.diligent.permissions ?? []);

    if (!this.paths) {
      throw new Error("No .diligent directory paths are available.");
    }

    const server = this.createAppServer(this.paths);
    this.rpcClient = new LocalAppServerRpcClient(server);
    this.rpcClient.setNotificationListener((notification) => this.handleServerNotification(notification));
    this.rpcClient.setServerRequestHandler((request) => this.handleServerRequest(request));

    await this.rpcClient.request("initialize", {
      clientName: "diligent-tui",
      clientVersion: pkgVersion,
      protocolVersion: 1,
    });
    await this.rpcClient.notify("initialized", { ready: true });

    if (this.options?.resume) {
      const resumedId = await this.resumeThread();
      if (!resumedId) {
        await this.startNewThread();
      }
    } else {
      await this.startNewThread();
    }

    this.renderer.requestRender();
  }

  /** Setup wizard: provider selection → API key input → save confirmation */
  private async runSetupWizard(): Promise<void> {
    this.chatView.addLines(["", `  ${t.warn}No API key found.${t.reset} Let's set one up.`, ""]);
    this.renderer.requestRender();

    // Step 1: Pick provider
    const provider = await this.wizardPickProvider();
    if (!provider) {
      this.chatView.addLines([
        `  ${t.dim}Setup skipped. Use /provider set <anthropic|openai> to configure later.${t.reset}`,
        "",
      ]);
      this.renderer.requestRender();
      return;
    }

    // Step 2: Enter API key
    const apiKey = await this.wizardEnterApiKey(provider);
    if (!apiKey) {
      this.chatView.addLines([
        `  ${t.dim}Setup skipped. Use /provider set ${provider} to configure later.${t.reset}`,
        "",
      ]);
      this.renderer.requestRender();
      return;
    }

    // Apply key immediately
    this.config.providerManager.setApiKey(provider, apiKey);

    // Step 3: Save to global config?
    const ctx = this.buildCommandContext();
    await promptSaveKey(provider, apiKey, ctx);

    // Switch model if the selected provider differs from current
    const currentProvider = this.config.model.provider ?? "anthropic";
    if (currentProvider !== provider) {
      const defaultModelId = DEFAULT_MODELS[provider];
      this.config.model = resolveModel(defaultModelId);
      this.statusBar.update({ model: this.config.model.id });
    }

    this.chatView.addLines([`  ${t.success}Ready!${t.reset} Using ${t.bold}${this.config.model.id}${t.reset}`, ""]);
    this.renderer.requestRender();
  }

  private wizardPickProvider(): Promise<ProviderName | null> {
    return new Promise((resolve) => {
      const items: ListPickerItem[] = PROVIDER_NAMES.map((p) => ({
        label: p,
        description: this.config.providerManager.hasKeyFor(p) ? "configured" : "no key",
        value: p,
      }));

      const picker = new ListPicker({ title: "Select Provider", items }, (value) => {
        handle.hide();
        this.renderer.requestRender();
        resolve(value as ProviderName | null);
      });
      const handle = this.overlayStack.show(picker, { anchor: "center" });
      this.renderer.requestRender();
    });
  }

  private wizardEnterApiKey(provider: ProviderName): Promise<string | null> {
    return new Promise((resolve) => {
      const { apiKeyUrl: hint, apiKeyPlaceholder: placeholder } = PROVIDER_HINTS[provider];

      const input = new TextInput(
        {
          title: `${provider} API Key`,
          message: `Enter your ${provider} API key (${hint})`,
          placeholder,
          masked: true,
        },
        (value) => {
          handle.hide();
          this.renderer.requestRender();
          resolve(value);
        },
      );
      const handle = this.overlayStack.show(input, { anchor: "center" });
      this.renderer.requestRender();
    });
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
    this.setMode(next);
  }

  private async handleSubmit(text: string): Promise<void> {
    // Check for slash command
    const parsed = parseCommand(text);
    if (parsed) {
      await this.handleCommand(parsed.name, parsed.args);
      return;
    }

    if (!this.rpcClient) {
      this.chatView.addLines([`  ${t.error}App server is not initialized.${t.reset}`]);
      this.renderer.requestRender();
      return;
    }
    if (!this.currentThreadId) {
      await this.startNewThread();
    }
    if (!this.currentThreadId) {
      this.chatView.addLines([`  ${t.error}No active thread.${t.reset}`]);
      this.renderer.requestRender();
      return;
    }

    this.isProcessing = true;

    this.chatView.addUserMessage(text);
    this.chatView.handleEvent({ type: "agent_start" });
    this.statusBar.update({ status: "busy" });
    this.renderer.requestRender();

    try {
      const turnCompleted = new Promise<void>((resolve, reject) => {
        this.pendingTurn = { resolve, reject };
      });
      await this.rpcClient.request("turn/start", {
        threadId: this.currentThreadId,
        message: text,
      });
      await turnCompleted;
    } catch (err) {
      this.chatView.handleEvent({
        type: "error",
        error: {
          message: err instanceof Error ? err.message : String(err),
          name: err instanceof Error ? err.name : "Error",
        },
        fatal: false,
      });
    }

    this.pendingTurn = null;
    this.isProcessing = false;
    this.statusBar.update({ status: "idle" });
    this.renderer.requestRender();
  }

  private async handleCommand(name: string, args: string | undefined): Promise<void> {
    const command = this.commandRegistry.get(name);
    if (!command) {
      this.chatView.addLines([
        `  ${t.error}Unknown command: /${name}${t.reset}`,
        "  Type /help for available commands.",
      ]);
      this.renderer.requestRender();
      return;
    }

    if (this.isProcessing && !command.availableDuringTask) {
      this.chatView.addLines([`  ${t.warn}Command not available while agent is running.${t.reset}`]);
      this.renderer.requestRender();
      return;
    }

    const ctx = this.buildCommandContext();
    try {
      await command.handler(args, ctx);
    } catch (err) {
      this.chatView.addLines([
        `  ${t.error}Command error: ${err instanceof Error ? err.message : String(err)}${t.reset}`,
      ]);
    }
    this.renderer.requestRender();
  }

  private buildCommandContext(): CommandContext {
    return {
      app: { confirm: (o) => this.confirm(o), stop: () => this.shutdown() },
      config: this.config,
      threadId: this.currentThreadId,
      skills: this.skills,
      registry: this.commandRegistry,
      requestRender: () => this.renderer.requestRender(),
      displayLines: (lines) => {
        this.chatView.addLines(lines);
        this.renderer.requestRender();
      },
      displayError: (msg) => {
        this.chatView.addLines([`  ${t.error}${msg}${t.reset}`]);
        this.renderer.requestRender();
      },
      showOverlay: (c, o) => this.overlayStack.show(c, o),
      runAgent: (text) => this.handleSubmit(text),
      reload: () => this.reloadConfig(),
      currentMode: this.currentMode,
      setMode: (mode) => this.setMode(mode),
      startNewThread: () => this.startNewThread(),
      resumeThread: (threadId) => this.resumeThread(threadId),
      deleteThread: (threadId) => this.deleteThread(threadId),
      listThreads: () => this.listThreads(),
      readThread: () => this.readThread(),
      onModelChanged: (modelId) => {
        this.statusBar.update({ model: modelId });
        this.renderer.requestRender();
      },
    };
  }

  private setMode(mode: ProtocolMode): void {
    this.currentMode = mode;
    this.statusBar.update({ mode });
    if (this.rpcClient && this.currentThreadId) {
      void this.rpcClient.request("mode/set", { threadId: this.currentThreadId, mode }).catch(() => {});
    }
    this.renderer.requestRender();
  }

  private async reloadConfig(): Promise<void> {
    try {
      const newConfig = await loadConfig(process.cwd(), this.paths);
      this.config = newConfig;
      this.skills = newConfig.skills ?? [];

      // Rebuild command registry with new skills
      this.commandRegistry = new CommandRegistry();
      registerBuiltinCommands(this.commandRegistry, this.skills);

      this.statusBar.update({ model: newConfig.model.id });
    } catch (err) {
      this.chatView.addLines([
        `  ${t.error}Reload error: ${err instanceof Error ? err.message : String(err)}${t.reset}`,
      ]);
    }
  }

  private handleAgentEvent(event: AgentEvent): void {
    this.chatView.handleEvent(event);

    // Update status bar with usage info
    if (event.type === "usage") {
      this.statusBar.update({
        tokensUsed: event.usage.inputTokens + event.usage.outputTokens,
      });
    } else if (event.type === "status_change") {
      this.statusBar.update({ status: event.status });
    }
  }

  private handleCancel(): void {
    if (this.isProcessing && this.rpcClient && this.currentThreadId) {
      void this.rpcClient.request("turn/interrupt", { threadId: this.currentThreadId }).catch(() => {});
      this.chatView.clearActive();
      this.chatView.addLines([`  ${t.dim}Cancelled.${t.reset}`]);
      this.pendingTurn?.resolve();
    } else if (!this.isProcessing) {
      this.shutdown();
    }
  }

  private handleSteering(text: string): void {
    if (!this.rpcClient || !this.currentThreadId) return;
    this.chatView.addLines([`  ${t.dim}[steering] ${text}${t.reset}`]);
    void this.rpcClient
      .request("turn/steer", {
        threadId: this.currentThreadId,
        content: text,
        followUp: false,
      })
      .catch(() => {});
    this.renderer.requestRender();
  }

  private createAppServer(paths: DiligentPaths): DiligentAppServer {
    const appServerConfig: DiligentAppServerConfig = {
      resolvePaths: async (cwd) => ensureDiligentDir(cwd),
      buildAgentConfig: ({ cwd, mode, signal, approve, ask, getSessionId }) => {
        const deps = {
          model: this.config.model,
          systemPrompt: this.config.systemPrompt,
          streamFunction: this.config.streamFunction,
          getParentSessionId: getSessionId,
        };
        const { tools, registry } = buildTools(cwd, paths, deps, deps);
        if (registry) {
          this.agentRegistry = registry;
        }
        return {
          model: this.config.model,
          systemPrompt: this.config.systemPrompt,
          tools,
          streamFunction: this.config.streamFunction,
          mode: mode as ModeKind,
          signal,
          approve,
          ask,
          permissionEngine: this.permissionEngine,
        };
      },
      compaction: {
        enabled: this.config.diligent.compaction?.enabled ?? true,
        reserveTokens: this.config.diligent.compaction?.reserveTokens ?? 16384,
        keepRecentTokens: this.config.diligent.compaction?.keepRecentTokens ?? 20000,
      },
    };

    return new DiligentAppServer(appServerConfig);
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
      notification.method === "turn/completed" &&
      this.currentThreadId &&
      notification.params.threadId === this.currentThreadId
    ) {
      this.pendingTurn?.resolve();
    }

    if (
      notification.method === "error" &&
      this.pendingTurn &&
      (!notification.params.threadId || notification.params.threadId === this.currentThreadId)
    ) {
      this.pendingTurn.reject(new Error(notification.params.error.message));
    }

    this.renderer.requestRender();
  }

  private async handleServerRequest(request: DiligentServerRequest): Promise<DiligentServerRequestResponse> {
    if (request.method === "approval/request") {
      const decision = await this.handleApprove(request.params.request);
      return {
        method: "approval/request",
        result: { decision },
      };
    }

    const result = await this.handleAsk(request.params.request);
    return {
      method: "userInput/request",
      result,
    };
  }

  private async startNewThread(): Promise<string> {
    if (!this.rpcClient) {
      throw new Error("App server is not initialized.");
    }
    const response = await this.rpcClient.request("thread/start", {
      cwd: process.cwd(),
      mode: this.currentMode,
    });
    this.currentThreadId = response.threadId;
    this.statusBar.update({ sessionId: response.threadId });
    return response.threadId;
  }

  private async resumeThread(threadId?: string): Promise<string | null> {
    if (!this.rpcClient) {
      throw new Error("App server is not initialized.");
    }

    const response = await this.rpcClient.request("thread/resume", {
      threadId,
      mostRecent: threadId ? undefined : true,
    });

    if (!response.found || !response.threadId) {
      return null;
    }
    this.currentThreadId = response.threadId;
    this.statusBar.update({ sessionId: response.threadId });
    return response.threadId;
  }

  private async listThreads(): Promise<SessionSummary[]> {
    if (!this.rpcClient) {
      return [];
    }
    const response = await this.rpcClient.request("thread/list", {});
    return response.data;
  }

  private async readThread(): Promise<ThreadReadResponse | null> {
    if (!this.rpcClient || !this.currentThreadId) {
      return null;
    }
    return this.rpcClient.request("thread/read", { threadId: this.currentThreadId });
  }

  private async deleteThread(threadId: string): Promise<boolean> {
    if (!this.rpcClient) return false;
    const response = await this.rpcClient.request("thread/delete", { threadId });
    if (response.deleted && this.currentThreadId === threadId) {
      // Switch away: try most recent, else start new
      const resumed = await this.resumeThread();
      if (!resumed) {
        await this.startNewThread();
      }
    }
    return response.deleted;
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
    const answers: Record<string, string> = {};
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
  private showTextInputOverlay(question: import("@diligent/core").UserInputQuestion): Promise<string> {
    return new Promise((resolve) => {
      const input = new QuestionInput(
        {
          header: question.header,
          question: question.question,
          options: question.options,
          masked: question.is_secret,
          placeholder: question.is_secret ? "enter value\u2026" : undefined,
        },
        (value) => {
          this.chatView.setActiveQuestion(null);
          this.renderer.requestRender();
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
    // Shut down any active sub-agents in the background (fire-and-forget)
    this.agentRegistry?.shutdownAll().catch(() => {});
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

    const row = (s: string) => `${t.dim}\u2502 ${pad(s)} \u2502${t.reset}`;

    return [
      `${t.dim}\u256d${"─".repeat(boxWidth - 2)}\u256e${t.reset}`,
      `${t.dim}\u2502${t.reset} ${t.bold}${pad(title)}${t.reset} ${t.dim}\u2502${t.reset}`,
      row(""),
      row(modelLine),
      row(dirLine),
      ...(yoloLine ? [`${t.dim}\u2502${t.reset} ${t.warn}${pad(yoloLine)}${t.reset} ${t.dim}\u2502${t.reset}`] : []),
      `${t.dim}\u2570${"─".repeat(boxWidth - 2)}\u256f${t.reset}`,
      "",
      `${t.dim}  Tip: /help for commands \u00b7 ctrl+c to cancel \u00b7 ctrl+d to exit${t.reset}`,
      "",
    ];
  }

  private shutdown(): void {
    this.stop();
    this.terminal.write(`\n${t.dim}Goodbye!${t.reset}\n`);
    process.exit(0);
  }
}
