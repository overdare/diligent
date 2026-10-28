// @summary Upload base64 images once to the Anthropic Files API and reference them by file_id
import { createHash } from "node:crypto";
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { createLogger } from "@diligent/logging";

const logger = createLogger({ scope: "llm:anthropic-files" });

export const ANTHROPIC_FILES_BETA = "files-api-2025-04-14";
export const ANTHROPIC_OFFICIAL_BASE_URL = "https://api.anthropic.com";

/** Uploads image bytes and resolves to the Files API `file_id`. */
export type AnthropicImageUpload = (bytes: Buffer, mediaType: string, filename: string) => Promise<string>;

export interface AnthropicImageReferences {
  messages: Anthropic.MessageParam[];
  /** True when at least one image is sent as a file reference, so the request needs the Files beta. */
  usesFiles: boolean;
}

/**
 * Every Messages request resends the whole conversation, so base64 images are re-uploaded on each
 * turn. This store uploads each distinct image once and swaps its source for a `file_id`. After the
 * first upload failure it stops trying and leaves every image as base64.
 */
export class AnthropicImageFiles {
  private readonly fileIds = new Map<string, Promise<string | undefined>>();
  private disabled = false;

  constructor(private readonly upload: AnthropicImageUpload) {}

  async reference(messages: Anthropic.MessageParam[]): Promise<AnthropicImageReferences> {
    if (this.disabled) return { messages, usesFiles: false };
    let usesFiles = false;
    const swapImage = async (block: Anthropic.ImageBlockParam): Promise<Anthropic.ImageBlockParam> => {
      if (block.source.type !== "base64") return block;
      const fileId = await this.fileIdFor(block.source.data, block.source.media_type);
      if (!fileId) return block;
      usesFiles = true;
      // SDK 0.78 types only list base64 and url image sources; the Messages API accepts `file`.
      const source = { type: "file", file_id: fileId } as unknown as Anthropic.ImageBlockParam["source"];
      return { ...block, source };
    };

    const referenced = await Promise.all(
      messages.map(async (message): Promise<Anthropic.MessageParam> => {
        if (message.role !== "user" || typeof message.content === "string") return message;
        const content = await Promise.all(
          message.content.map(async (block): Promise<Anthropic.ContentBlockParam> => {
            if (block.type === "image") return swapImage(block);
            if (block.type !== "tool_result" || !Array.isArray(block.content)) return block;
            const toolContent = await Promise.all(
              block.content.map((part) => (part.type === "image" ? swapImage(part) : part)),
            );
            return { ...block, content: toolContent };
          }),
        );
        return { ...message, content };
      }),
    );
    return { messages: usesFiles ? referenced : messages, usesFiles };
  }

  private fileIdFor(data: string, mediaType: string): Promise<string | undefined> {
    const digest = createHash("sha256").update(data).digest("hex");
    const existing = this.fileIds.get(digest);
    if (existing) return existing;
    const extension = mediaType.split("/")[1] ?? "bin";
    const pending = this.upload(Buffer.from(data, "base64"), mediaType, `image-${digest.slice(0, 16)}.${extension}`)
      .then((fileId): string | undefined => fileId)
      .catch((error: unknown) => {
        this.disabled = true;
        this.fileIds.delete(digest);
        logger.warn("image_upload_failed", {
          message: `[anthropic] Files API image upload failed; sending images inline: ${
            error instanceof Error ? error.message : String(error)
          }`,
          error,
        });
        return undefined;
      });
    this.fileIds.set(digest, pending);
    return pending;
  }
}

const storesByApiKey = new Map<string, AnthropicImageFiles>();

/**
 * Shared per API key so streaming and native compaction reuse the same uploads. Proxies behind a
 * custom base URL may not serve `/v1/files`, so only the official endpoint gets a store.
 */
export function getAnthropicImageFiles(apiKey: string, baseUrl: string): AnthropicImageFiles | undefined {
  if (baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "") !== ANTHROPIC_OFFICIAL_BASE_URL) return undefined;
  const key = createHash("sha256").update(apiKey).digest("hex");
  const existing = storesByApiKey.get(key);
  if (existing) return existing;
  let client: Anthropic | undefined;
  const store = new AnthropicImageFiles(async (bytes, mediaType, filename) => {
    client ??= new Anthropic({ apiKey, baseURL: ANTHROPIC_OFFICIAL_BASE_URL });
    // The SDK's beta files resource already sends the Files beta header.
    const uploaded = await client.beta.files.upload({ file: await toFile(bytes, filename, { type: mediaType }) });
    return uploaded.id;
  });
  storesByApiKey.set(key, store);
  return store;
}
