// @summary Client-facing tool classification sets — canonical contract for tool categories shared across packages

/**
 * Tools that belong to the collab layer and are excluded from child agents to prevent nesting.
 *
 * Source of truth for this set. Kept in sync with the collabExcluded flag in
 * packages/runtime/src/tools/tool-metadata.ts (TOOL_CAPABILITIES registry).
 * CLI imports this directly; runtime re-exports it for backward compatibility.
 */
export const COLLAB_TOOL_NAMES = new Set([
  "spawn_agent",
  "wait",
  "send_input",
  "close_agent",
]);

/**
 * Tools that have custom render logic for richer UI display.
 *
 * Source of truth for this set. Kept in sync with the hasCustomRender flag in
 * packages/runtime/src/tools/tool-metadata.ts (TOOL_CAPABILITIES registry).
 */
export const CUSTOM_RENDER_TOOLS = new Set([
  "request_user_input",
  "plan",
  "skill",
  "read",
  "search_knowledge",
  "bash",
  "write",
  "apply_patch",
  "update_knowledge",
]);
