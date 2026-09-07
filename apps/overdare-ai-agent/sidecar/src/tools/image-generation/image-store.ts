// @summary Persists generated image files or bytes into managed project-local storage.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { ensureDiligentDir } from "@diligent/runtime";

export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp";

export type GeneratedImageSource =
  | { type: "file"; file: string }
  | { type: "bytes"; bytes: Uint8Array; mediaType: ImageMediaType };

export interface StoredImage {
  file: string;
  mediaType: ImageMediaType;
  bytes: Buffer;
}

function mediaTypeForFile(path: string): ImageMediaType {
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".png":
      return "image/png";
    default:
      throw new Error("Image generation returned an unsupported image format.");
  }
}

function extensionForMediaType(mediaType: ImageMediaType): string {
  switch (mediaType) {
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/png":
      return ".png";
  }
}

export async function storeGeneratedImage(
  cwd: string,
  source: GeneratedImageSource,
  options: { signal?: AbortSignal } = {},
): Promise<StoredImage> {
  const { signal } = options;
  signal?.throwIfAborted();
  const mediaType = source.type === "file" ? mediaTypeForFile(source.file) : source.mediaType;
  const extension =
    source.type === "file" ? extname(source.file).toLowerCase() : extensionForMediaType(source.mediaType);
  const bytes = source.type === "file" ? await readFile(source.file, { signal }) : Buffer.from(source.bytes);
  signal?.throwIfAborted();
  const directory = join((await ensureDiligentDir(resolve(cwd))).images, "generated");
  await mkdir(directory, { recursive: true });
  signal?.throwIfAborted();
  const file = join(directory, `generated-${randomUUID()}${extension}`);

  try {
    await writeFile(file, bytes, { signal, flag: "wx" });
    signal?.throwIfAborted();
  } catch (error) {
    // Remove only this attempt's partial file; an exclusive-create collision belongs to someone else.
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") await unlink(file).catch(() => {});
    throw error;
  }

  return { file, mediaType, bytes };
}
