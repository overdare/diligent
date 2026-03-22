// @summary Central tool metadata registry — single source of truth for built-in tool capabilities

/**
 * Capabilities for a built-in tool.
 * When adding a new tool, add an entry here and set each applicable flag.
 * The derived sets (IMMUTABLE_TOOLS, PLAN_MODE_ALLOWED_TOOLS, COLLAB_TOOL_NAMES,
 * CUSTOM_RENDER_TOOLS) are generated from this registry — no manual sync required.
 */
export interface ToolCapabilities {
  /** Cannot be disabled by user config (D027). */
  immutable?: true;
  /** Allowed in plan mode (read-only exploration). Bash, write, apply_patch are excluded. */
  planModeAllowed?: true;
  /** Belongs to the collab layer — excluded from child agents to prevent nesting. */
  collabExcluded?: true;
  /** Has custom render logic in render-payload.ts for richer UI display. */
  hasCustomRender?: true;
}

/** Central registry of built-in tool capabilities. */
export const TOOL_CAPABILITIES: Record<string, ToolCapabilities> = {
  // Core agent tools
  request_user_input: { immutable: true, planModeAllowed: true },
  plan: { immutable: true, planModeAllowed: true, hasCustomRender: true },
  skill: { immutable: true, planModeAllowed: true },

  // Read-only filesystem tools (plan-mode safe)
  read: { planModeAllowed: true, hasCustomRender: true },
  glob: { planModeAllowed: true },
  grep: { planModeAllowed: true },
  ls: { planModeAllowed: true },
  search_knowledge: { planModeAllowed: true, hasCustomRender: true },

  // Write tools (excluded from plan mode)
  bash: { hasCustomRender: true },
  write: { hasCustomRender: true },
  apply_patch: { hasCustomRender: true },
  update_knowledge: { hasCustomRender: true },

  // Collab tools (excluded from child agents to prevent nesting)
  spawn_agent: { collabExcluded: true },
  wait: { collabExcluded: true },
  send_input: { collabExcluded: true },
  close_agent: { collabExcluded: true },
};

/** Tools that cannot be disabled by user config. */
export const IMMUTABLE_TOOLS = new Set(
  Object.entries(TOOL_CAPABILITIES)
    .filter(([, caps]) => caps.immutable)
    .map(([name]) => name),
);

/** Tools allowed in plan mode (read-only exploration only). */
export const PLAN_MODE_ALLOWED_TOOLS = new Set(
  Object.entries(TOOL_CAPABILITIES)
    .filter(([, caps]) => caps.planModeAllowed)
    .map(([name]) => name),
);

/** Collab layer tools — excluded from child agents. */
export const COLLAB_TOOL_NAMES = new Set(
  Object.entries(TOOL_CAPABILITIES)
    .filter(([, caps]) => caps.collabExcluded)
    .map(([name]) => name),
);

/** Tools with custom render logic in render-payload.ts. */
export const CUSTOM_RENDER_TOOLS = new Set(
  Object.entries(TOOL_CAPABILITIES)
    .filter(([, caps]) => caps.hasCustomRender)
    .map(([name]) => name),
);
