// @summary Non-interactive runner using JSON-RPC app-server communication
import type { AgentEvent, DiligentPaths, ModeKind } from "@diligent/core";
import {
  createPermissionEngine,
  createYoloPermissionEngine,
  DiligentAppServer,
  ensureDiligentDir,
  ProtocolNotificationAdapter,
} from "@diligent/core";
import type { DiligentServerNotification } from "@diligent/protocol";
import {
  DILIGENT_CLIENT_NOTIFICATION_METHODS,
  DILIGENT_CLIENT_REQUEST_METHODS,
  DILIGENT_SERVER_NOTIFICATION_METHODS,
} from "@diligent/protocol";
import type { AppConfig } from "../config";
import { LocalAppServerRpcClient } from "./rpc-client";
import { t } from "./theme";
import { buildTools } from "./tools";

export interface RunnerOptions {
  resume?: boolean;
}

export class NonInteractiveRunner {
  private exitCode = 0;
  private isThinking = false;

  constructor(
    private config: AppConfig,
    private paths?: DiligentPaths,
    private options?: RunnerOptions,
  ) {}

  async run(prompt: string): Promise<number> {
    if (!this.paths) {
      this.writeStderr("[error] No .diligent directory — non-interactive mode is unavailable.", false);
      return 1;
    }

    const isTTY = process.stderr.isTTY === true;
    const permissionEngine = this.config.diligent.yolo
      ? createYoloPermissionEngine()
      : createPermissionEngine(this.config.diligent.permissions ?? []);
    const adapter = new ProtocolNotificationAdapter();
    let hasText = false;
    let threadId: string | null = null;

    let pendingTurn: {
      resolve: () => void;
      reject: (error: Error) => void;
    } | null = null;

    const server = new DiligentAppServer({
      resolvePaths: async (cwd) => ensureDiligentDir(cwd),
      buildAgentConfig: ({ cwd, mode, signal, approve, ask, getSessionId }) => {
        const deps = {
          model: this.config.model,
          systemPrompt: this.config.systemPrompt,
          streamFunction: this.config.streamFunction,
          getParentSessionId: getSessionId,
        };
        const { tools } = buildTools(cwd, this.paths, deps, deps);

        return {
          model: this.config.model,
          systemPrompt: this.config.systemPrompt,
          tools,
          streamFunction: this.config.streamFunction,
          mode: mode as ModeKind,
          signal,
          approve,
          ask,
          permissionEngine,
        };
      },
      compaction: this.config.compaction,
    });

    const rpc = new LocalAppServerRpcClient(server);
    rpc.setNotificationListener((notification: DiligentServerNotification) => {
      for (const event of adapter.toAgentEvents(notification)) {
        hasText = this.handleEvent(event, isTTY, hasText);
      }

      if (
        notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED &&
        threadId &&
        notification.params.threadId === threadId
      ) {
        pendingTurn?.resolve();
      }

      if (
        notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.ERROR &&
        (!notification.params.threadId || notification.params.threadId === threadId)
      ) {
        pendingTurn?.reject(new Error(notification.params.error.message));
      }
    });

    try {
      await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.INITIALIZE, {
        clientName: "diligent-cli",
        clientVersion: "0.0.1",
        protocolVersion: 1,
      });
      await rpc.notify(DILIGENT_CLIENT_NOTIFICATION_METHODS.INITIALIZED, { ready: true });

      if (this.options?.resume) {
        const resumed = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_RESUME, { mostRecent: true });
        if (resumed.found && resumed.threadId) {
          threadId = resumed.threadId;
        }
      }

      if (!threadId) {
        const started = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_START, {
          cwd: process.cwd(),
          mode: this.config.mode,
        });
        threadId = started.threadId;
      }

      const turnDone = new Promise<void>((resolve, reject) => {
        pendingTurn = { resolve, reject };
      });

      await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_START, {
        threadId,
        message: prompt,
      });
      await turnDone;
    } catch (err) {
      this.writeStderr(`[error] ${err instanceof Error ? err.message : String(err)}`, isTTY);
      this.exitCode = 1;
    }

    if (hasText) {
      process.stdout.write("\n");
    }

    return this.exitCode;
  }

  private handleEvent(event: AgentEvent, isTTY: boolean, hasText: boolean): boolean {
    switch (event.type) {
      case "message_delta":
        if (event.delta.type === "thinking_delta") {
          if (!this.isThinking) {
            this.isThinking = true;
            this.writeStderr("[thinking] Reasoning...", isTTY);
          }
          return hasText;
        }
        if (event.delta.type === "text_delta") {
          this.isThinking = false;
          process.stdout.write(event.delta.delta);
          return true;
        }
        return hasText;

      case "message_end":
        this.isThinking = false;
        return hasText;

      case "tool_start":
        this.writeStderr(`[tool:${event.toolName}] Running...`, isTTY);
        return hasText;

      case "tool_end": {
        const lines = event.output ? event.output.split("\n").length : 0;
        this.writeStderr(`[tool:${event.toolName}] Done (${lines} lines)`, isTTY);
        return hasText;
      }

      case "usage": {
        const costStr = event.cost > 0 ? ` ($${event.cost.toFixed(4)})` : "";
        this.writeStderr(`[usage] ${event.usage.inputTokens}in/${event.usage.outputTokens}out${costStr}`, isTTY);
        return hasText;
      }

      case "compaction_start":
        this.writeStderr(`[compaction] Compacting (${Math.round(event.estimatedTokens / 1000)}k tokens)...`, isTTY);
        return hasText;

      case "compaction_end":
        this.writeStderr(
          `[compaction] ${Math.round(event.tokensBefore / 1000)}k -> ${Math.round(event.tokensAfter / 1000)}k tokens`,
          isTTY,
        );
        return hasText;

      case "knowledge_saved":
        this.writeStderr(`[knowledge] ${event.content}`, isTTY);
        return hasText;

      case "error":
        this.writeStderr(`[error] ${event.error.message}`, isTTY);
        if (event.fatal) {
          this.exitCode = 1;
        }
        return hasText;

      default:
        return hasText;
    }
  }

  private writeStderr(msg: string, isTTY: boolean): void {
    if (isTTY) {
      process.stderr.write(`${t.dim}${msg}${t.reset}\n`);
    } else {
      process.stderr.write(`${msg}\n`);
    }
  }
}
