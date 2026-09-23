// @summary Runtime-owned opt-in hook for freezing inherited tools at a child-agent boundary.

import type { Tool } from "@diligent/core/tool-contract";

/**
 * Optional tool hook invoked when the runtime inherits a parent tool into a
 * child agent. Providers can return a clone that freezes request-local state.
 */
export const FORK_TOOL_FOR_CHILD: unique symbol = Symbol("diligent.tool.fork-for-child");

export type ChildForkableTool = Tool & {
  [FORK_TOOL_FOR_CHILD]?: (inheritedTool: Tool) => Tool;
};

export function forkToolForChild(tool: Tool): Tool {
  return (tool as ChildForkableTool)[FORK_TOOL_FOR_CHILD]?.(tool) ?? tool;
}
