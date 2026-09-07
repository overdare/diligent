// @summary Typed, sequential Codex app-server requests and image-turn events over one process.

import { z } from "zod";
import { CodexProcess, type CodexProcessOptions } from "./process";

const accountSchema = z.object({ account: z.object({ type: z.string() }).nullable() });
const capabilitiesSchema = z.object({ imageGeneration: z.boolean() });
const threadSchema = z.object({ thread: z.object({ id: z.string().min(1) }) });
const imageNotificationSchema = z.object({
  threadId: z.string(),
  item: z.object({
    type: z.literal("imageGeneration"),
    savedPath: z.string().optional(),
    revisedPrompt: z.string().nullable().optional(),
  }),
});
const completedNotificationSchema = z.object({
  threadId: z.string(),
  turn: z.object({
    status: z.string(),
    error: z.object({ message: z.string() }).nullable().optional(),
  }),
});

export type CodexImageEvent =
  | { type: "image"; savedPath?: string; revisedPrompt?: string | null }
  | { type: "completed"; status: string; error?: string };

export interface CodexTurnInput {
  threadId: string;
  cwd: string;
  prompt: string;
}

export interface CodexAppServerSession {
  initialize(): Promise<void>;
  readAccount(): Promise<{ type: string } | null>;
  readCapabilities(): Promise<{ imageGeneration: boolean }>;
  startThread(cwd: string): Promise<string>;
  runTurn(input: CodexTurnInput): AsyncIterable<CodexImageEvent>;
  close(): Promise<void>;
}

export type CreateCodexAppServer = (options: CodexProcessOptions) => CodexAppServerSession;

export const createCodexAppServer: CreateCodexAppServer = (options) => new CodexAppServer(new CodexProcess(options));

// Each image invocation has its own process. Only one operation consumes its message stream at a time.
class CodexAppServer implements CodexAppServerSession {
  private nextRequestId = 1;

  constructor(private readonly process: CodexProcess) {}

  async initialize(): Promise<void> {
    await this.request(
      "initialize",
      {
        clientInfo: { name: "overdare-image-generation", title: "OVERDARE Image Generation", version: "0.0.1" },
        capabilities: { experimentalApi: true },
      },
      z.unknown(),
    );
    this.process.writeLine(JSON.stringify({ method: "initialized", params: {} }));
  }

  async readAccount(): Promise<{ type: string } | null> {
    const { account } = await this.request("account/read", { refreshToken: false }, accountSchema);
    return account;
  }

  readCapabilities(): Promise<{ imageGeneration: boolean }> {
    return this.request("modelProvider/capabilities/read", {}, capabilitiesSchema);
  }

  async startThread(cwd: string): Promise<string> {
    const { thread } = await this.request(
      "thread/start",
      {
        cwd,
        ephemeral: true,
        developerInstructions:
          "Generate exactly one requested image with the built-in image generation skill. Do not edit project files or run unrelated tools.",
      },
      threadSchema,
    );
    return thread.id;
  }

  async *runTurn(input: CodexTurnInput): AsyncGenerator<CodexImageEvent> {
    const id = this.sendRequest("turn/start", {
      threadId: input.threadId,
      cwd: input.cwd,
      input: [{ type: "text", text: `$imagegen\n${input.prompt}` }],
    });
    let acknowledged = false;
    let completed = false;
    // The acknowledgement and events can arrive in either order. Read both from the same stream.
    while (!acknowledged || !completed) {
      const message = await this.readMessage();
      if (isResponse(message, id)) {
        throwRequestError(message);
        acknowledged = true;
        continue;
      }
      if (completed) continue;
      const event = readImageEvent(message, input.threadId);
      if (!event) continue;
      if (event.type === "completed") completed = true;
      yield event;
    }
  }

  close(): Promise<void> {
    return this.process.close();
  }

  private sendRequest(method: string, params: Record<string, unknown>): number {
    const id = this.nextRequestId++;
    this.process.writeLine(JSON.stringify({ id, method, params }));
    return id;
  }

  private async request<T>(method: string, params: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
    const id = this.sendRequest(method, params);
    while (true) {
      const message = await this.readMessage();
      if (!isResponse(message, id)) continue;
      throwRequestError(message);
      const parsed = schema.safeParse(message.result);
      if (!parsed.success) throw new Error(`Codex App Server returned an invalid ${method} response.`);
      return parsed.data;
    }
  }

  private async readMessage(): Promise<Record<string, unknown>> {
    while (true) {
      const line = await this.process.readLine();
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch (error) {
        throw new Error(`Codex App Server returned invalid JSON: ${error instanceof Error ? error.message : error}`);
      }
      if (!isRecord(message)) continue;
      // This client does not expose approval or tool execution callbacks to the nested agent.
      if (typeof message.method === "string" && (typeof message.id === "string" || typeof message.id === "number")) {
        this.process.writeLine(
          JSON.stringify({
            id: message.id,
            error: { code: -32601, message: `Unhandled Codex App Server request: ${message.method}` },
          }),
        );
        continue;
      }
      return message;
    }
  }
}

function readImageEvent(message: Record<string, unknown>, threadId: string): CodexImageEvent | undefined {
  if (message.method === "item/completed") {
    const parsed = imageNotificationSchema.safeParse(message.params);
    if (!parsed.success || parsed.data.threadId !== threadId) return undefined;
    const { savedPath, revisedPrompt } = parsed.data.item;
    return { type: "image", savedPath, revisedPrompt };
  }
  if (message.method === "turn/completed") {
    const parsed = completedNotificationSchema.safeParse(message.params);
    if (!parsed.success || parsed.data.threadId !== threadId) return undefined;
    return { type: "completed", status: parsed.data.turn.status, error: parsed.data.turn.error?.message };
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isResponse(message: Record<string, unknown>, id: number): boolean {
  return message.id === id && ("result" in message || "error" in message);
}

function throwRequestError(message: Record<string, unknown>): void {
  if (message.error === undefined) return;
  const error = message.error;
  const reason =
    isRecord(error) && typeof error.message === "string" && error.message ? error.message : "request failed";
  throw new Error(`Codex App Server ${reason}`);
}
