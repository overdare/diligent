// @summary Same-origin file preview navigation independent of browser filesystem URL handling
import { parseFileLink } from "@diligent/runtime/client";

export const FILE_PREVIEW_ROUTE = "/_diligent/file";

export interface FileLinkOptions {
  threadId?: string;
  /** Absolute path of the document containing this link. */
  basePath?: string;
}

export function buildFilePreviewUrl(path: string, options: Pick<FileLinkOptions, "threadId"> = {}): string {
  const query = new URLSearchParams({ path });
  if (options.threadId) query.set("threadId", options.threadId);
  return `${FILE_PREVIEW_ROUTE}?${query}`;
}

export function toFilePreviewUrl(href: string, options: FileLinkOptions = {}): string {
  if (/^\/_diligent\/(?:file(?:[?#]|$)|image\/)/.test(href)) return href;
  const file = parseFileLink(href);
  if (!file) return href;
  let path = file.path;
  if (options.basePath && !/^(?:\/|[a-z]:\/)/i.test(path)) {
    const normalizedBase = options.basePath.replaceAll("\\", "/");
    path = `${normalizedBase.slice(0, normalizedBase.lastIndexOf("/") + 1)}${path}`;
  }
  return `${buildFilePreviewUrl(path, options)}${file.fragment ? `#${encodeURIComponent(file.fragment)}` : ""}`;
}
