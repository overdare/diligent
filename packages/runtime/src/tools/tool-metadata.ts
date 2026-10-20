// @summary Central tool metadata registry — single source of truth for built-in tool capabilities

import { COLLAB_TOOL_NAMES, CUSTOM_RENDER_TOOLS } from "@diligent/protocol";

export { COLLAB_TOOL_NAMES, CUSTOM_RENDER_TOOLS };

/**
 * Capabilities for a built-in tool.
 * When adding a new tool, add an entry here and set each applicable flag.
 * The derived sets (IMMUTABLE_TOOLS, PLAN_MODE_DISALLOWED_TOOLS, EXECUTE_MODE_DISALLOWED_TOOLS)
 * are generated from this registry.
 * COLLAB_TOOL_NAMES and CUSTOM_RENDER_TOOLS are defined in @diligent/protocol/tool-classification
 * and re-exported here for backward compatibility. When adding a tool with collabExcluded or
 * hasCustomRender, update both this registry AND the corresponding set in protocol.
 */
export interface ToolCapabilities {
  /** Never inherited by a child, including nested collaboration. */
  rootOnly?: true;
  /** Cannot be disabled by user config (D027). */
  immutable?: true;
  /** Excluded in plan/read-only mode. External tools are allowed by default unless named here. */
  planModeDisallowed?: true;
  /** Excluded in execute mode. */
  executeModeDisallowed?: true;
  /** Belongs to the collab layer — excluded from child agents to prevent nesting. */
  collabExcluded?: true;
  /** Has custom render logic in render-payload.ts for richer UI display. */
  hasCustomRender?: true;
  /**
   * Stays a direct model tool and is not callable from code mode `exec`: its result drives client UI,
   * user interaction, or image content that cannot cross the JSON-only guest bridge.
   */
  codeModeDirect?: true;
}

/** Central registry of built-in tool capabilities. */
export const TOOL_CAPABILITIES: Record<string, ToolCapabilities> = {
  create_goal: { immutable: true, rootOnly: true, planModeDisallowed: true, codeModeDirect: true },
  get_goal: { immutable: true, rootOnly: true, codeModeDirect: true },
  update_goal: { immutable: true, rootOnly: true, planModeDisallowed: true, codeModeDirect: true },
  // Core agent tools
  request_user_input: { immutable: true, executeModeDisallowed: true, hasCustomRender: true, codeModeDirect: true },
  plan: { immutable: true, hasCustomRender: true, codeModeDirect: true },
  skill: { immutable: true, hasCustomRender: true, codeModeDirect: true },

  // Read-only filesystem tools.
  read: { hasCustomRender: true },
  read_image: { codeModeDirect: true },
  glob: {},
  grep: {},
  ls: {},
  search_knowledge: { hasCustomRender: true },
  web_action: {},

  // Write tools (excluded from plan mode)
  bash: { planModeDisallowed: true, hasCustomRender: true },
  write: { planModeDisallowed: true, hasCustomRender: true },
  apply_patch: { planModeDisallowed: true, hasCustomRender: true },
  edit: { planModeDisallowed: true, hasCustomRender: true },
  multi_edit: { planModeDisallowed: true, hasCustomRender: true },
  update_knowledge: { planModeDisallowed: true, hasCustomRender: true },

  // Collab tools (excluded from child agents to prevent nesting)
  spawn_agent: { collabExcluded: true, codeModeDirect: true },
  wait: { collabExcluded: true, codeModeDirect: true },
  send_input: { collabExcluded: true, codeModeDirect: true },
  close_agent: { collabExcluded: true, codeModeDirect: true },

  // Code mode control tools (added by code mode assembly; never nested in themselves)
  exec: { rootOnly: true, codeModeDirect: true, hasCustomRender: true },
  exec_wait: { rootOnly: true, codeModeDirect: true, hasCustomRender: true },
};

/** Tools that cannot be disabled by user config. */
export const IMMUTABLE_TOOLS = new Set(
  Object.entries(TOOL_CAPABILITIES)
    .filter(([, caps]) => caps.immutable)
    .map(([name]) => name),
);

/** Tools explicitly excluded in plan/read-only mode. External tools are allowed by default. */
export const PLAN_MODE_DISALLOWED_TOOLS = new Set(
  Object.entries(TOOL_CAPABILITIES)
    .filter(([, caps]) => caps.planModeDisallowed)
    .map(([name]) => name),
);

/** Tools explicitly excluded in execute mode. */
export const EXECUTE_MODE_DISALLOWED_TOOLS = new Set(
  Object.entries(TOOL_CAPABILITIES)
    .filter(([, caps]) => caps.executeModeDisallowed)
    .map(([name]) => name),
);
