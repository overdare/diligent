// @summary spawn_agent tool — non-blocking sub-agent creation returning agent_id and nickname
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../tool/types";
import type { AgentRegistry } from "./registry";

const SpawnAgentParams = z.object({
  message: z.string().describe("The full prompt/instruction for the sub-agent"),
  description: z.string().optional().describe("Brief description for status display"),
  agent_type: z
    .enum(["general", "explore"])
    .default("general")
    .describe("Agent type: 'general' has full tool access, 'explore' is read-only"),
  resume_id: z.string().optional().describe("Session ID to resume a previous sub-agent session"),
});

export function createSpawnAgentTool(registry: AgentRegistry): Tool<typeof SpawnAgentParams> {
  return {
    name: "spawn_agent",
    description:
      "Spawn a sub-agent in the background (non-blocking). Returns immediately with agent_id and nickname. " +
      "Use 'wait' to collect results. Use 'general' for tasks requiring file writes/edits. " +
      "Use 'explore' for read-only research.",
    parameters: SpawnAgentParams,
    execute: async (args, _ctx: ToolContext): Promise<ToolResult> => {
      const { agentId, nickname } = registry.spawn({
        prompt: args.message,
        description: args.description ?? "",
        agentType: args.agent_type,
        resumeId: args.resume_id,
      });
      return {
        output: JSON.stringify({ agent_id: agentId, nickname }),
      };
    },
  };
}
