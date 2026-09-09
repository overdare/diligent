// @summary Resolves approved local reference images without copying or modifying them.
import { stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

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
    }),
  );
  signal?.throwIfAborted();
  return paths;
}
