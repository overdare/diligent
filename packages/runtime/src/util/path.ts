// @summary Cross-platform path utilities for handling both Unix and Windows paths

/**
 * Check if a path is absolute, supporting both Unix and Windows paths.
 * Works across platforms regardless of the OS the code is running on.
 *
 * Unix: /home/user/project
 * Windows: C:\Users\alice or C:/Users/alice
 */
export function isAbsolute(path: string): boolean {
  // Unix: starts with /
  if (path.startsWith("/")) return true;
  // Windows: starts with drive letter like C:/ or C:\
  if (/^[a-zA-Z]:/.test(path)) return true;
  return false;
}
