// @summary Runs one Codex image-generation session with managed OAuth and guaranteed cleanup.

import { isAbsolute } from "node:path";
import {
  type CodexAppServerSession,
  type CodexImageEvent,
  type CreateCodexAppServer,
  createCodexAppServer,
} from "./app-server-client";

const IMAGE_TIMEOUT_MS = 300_000;
type SavedImageEvent = Extract<CodexImageEvent, { type: "image" }>;
type CompletedTurnEvent = Extract<CodexImageEvent, { type: "completed" }>;

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
      const events = client.runTurn({ threadId, cwd, prompt });
      return await collectGeneratedImage(events);
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

async function collectGeneratedImage(events: AsyncIterable<CodexImageEvent>): Promise<GeneratedCodexImage> {
  let latestImage: GeneratedCodexImage | undefined;
  let completedImage: GeneratedCodexImage | undefined;

  for await (const event of events) {
    switch (event.type) {
      case "image":
        latestImage = readSavedImage(event) ?? latestImage;
        break;
      case "completed":
        completedImage = completeImageTurn(event, latestImage);
        break;
    }
  }

  // A completion event can precede the turn/start acknowledgement; consume the entire stream.
  if (!completedImage) {
    throw new Error("Codex image-generation stream ended without completing the turn.");
  }
  return completedImage;
}

function readSavedImage(event: SavedImageEvent): GeneratedCodexImage | undefined {
  if (!event.savedPath || !isAbsolute(event.savedPath)) return undefined;

  const image: GeneratedCodexImage = { sourcePath: event.savedPath };
  const revisedPrompt = event.revisedPrompt?.trim();
  if (revisedPrompt) image.revisedPrompt = revisedPrompt;
  return image;
}

function completeImageTurn(event: CompletedTurnEvent, image: GeneratedCodexImage | undefined): GeneratedCodexImage {
  if (event.status !== "completed") {
    throw new Error(event.error ?? `Codex image-generation turn ${event.status}.`);
  }
  if (!image) {
    throw new Error("Codex completed the turn without producing a saved image.");
  }
  return image;
}

export const generateCodexImage = createGenerateCodexImage();
