// @summary Runs one Codex image-generation session with managed OAuth and guaranteed cleanup.

import { isAbsolute } from "node:path";
import { type CodexAppServerSession, type CreateCodexAppServer, createCodexAppServer } from "./app-server-client";
import type { CodexImageItem } from "./protocol";

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
      await prepareImageSession(client);
      const threadId = await client.startThread(cwd);
      const images = await client.runTurn({ threadId, cwd, prompt });
      return selectGeneratedImage(images);
    } finally {
      await client.close();
    }
  };
}

async function prepareImageSession(client: CodexAppServerSession): Promise<void> {
  await client.initialize();
  const account = await client.readAccount();
  if (account?.type !== "chatgpt") {
    throw new Error("Codex image generation requires a managed ChatGPT OAuth account, not an API key.");
  }

  const capabilities = await client.readCapabilities();
  if (!capabilities.imageGeneration) {
    throw new Error("The connected Codex account does not support image generation.");
  }
}

function selectGeneratedImage(images: CodexImageItem[]): GeneratedCodexImage {
  const selected = images.findLast((image) => image.savedPath && isAbsolute(image.savedPath));
  if (!selected?.savedPath) {
    throw new Error("Codex completed the turn without producing a saved image.");
  }
  const image: GeneratedCodexImage = { sourcePath: selected.savedPath };
  const revisedPrompt = selected.revisedPrompt?.trim();
  if (revisedPrompt) image.revisedPrompt = revisedPrompt;
  return image;
}

export const generateCodexImage = createGenerateCodexImage();
