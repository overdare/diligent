// @summary Bounded file previews constrained to the canonical thread project directory
import { constants } from "node:fs";
import { open, readdir, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FileReadResponse } from "@diligent/protocol";
import { parseFileLink } from "../client/file-link";
import { readSessionHeader } from "../session/persistence";
import { isSafeSessionId } from "../session/types";
import type { ThreadHandlersContext } from "./thread-handlers";

const MAX_PREVIEW_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
};

export async function resolveFilePreviewCwd(
  ctx: Pick<ThreadHandlersContext, "threads" | "knownCwds" | "resolvePaths">,
  threadId: string | undefined,
  fallbackCwd: string,
): Promise<string> {
  if (!threadId) return fallbackCwd;
  const loaded = ctx.threads.get(threadId);
  if (loaded) return loaded.cwd;
  if (!isSafeSessionId(threadId)) throw new Error("Invalid thread ID.");
  for (const cwd of ctx.knownCwds) {
    const paths = await ctx.resolvePaths(cwd);
    try {
      const header = await readSessionHeader(join(paths.sessions, `${threadId}.jsonl`));
      if (header.id === threadId) return cwd;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error(`Thread not found: ${threadId}`);
}

function assertInsideProject(root: string, path: string): void {
  const fromRoot = relative(root, path);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("Cannot preview files outside the project.");
  }
}

export async function readFilePreview(cwd: string, requestedPath: string): Promise<FileReadResponse> {
  let path = requestedPath;
  if (/^file:/i.test(path)) {
    const link = parseFileLink(path);
    if (!link) throw new Error("Expected a local file path.");
    path = link.path;
  }
  if (
    !path ||
    /[\u0000-\u001f\u007f]/.test(path) ||
    (!/^[a-z]:[\\/]/i.test(path) && /^[a-z][a-z\d+.-]*:/i.test(path))
  ) {
    throw new Error("Expected a local file path.");
  }
  if (process.platform !== "win32" && /^[a-z]:[\\/]/i.test(path)) {
    throw new Error("This Windows path is not available on the agent server computer.");
  }
  path = path.replaceAll("\\", "/").replace(/^([a-z]:)\/+/i, "$1/");
  const project = await realpath(cwd);
  const candidate = resolve(cwd, path);

  try {
    const canonicalPath = await realpath(candidate);
    assertInsideProject(project, canonicalPath);
    const info = await stat(canonicalPath);
    const base = { path: canonicalPath, name: basename(canonicalPath) };
    if (info.isDirectory()) {
      const entries = (await readdir(canonicalPath, { withFileTypes: true }))
        .map((entry) => ({ name: entry.name, path: join(canonicalPath, entry.name), isDirectory: entry.isDirectory() }))
        .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
      return { ...base, kind: "directory", entries };
    }
    if (!info.isFile()) throw new Error("Only regular files and directories can be previewed.");
    if (info.size > MAX_PREVIEW_BYTES) throw new Error("File preview is limited to 10 MiB.");

    // Bound the read itself as well as the initial stat, in case the file grows while it is open.
    const handle = await open(canonicalPath, constants.O_RDONLY | constants.O_NONBLOCK);
    let data: Buffer;
    try {
      const buffer = Buffer.alloc(MAX_PREVIEW_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      if (length > MAX_PREVIEW_BYTES) throw new Error("File preview is limited to 10 MiB.");
      data = buffer.subarray(0, length);
    } finally {
      await handle.close();
    }

    const extension = extname(canonicalPath).toLowerCase();
    const mediaType = IMAGE_TYPES[extension];
    if (mediaType) return { ...base, kind: "image", mediaType, dataBase64: data.toString("base64") };
    try {
      if (data.includes(0)) throw new Error("Binary content");
      const content = new TextDecoder("utf-8", { fatal: true }).decode(data);
      return { ...base, kind: extension === ".md" || extension === ".markdown" ? "markdown" : "text", content };
    } catch {
      return { ...base, kind: "binary", mediaType: "application/octet-stream", dataBase64: data.toString("base64") };
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") throw new Error("File not found on the agent server computer.");
    if (code === "EACCES" || code === "EPERM") throw new Error("The agent server cannot access this file.");
    throw error;
  }
}
