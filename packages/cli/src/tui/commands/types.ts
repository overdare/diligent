import type { SessionManager, SkillMetadata } from "@diligent/core";
import type { Mode } from "@diligent/protocol";
import type { AppConfig } from "../../config";
import type { ConfirmDialogOptions } from "../components/confirm-dialog";
import type { Component, OverlayHandle, OverlayOptions } from "../framework/types";
import type { CommandRegistry } from "./registry";

export interface Command {
  name: string;
  description: string;
  /** Handler receives parsed args and context */
  handler: (args: string | undefined, ctx: CommandContext) => Promise<void>;
  /** Whether this command can run while the agent is processing */
  availableDuringTask?: boolean;
  /** Whether this command accepts arguments */
  supportsArgs?: boolean;
  /** Aliases (e.g. /q → /exit) */
  aliases?: string[];
  /** Hidden from /help listing */
  hidden?: boolean;
}

export interface CommandContext {
  /** The App instance for TUI access */
  app: AppAccessor;
  /** Current config */
  config: AppConfig;
  /** Session manager (null if no .diligent/) */
  sessionManager: SessionManager | null;
  /** Loaded skills */
  skills: SkillMetadata[];
  /** Command registry (for /help listing) */
  registry: CommandRegistry;
  /** Request a TUI re-render */
  requestRender: () => void;
  /** Display lines in the chat view */
  displayLines: (lines: string[]) => void;
  /** Display an error message */
  displayError: (message: string) => void;
  /** Show an overlay */
  showOverlay: (component: Component, options?: OverlayOptions) => OverlayHandle;
  /** Inject a message and run the agent */
  runAgent: (text: string) => Promise<void>;
  /** Reload config and skills */
  reload: () => Promise<void>;
  /** Current collaboration mode */
  currentMode: Mode;
  /** Switch to a new collaboration mode. Persists to session if SessionManager available. */
  setMode: (mode: Mode) => void;
  /** Notify status bar after changing ctx.config.model */
  onModelChanged: (modelId: string) => void;
}

/**
 * Subset of App exposed to commands. Avoids tight coupling.
 */
export interface AppAccessor {
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  stop: () => void;
}
