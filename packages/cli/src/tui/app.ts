// @summary Main TUI application component managing the agent loop and interface
import type { AgentEvent, DiligentPaths, Message, ModeKind, SkillMetadata, UserMessage } from "@diligent/core";
import { agentLoop, EventStream, resolveModel, SessionManager } from "@diligent/core";
import { version as pkgVersion } from "../../package.json";
import type { AppConfig } from "../config";
import { loadConfig } from "../config";
import { DEFAULT_MODELS, PROVIDER_NAMES, type ProviderName } from "../provider-manager";
import { registerBuiltinCommands } from "./commands/builtin/index";
import { promptSaveKey } from "./commands/builtin/provider";
import { parseCommand } from "./commands/parser";
import { CommandRegistry } from "./commands/registry";
import type { CommandContext } from "./commands/types";
import { ChatView } from "./components/chat-view";
import { ConfirmDialog, type ConfirmDialogOptions } from "./components/confirm-dialog";
import { InputEditor } from "./components/input-editor";
import { InputHistory } from "./input-history";
import { ListPicker, type ListPickerItem } from "./components/list-picker";
import { StatusBar } from "./components/status-bar";
import { TextInput } from "./components/text-input";
import { Container } from "./framework/container";
import { matchesKey } from "./framework/keys";
import { OverlayStack } from "./framework/overlay";
import { TUIRenderer } from "./framework/renderer";
import { StdinBuffer } from "./framework/stdin-buffer";
import { Terminal } from "./framework/terminal";
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
  private abortController: AbortController | null = null;
  private activeStream: EventStream<AgentEvent, Message[]> | null = null;
  private isProcessing = false;
  private messages: Message[] = [];
  private sessionManager: SessionManager | null = null;
  private currentMode: ModeKind;

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

    // Initialize SessionManager
    if (this.paths) {
      const cwd = process.cwd();
      const tools = buildTools(cwd, this.paths);

      this.sessionManager = new SessionManager({
        cwd,
        paths: this.paths,
        agentConfig: () => ({
          model: this.config.model,
          systemPrompt: this.config.systemPrompt,
          tools,
          streamFunction: this.config.streamFunction,
          mode: this.currentMode,
          signal: this.abortController?.signal,
        }),
        compaction: {
          enabled: this.config.diligent.compaction?.enabled ?? true,
          reserveTokens: this.config.diligent.compaction?.reserveTokens ?? 16384,
          keepRecentTokens: this.config.diligent.compaction?.keepRecentTokens ?? 20000,
        },
        knowledgePath: this.paths.knowledge,
      });

      if (this.options?.resume) {
        const resumed = await this.sessionManager.resume({ mostRecent: true });
        if (resumed) {
          this.messages = this.sessionManager.getContext();
        }
      } else {
        await this.sessionManager.create();
      }
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
      const hintMap: Record<string, { url: string; placeholder: string }> = {
        anthropic: { url: "https://console.anthropic.com/settings/keys", placeholder: "sk-ant-..." },
        openai: { url: "https://platform.openai.com/api-keys", placeholder: "sk-..." },
        gemini: { url: "https://aistudio.google.com/apikey", placeholder: "AIza..." },
      };
      const { url: hint, placeholder } = hintMap[provider] ?? { url: "", placeholder: "" };

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
    const modes: ModeKind[] = ["default", "plan", "execute"];
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

    this.isProcessing = true;
    this.abortController = new AbortController();

    this.chatView.addUserMessage(text);
    this.statusBar.update({ status: "busy" });
    this.renderer.requestRender();

    const userMessage: UserMessage = {
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    this.messages.push(userMessage);

    try {
      if (this.sessionManager) {
        const stream = this.sessionManager.run(userMessage);
        this.activeStream = stream;
        for await (const event of stream) {
          this.handleAgentEvent(event);
        }
        const result = await stream.result();
        this.messages = result;
      } else {
        const cwd = process.cwd();
        const tools = buildTools(cwd, this.paths);
        const loopFn = this.config.agentLoopFn ?? agentLoop;
        const loop = loopFn(this.messages, {
          model: this.config.model,
          systemPrompt: this.config.systemPrompt,
          tools,
          streamFunction: this.config.streamFunction,
          signal: this.abortController.signal,
          mode: this.currentMode,
        });
        this.activeStream = loop;

        for await (const event of loop) {
          this.handleAgentEvent(event);
        }
        const result = await loop.result();
        this.messages = result;
      }
    } catch (err) {
      if (!this.abortController?.signal.aborted) {
        this.chatView.handleEvent({
          type: "error",
          error: {
            message: err instanceof Error ? err.message : String(err),
            name: err instanceof Error ? err.name : "Error",
          },
          fatal: false,
        });
      }
    }

    const wasCancelled = this.abortController?.signal.aborted ?? false;
    this.isProcessing = false;
    this.abortController = null;
    this.activeStream = null;
    this.statusBar.update({ status: "idle" });
    if (wasCancelled) {
      this.chatView.clearActive();
      this.chatView.addLines([`  ${t.dim}Cancelled.${t.reset}`]);
    }
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
      sessionManager: this.sessionManager,
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
      onModelChanged: (modelId) => {
        this.statusBar.update({ model: modelId });
        this.renderer.requestRender();
      },
    };
  }

  private setMode(mode: ModeKind): void {
    this.currentMode = mode;
    this.sessionManager?.appendModeChange(mode, "command");
    this.statusBar.update({ mode });
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
    // Suppress error events caused by user-initiated abort
    if (event.type === "error" && this.abortController?.signal.aborted) {
      return;
    }
    this.chatView.handleEvent(event);

    // Update status bar with usage info
    if (event.type === "usage") {
      this.statusBar.update({
        tokensUsed: event.usage.inputTokens + event.usage.outputTokens,
      });
    }
  }

  private handleCancel(): void {
    if (this.isProcessing && this.abortController) {
      this.abortController.abort();
      this.activeStream?.error(new Error("Cancelled"));
    } else if (!this.isProcessing) {
      this.shutdown();
    }
  }

  private handleSteering(text: string): void {
    if (!this.sessionManager) return;
    this.chatView.addLines([`  ${t.dim}[steering] ${text}${t.reset}`]);
    this.sessionManager.steer(text);
    this.renderer.requestRender();
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

  /** Stop the TUI */
  stop(): void {
    this.overlayStack.clear();
    this.renderer.stop();
    this.terminal.stop();
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

    const row = (s: string) => `${t.dim}\u2502 ${pad(s)} \u2502${t.reset}`;

    return [
      `${t.dim}\u256d${"─".repeat(boxWidth - 2)}\u256e${t.reset}`,
      `${t.dim}\u2502${t.reset} ${t.bold}${pad(title)}${t.reset} ${t.dim}\u2502${t.reset}`,
      row(""),
      row(modelLine),
      row(dirLine),
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
