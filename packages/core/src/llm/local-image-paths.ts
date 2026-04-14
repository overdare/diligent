// @summary Resolves persisted local image paths from relative or legacy absolute storage

import { isAbsolute, normalize, resolve } from "node:path";

function normalizeSeparators(value: string): string {
  return value.replaceAll("\\", "/");
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
  if (isAbsolute(path) || !cwd) return normalize(path);
  return resolve(cwd, path);
}
