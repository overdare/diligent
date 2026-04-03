// @summary Cross-platform path utilities for handling both Unix and Windows paths

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
