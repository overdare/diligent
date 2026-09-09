// @summary Runs typed Codex image turns while the RPC client handles response/event ordering.

import { CodexProcess, type CodexProcessOptions } from "./process";
import {
  accountSchema,
  type CodexImageItem,
  capabilitiesSchema,
  completedNotificationSchema,
  imageNotificationSchema,
  itemTypeSchema,
  notificationScopeSchema,
  parseCodexPayload,
  threadSchema,
} from "./protocol";
import { CodexRpcClient } from "./rpc-client";

export interface CodexTurnInput {
  threadId: string;
  cwd: string;
  prompt: string;
  referenceImages?: string[];
}

export interface CodexAppServerSession {
  initialize(): Promise<void>;
  readAccount(): Promise<{ type: string } | null>;
  readCapabilities(): Promise<{ imageGeneration: boolean }>;
  startThread(cwd: string): Promise<string>;
  /** Resolves only after start acknowledgement and successful turn completion. */
  runTurn(input: CodexTurnInput): Promise<CodexImageItem[]>;
  close(): Promise<void>;
}

export type CreateCodexAppServer = (options: CodexProcessOptions) => CodexAppServerSession;

export const createCodexAppServer: CreateCodexAppServer = (options) =>
  new CodexAppServer(new CodexRpcClient(new CodexProcess(options)));

class CodexAppServer implements CodexAppServerSession {
  constructor(private readonly rpc: CodexRpcClient) {}

  async initialize(): Promise<void> {
    await this.rpc.request("initialize", {
      clientInfo: { name: "overdare-image-generation", title: "OVERDARE Image Generation", version: "0.0.1" },
      capabilities: { experimentalApi: true },
    });
    this.rpc.notify("initialized", {});
  }

  async readAccount(): Promise<{ type: string } | null> {
    const method = "account/read";
    return parseCodexPayload(method, accountSchema, await this.rpc.request(method, { refreshToken: false })).account;
  }

  async readCapabilities(): Promise<{ imageGeneration: boolean }> {
    const method = "modelProvider/capabilities/read";
    return parseCodexPayload(method, capabilitiesSchema, await this.rpc.request(method, {}));
  }

  async startThread(cwd: string): Promise<string> {
    const method = "thread/start";
    const response = await this.rpc.request(method, {
      cwd,
      ephemeral: true,
      developerInstructions:
        "Generate exactly one requested image with the built-in image generation skill. " +
        "Use any attached images as actual image-generation references, not just as text inspiration. " +
        "Do not edit project files or run unrelated tools.",
    });
    return parseCodexPayload(method, threadSchema, response).thread.id;
  }

  async runTurn(input: CodexTurnInput): Promise<CodexImageItem[]> {
    const started = this.rpc.request("turn/start", {
      threadId: input.threadId,
      cwd: input.cwd,
      input: [
        { type: "text", text: `$imagegen\n${input.prompt}` },
        ...(input.referenceImages ?? []).map((path) => ({ type: "localImage", path })),
      ],
    });
    // Consume notifications independently: failure must not wait for a missing acknowledgement.
    const [, images] = await Promise.all([started, this.collectTurn(input.threadId)]);
    return images;
  }

  close(): Promise<void> {
    return this.rpc.close();
  }

  private async collectTurn(threadId: string): Promise<CodexImageItem[]> {
    const images: CodexImageItem[] = [];
    for await (const { method, params } of this.rpc.notifications()) {
      if (method !== "item/completed" && method !== "turn/completed") continue;
      const scope = notificationScopeSchema.safeParse(params);
      if (!scope.success || scope.data.threadId !== threadId) continue;

      if (method === "item/completed") {
        const { item } = parseCodexPayload(method, itemTypeSchema, params);
        if (item.type === "imageGeneration") {
          images.push(parseCodexPayload(method, imageNotificationSchema, params).item);
        }
      } else {
        const { turn } = parseCodexPayload(method, completedNotificationSchema, params);
        if (turn.status !== "completed") {
          throw new Error(turn.error?.message ?? `Codex image-generation turn ${turn.status}.`);
        }
        return images;
      }
    }
    throw new Error("Codex image-generation stream ended without completing the turn.");
  }
}
