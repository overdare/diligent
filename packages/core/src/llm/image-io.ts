// @summary Reads persisted local image blocks into provider-ready base64 image blocks with validation
import type { ContentBlock, ImageBlock, LocalImageBlock } from "../types";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function fileNameFromPath(path: string): string {
  const normalizedPath = path.replaceAll("\\", "/");
  const segments = normalizedPath.split("/");
  return segments[segments.length - 1] ?? path;
}

export async function localImageToBase64(block: LocalImageBlock): Promise<ImageBlock> {
  const file = Bun.file(block.path);
  if (!(await file.exists())) {
    throw new Error(`Attached image not found: ${block.path}`);
  }

  const size = file.size;
  if (typeof size === "number" && size > MAX_IMAGE_BYTES) {
    throw new Error(`Attached image exceeds 10 MB limit: ${fileNameFromPath(block.path)}`);
  }

  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Attached image exceeds 10 MB limit: ${fileNameFromPath(block.path)}`);
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

export async function materializeUserContentBlocks(blocks: ContentBlock[]): Promise<ContentBlock[]> {
  const result: ContentBlock[] = [];

  for (const block of blocks) {
    if (block.type === "local_image") {
      result.push(await localImageToBase64(block));
    } else {
      result.push(block);
    }
  }

  return result;
}
