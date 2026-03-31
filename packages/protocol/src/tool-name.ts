// @summary Tool name normalization utility shared across web and CLI clients

/**
 * Normalize tool names for UI rule matching.
 * Strips namespace prefixes so that plugin-namespaced tools
 * (e.g. "functions.spawn_agent", "overdare/spawn_agent")
 * are recognized the same as their base names.
 *
 * Examples:
 * - "request_user_input" -> "request_user_input"
 * - "functions.request_user_input" -> "request_user_input"
 * - "overdare/request_user_input" -> "request_user_input"
 */
export function normalizeToolName(toolName: string): string {
  const raw = toolName.trim().toLowerCase();
  if (!raw) return raw;
  const cutIdx = Math.max(raw.lastIndexOf("/"), raw.lastIndexOf("."));
  return cutIdx >= 0 ? raw.slice(cutIdx + 1) : raw;
}
