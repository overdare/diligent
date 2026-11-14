// @summary Cross-platform path utilities for handling both Unix and Windows paths

import { posix, win32 } from "node:path";

/**
 * Check if a path is absolute, supporting both Unix and Windows paths.
 * Works across platforms regardless of the OS the code is running on.
 *
 * Unix: /home/user/project
 * Windows: C:\Users\alice or C:/Users/alice
 */
export function isAbsolute(path: string): boolean {
  const p = stripExtendedLengthPrefix(path);
  // Unix: starts with /
  if (p.startsWith("/")) return true;
  // Windows: starts with drive letter like C:/ or C:\
  if (/^[a-zA-Z]:/.test(p)) return true;
  return false;
}

/**
 * Strip the Windows Extended-Length Path prefix (\\?\) if present.
 * This prefix is used to bypass the MAX_PATH (260 char) limit but is
 * unnecessary for Node.js fs APIs and can confuse other tools like ripgrep.
 */
export function stripExtendedLengthPrefix(path: string): string {
  if (path.startsWith("\\\\?\\")) return path.slice(4);
  return path;
}

function hasWindowsDrive(path: string): boolean {
  return /^[a-zA-Z]:/.test(stripExtendedLengthPrefix(path));
}

function usesWindowsPathSemantics(path: string): boolean {
  const normalized = stripExtendedLengthPrefix(path);
  return hasWindowsDrive(normalized) || normalized.startsWith("\\");
}

function normalizeWindowsPath(path: string): string {
  return stripExtendedLengthPrefix(path).replace(/\//g, "\\");
}

export function resolveCrossPlatformPath(basePath: string, targetPath: string): string {
  if (usesWindowsPathSemantics(basePath) || usesWindowsPathSemantics(targetPath)) {
    return win32.resolve(normalizeWindowsPath(basePath), normalizeWindowsPath(targetPath));
  }
  return posix.resolve(basePath, targetPath);
}

export function dirnameCrossPlatform(path: string): string {
  if (usesWindowsPathSemantics(path)) {
    return win32.dirname(normalizeWindowsPath(path));
  }
  return posix.dirname(path);
}

export function relativeCrossPlatform(from: string, to: string): string {
  if (usesWindowsPathSemantics(from) || usesWindowsPathSemantics(to)) {
    return win32.relative(normalizeWindowsPath(from), normalizeWindowsPath(to));
  }
  return posix.relative(from, to);
}
