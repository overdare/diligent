// @summary Runs one Codex image-generation session with managed OAuth and guaranteed cleanup.

import { isAbsolute } from "node:path";
import { type CreateCodexAppServer, createCodexAppServer } from "./app-server-client";

const IMAGE_TIMEOUT_MS = 300_000;

export interface GeneratedCodexImage {
  sourcePath: string;
  revisedPrompt?: string;
}

export type GenerateCodexImage = (input: {
  cwd: string;
  prompt: string;
  signal?: AbortSignal;
}) => Promise<GeneratedCodexImage>;

export function createGenerateCodexImage(
  createClient: CreateCodexAppServer = createCodexAppServer,
  options: { timeoutMs?: number } = {},
): GenerateCodexImage {
  return async ({ cwd, prompt, signal }) => {
    const client = createClient({ cwd, signal, timeoutMs: options.timeoutMs ?? IMAGE_TIMEOUT_MS });
    try {
      await client.initialize();
      const account = await client.readAccount();
      if (account?.type !== "chatgpt") {
        throw new Error("Codex image generation requires a managed ChatGPT OAuth account, not an API key.");
      }
      const capabilities = await client.readCapabilities();
      if (!capabilities.imageGeneration) {
        throw new Error("The connected Codex account does not support image generation.");
      }

      const threadId = await client.startThread(cwd);
      let image: GeneratedCodexImage | undefined;
      for await (const event of client.runTurn({ threadId, cwd, prompt })) {
        if (event.type === "image" && event.savedPath && isAbsolute(event.savedPath)) {
          const revisedPrompt = event.revisedPrompt?.trim();
          image = { sourcePath: event.savedPath, ...(revisedPrompt ? { revisedPrompt } : {}) };
        }
        if (event.type === "completed") {
          if (event.status !== "completed") {
            throw new Error(event.error ?? `Codex image-generation turn ${event.status}.`);
          }
          if (!image) throw new Error("Codex completed the turn without producing a saved image.");
        }
      }
      if (!image) throw new Error("Codex completed the turn without producing a saved image.");
      return image;
    } finally {
      await client.close();
    }
  };
}

export const generateCodexImage = createGenerateCodexImage();
