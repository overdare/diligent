// @summary Shared helpers for mapping persisted local images to browser-safe Web routes

export const WEB_IMAGE_ROUTE_PREFIX = "/_diligent/image/";

const DILIGENT_IMAGE_PATH_MARKERS = ["/.diligent/images/", "\\.diligent\\images\\"];

export function toWebImageUrl(localPath: string): string {
  const relativePath = extractDiligentImageRelativePath(localPath);
  if (!relativePath) {
    return localPath;
  }

  const encodedPath = relativePath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${WEB_IMAGE_ROUTE_PREFIX}${encodedPath}`;
}

export function decodeWebImageRelativePath(pathname: string): string | null {
  if (!pathname.startsWith(WEB_IMAGE_ROUTE_PREFIX)) {
    return null;
  }

  const encodedPath = pathname.slice(WEB_IMAGE_ROUTE_PREFIX.length);
  if (encodedPath.length === 0) {
    return null;
  }

  try {
    const segments = encodedPath
      .split("/")
      .filter((segment) => segment.length > 0)
      .map(decodeURIComponent);
    return segments.length > 0 ? segments.join("/") : null;
  } catch {
    return null;
  }
}

function extractDiligentImageRelativePath(localPath: string): string | null {
  for (const marker of DILIGENT_IMAGE_PATH_MARKERS) {
    const markerIndex = localPath.lastIndexOf(marker);
    if (markerIndex < 0) {
      continue;
    }

    const relativePath = localPath.slice(markerIndex + marker.length);
    const normalizedPath = relativePath
      .split(/[\\/]+/)
      .filter((segment) => segment.length > 0)
      .join("/");

    if (normalizedPath.length > 0) {
      return normalizedPath;
    }
  }

  return null;
}
