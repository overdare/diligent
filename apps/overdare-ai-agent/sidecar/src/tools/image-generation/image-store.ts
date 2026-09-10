// @summary Persists generated image bytes into managed project-local storage.

import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ImageMediaType } from "@diligent/core/provider-contract";
import { ensureDiligentDir } from "@diligent/runtime";

export type { ImageMediaType } from "@diligent/core/provider-contract";

export interface StoredImage {
  file: string;
  mediaType: ImageMediaType;
  bytes: Buffer;
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
  source: { bytes: Uint8Array; mediaType: ImageMediaType },
  options: { signal?: AbortSignal } = {},
): Promise<StoredImage> {
  const { signal } = options;
  signal?.throwIfAborted();
  const mediaType = source.mediaType;
  const extension = extensionForMediaType(mediaType);
  const bytes = Buffer.from(source.bytes);
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
