// @summary Reads persisted local image blocks into provider-ready base64 image blocks with validation
import type { ContentBlock, ImageBlock, LocalImageBlock } from "../types";
import { resolvePersistedLocalImagePath } from "./local-image-paths";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function fileNameFromPath(path: string): string {
  const normalizedPath = path.replaceAll("\\", "/");
  const segments = normalizedPath.split("/");
  return segments[segments.length - 1] ?? path;
}

export async function localImageToBase64(
  block: LocalImageBlock,
  options?: { cwd?: string },
): Promise<ImageBlock | null> {
  const resolvedPath = resolvePersistedLocalImagePath(block.path, options?.cwd);
  const file = Bun.file(resolvedPath);
  if (!(await file.exists())) {
    return null;
  }

  const size = file.size;
  if (typeof size === "number" && size > MAX_IMAGE_BYTES) {
    throw new Error(`Attached image exceeds 10 MB limit: ${fileNameFromPath(resolvedPath)}`);
  }

  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Attached image exceeds 10 MB limit: ${fileNameFromPath(resolvedPath)}`);
  }

  return {
    type: "image",
    source: {
      type: "base64",
      media_type: block.mediaType,
      data: Buffer.from(bytes).toString("base64"),
    },
  };
}

export async function materializeUserContentBlocks(
  blocks: ContentBlock[],
  options?: { cwd?: string },
): Promise<ContentBlock[]> {
  const result: ContentBlock[] = [];

  for (const block of blocks) {
    if (block.type === "local_image") {
      const imageBlock = await localImageToBase64(block, options);
      if (imageBlock) result.push(imageBlock);
    } else {
      result.push(block);
    }
  }

  return result;
}
