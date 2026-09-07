// @summary Generates one image through a managed ChatGPT OAuth account exposed by Codex app-server.

import { isAbsolute } from "node:path";
import { z } from "zod";
import {
  type CodexAppServerSession,
  type CodexNotification,
  type ConnectCodexAppServer,
  withCodexAppServer,
} from "./app-server-client";

const IMAGE_TIMEOUT_MS = 300_000;

const accountResponseSchema = z
  .object({ account: z.object({ type: z.string() }).passthrough().nullable() })
  .passthrough();
const capabilityResponseSchema = z.object({ imageGeneration: z.boolean() }).passthrough();
const threadResponseSchema = z.object({ thread: z.object({ id: z.string().min(1) }).passthrough() }).passthrough();
const itemCompletedSchema = z
  .object({
    threadId: z.string(),
    item: z
      .object({
        type: z.literal("imageGeneration"),
        savedPath: z.string().optional(),
        revisedPrompt: z.string().nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();
const turnCompletedSchema = z
  .object({
    threadId: z.string(),
    turn: z
      .object({
        status: z.string(),
        error: z.object({ message: z.string() }).passthrough().nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export interface GeneratedCodexImage {
  sourcePath: string;
  revisedPrompt?: string;
}

export type GenerateCodexImage = (input: {
  cwd: string;
  prompt: string;
  signal?: AbortSignal;
}) => Promise<GeneratedCodexImage>;

function imageTurnMatcher(threadId: string): (notification: CodexNotification) => GeneratedCodexImage | undefined {
  let generated: GeneratedCodexImage | undefined;

  return (notification) => {
    if (notification.method === "item/completed") {
      const completed = itemCompletedSchema.safeParse(notification.params);
      if (!completed.success || completed.data.threadId !== threadId) return undefined;
      const sourcePath = completed.data.item.savedPath;
      if (!sourcePath || !isAbsolute(sourcePath)) return undefined;
      const revisedPrompt = completed.data.item.revisedPrompt?.trim();
      generated = { sourcePath, ...(revisedPrompt ? { revisedPrompt } : {}) };
      return undefined;
    }

    if (notification.method !== "turn/completed") return undefined;
    const completed = turnCompletedSchema.safeParse(notification.params);
    if (!completed.success || completed.data.threadId !== threadId) return undefined;
    if (completed.data.turn.status !== "completed") {
      throw new Error(
        completed.data.turn.error?.message ?? `Codex image-generation turn ${completed.data.turn.status}.`,
      );
    }
    if (!generated) throw new Error("Codex completed the turn without producing a saved image.");
    return generated;
  };
}

function parseResponse<T>(schema: z.ZodType<T>, method: string, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(`Codex App Server returned an invalid ${method} response.`);
  return parsed.data;
}

export function createGenerateCodexImage(
  connect: ConnectCodexAppServer = withCodexAppServer,
  options: { timeoutMs?: number } = {},
): GenerateCodexImage {
  return async (input) =>
    connect({
      cwd: input.cwd,
      signal: input.signal,
      timeoutMs: options.timeoutMs ?? IMAGE_TIMEOUT_MS,
      run: async (session) => {
        await ensureImageGenerationAvailable(session);
        const threadId = await startImageThread(session, input.cwd);
        return runImageTurn(session, { threadId, cwd: input.cwd, prompt: input.prompt });
      },
    });
}

async function ensureImageGenerationAvailable(session: CodexAppServerSession): Promise<void> {
  const account = parseResponse(
    accountResponseSchema,
    "account/read",
    await session.request("account/read", { refreshToken: false }),
  );
  if (account.account?.type !== "chatgpt") {
    throw new Error("Codex image generation requires a managed ChatGPT OAuth account, not an API key.");
  }

  const capabilities = parseResponse(
    capabilityResponseSchema,
    "modelProvider/capabilities/read",
    await session.request("modelProvider/capabilities/read", {}),
  );
  if (!capabilities.imageGeneration) {
    throw new Error("The connected Codex account does not support image generation.");
  }
}

async function startImageThread(session: CodexAppServerSession, cwd: string): Promise<string> {
  const response = await session.request("thread/start", {
    cwd,
    ephemeral: true,
    developerInstructions:
      "Generate exactly one requested image with the built-in image generation skill. Do not edit project files or run unrelated tools.",
  });
  const { thread } = parseResponse(threadResponseSchema, "thread/start", response);
  return thread.id;
}

async function runImageTurn(
  session: CodexAppServerSession,
  input: { threadId: string; cwd: string; prompt: string },
): Promise<GeneratedCodexImage> {
  const completion = session.waitForNotification(imageTurnMatcher(input.threadId));
  // Observe both promises immediately: a terminal event may precede the turn/start response.
  const [, generated] = await Promise.all([
    session.request("turn/start", {
      threadId: input.threadId,
      cwd: input.cwd,
      input: [{ type: "text", text: `$imagegen\n${input.prompt}` }],
    }),
    completion,
  ]);
  return generated;
}

export const generateCodexImage = createGenerateCodexImage();
