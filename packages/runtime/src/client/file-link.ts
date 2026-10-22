// @summary Browser-safe classification and decoding of local Markdown file links
export interface FileLink {
  path: string;
  fragment?: string;
}

export function parseFileLink(href: string): FileLink | null {
  const value = href.trim();
  if (!value || /^[#?]/.test(value) || value.startsWith("//") || /[\u0000-\u001f\u007f]/.test(value)) return null;

  let path: string;
  let fragment: string | undefined;
  try {
    if (/^file:/i.test(value)) {
      const url = new URL(value);
      if (url.hostname && url.hostname !== "localhost") return null;
      path = decodeURIComponent(url.pathname).replace(/^\/([a-z]:[\\/])/i, "$1");
      fragment = url.hash.slice(1) || undefined;
    } else {
      if (!/^[a-z]:[\\/]/i.test(value) && /^[a-z][a-z\d+.-]*:/i.test(value)) return null;
      const hash = value.indexOf("#");
      const encodedPath = hash < 0 ? value : value.slice(0, hash);
      fragment = hash < 0 ? undefined : value.slice(hash + 1) || undefined;
      // A literal percent sign is valid in a path even when it is not a URI escape.
      path = decodeURIComponent(encodedPath.replace(/%(?![\da-f]{2})/gi, "%25"));
    }
  } catch {
    return null;
  }
  if (fragment) {
    try {
      fragment = decodeURIComponent(fragment.replace(/%(?![\da-f]{2})/gi, "%25"));
    } catch {
      return null;
    }
  }
  path = path.replaceAll("\\", "/").replace(/^([a-z]:)\/+/i, "$1/");
  if (!path || /[\u0000-\u001f\u007f]/.test(path)) return null;
  return { path, ...(fragment ? { fragment } : {}) };
}
