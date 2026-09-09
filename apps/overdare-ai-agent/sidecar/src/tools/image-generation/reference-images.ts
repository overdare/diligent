// @summary Resolves approved local reference images without copying or modifying them.
import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { ImageMediaType } from "@diligent/core/provider-contract";

const MAX_REFERENCE_BYTES = 32 * 1024 * 1024;

export async function readReferenceImages(files: readonly string[], signal?: AbortSignal) {
  return Promise.all(
    files.map(async (file) => {
      signal?.throwIfAborted();
      const extension = extname(file).toLowerCase();
      const mediaType: ImageMediaType =
        extension === ".webp" ? "image/webp" : extension === ".png" ? "image/png" : "image/jpeg";
      const bytes = await readFile(file, { signal });
      if (bytes.length > MAX_REFERENCE_BYTES) throw new Error(`Reference image exceeds 32 MiB: ${file}`);
      return { bytes, mediaType };
    }),
  );
}

export async function resolveReferenceImages(
  cwd: string,
  files: readonly string[] = [],
  signal?: AbortSignal,
): Promise<string[]> {
  const paths = [...new Set(files.map((file) => resolve(cwd, file)))];
  await Promise.all(
    paths.map(async (file) => {
      signal?.throwIfAborted();
      if (![".png", ".jpg", ".jpeg", ".webp"].includes(extname(file).toLowerCase())) {
        throw new Error(`Unsupported reference image format: ${file}. Use PNG, JPEG, or WebP.`);
      }
      const info = await stat(file).catch((error: Error) => {
        throw new Error(`Cannot read reference image: ${file}. ${error.message}`, { cause: error });
      });
      signal?.throwIfAborted();
      if (!info.isFile() || info.size === 0) {
        throw new Error(`Invalid reference image: ${file}. Expected a non-empty image file.`);
      }
      if (info.size > MAX_REFERENCE_BYTES) throw new Error(`Reference image exceeds 32 MiB: ${file}`);
    }),
  );
  signal?.throwIfAborted();
  return paths;
}
