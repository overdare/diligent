import type { SkillMetadata } from "@diligent/core";
import type { Mode, SessionSummary, ThreadReadResponse } from "@diligent/protocol";
import type { AppConfig } from "../../config";
import type { ConfirmDialogOptions } from "../components/confirm-dialog";
import type { Component, OverlayHandle, OverlayOptions } from "../framework/types";
import type { AppServerRpcClient } from "../rpc-client";
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
  /** Active thread ID */
  threadId: string | null;
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
  /** Switch to a new collaboration mode */
  setMode: (mode: Mode) => void;
  /** Start a fresh thread and make it active */
  startNewThread: () => Promise<string>;
  /** Resume thread (or most recent when omitted) and make it active */
  resumeThread: (threadId?: string) => Promise<string | null>;
  /** Delete a thread by ID; switches away if it was active */
  deleteThread: (threadId: string) => Promise<boolean>;
  /** List known threads from the server */
  listThreads: () => Promise<SessionSummary[]>;
  /** Read active thread summary (messages count/follow-up) */
  readThread: () => Promise<ThreadReadResponse | null>;
  /** Notify status bar after changing ctx.config.model */
  onModelChanged: (modelId: string) => void;
}

/**
 * Subset of App exposed to commands. Avoids tight coupling.
 */
export interface AppAccessor {
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  stop: () => void;
  getRpcClient?: () => AppServerRpcClient | null;
}
