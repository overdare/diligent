// @summary Opt-in hook for tools that stay available in plan mode and read-only agents with their writes removed

import type { Tool } from "@diligent/core/tool-contract";

/**
 * Optional tool hook returning a variant without write operations. Plan mode and read-only child agents use the
 * variant instead of dropping the tool.
 */
export const READ_ONLY_TOOL_VARIANT: unique symbol = Symbol("diligent.tool.read-only-variant");

export type ReadOnlyVariantTool = Tool & {
  [READ_ONLY_TOOL_VARIANT]?: () => Tool;
};

export function toReadOnlyTool(tool: Tool): Tool {
  return (tool as ReadOnlyVariantTool)[READ_ONLY_TOOL_VARIANT]?.() ?? tool;
}
