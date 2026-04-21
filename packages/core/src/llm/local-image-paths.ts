// @summary Resolves persisted local image paths from relative or legacy absolute storage

import { isAbsolute, normalize, posix, resolve } from "node:path";

function normalizeSeparators(value: string): string {
  return value.replaceAll("\\", "/");
}

function isLegacyAbsolutePath(value: string): boolean {
  return value.startsWith("/");
}

function isPosixStylePath(value: string): boolean {
  return value.includes("/") && !value.includes("\\");
}

export function toPersistedLocalImagePath(absPath: string, cwd: string): string {
  const normalizedAbsolute = normalize(absPath);
  const normalizedCwd = normalize(cwd);
  if (normalizedAbsolute.startsWith(normalizedCwd)) {
    const relative = normalizedAbsolute.slice(normalizedCwd.length).replace(/^[/\\]+/, "");
    if (relative.length > 0) return normalizeSeparators(relative);
  }
  return normalizeSeparators(normalizedAbsolute);
}

export function resolvePersistedLocalImagePath(path: string, cwd?: string): string {
  if (isLegacyAbsolutePath(path)) return normalizeSeparators(path);
  if (isAbsolute(path) || !cwd) return normalize(path);
  if (isPosixStylePath(cwd)) return posix.resolve(cwd, normalizeSeparators(path));
  return resolve(cwd, path);
}
