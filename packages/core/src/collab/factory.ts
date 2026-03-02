// @summary Factory creating the four collab tools sharing a single AgentRegistry
import type { Tool } from "../tool/types";
import { createCloseAgentTool } from "./close-agent";
import { AgentRegistry } from "./registry";
import { createSendInputTool } from "./send-input";
import { createSpawnAgentTool } from "./spawn-agent";
import type { CollabToolDeps } from "./types";
import { createWaitTool } from "./wait";

export function createCollabTools(deps: CollabToolDeps): {
  tools: Tool[];
  registry: AgentRegistry;
} {
  const registry = new AgentRegistry(deps);
  const tools: Tool[] = [
    createSpawnAgentTool(registry),
    createWaitTool(registry),
    createSendInputTool(registry),
    createCloseAgentTool(registry),
  ];
  return { tools, registry };
}
