// @summary spawn_agent tool — non-blocking sub-agent creation returning agent_id and nickname
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../tool/types";
import type { AgentRegistry } from "./registry";

const SpawnAgentParams = z.object({
  message: z.string().describe("The full prompt/instruction for the sub-agent"),
  description: z.string().optional().describe("Brief description for status display"),
  agent_type: z
    .enum(["general", "explore", "planner"])
    .default("general")
    .describe(
      "Agent type: 'general' has full tool access, 'explore' is read-only, " +
        "'planner' explores the codebase and writes a plan document to .diligent/plans/",
    ),
  resume_id: z.string().optional().describe("Session ID to resume a previous sub-agent session"),
  model_class: z
    .enum(["pro", "general", "lite"])
    .optional()
    .describe(
      "Override the model class for this sub-agent. " +
        "'pro' for complex reasoning, 'general' for balanced tasks, 'lite' for simple/read-only. " +
        "Defaults based on agent_type: explore→lite, general→same as parent.",
    ),
});

export function createSpawnAgentTool(registry: AgentRegistry): Tool<typeof SpawnAgentParams> {
  return {
    name: "spawn_agent",
    description:
      "Spawn a sub-agent in the background (non-blocking). Returns immediately with agent_id and nickname. " +
      "Use 'wait' to collect results. Use 'general' for tasks requiring file writes/edits. " +
      "Use 'explore' for read-only research. Use 'planner' to analyse a task and produce a plan document.",
    parameters: SpawnAgentParams,
    execute: async (args, _ctx: ToolContext): Promise<ToolResult> => {
      const { agentId, nickname } = registry.spawn({
        prompt: args.message,
        description: args.description ?? "",
        agentType: args.agent_type,
        resumeId: args.resume_id,
        modelClass: args.model_class,
      });
      return {
        output: JSON.stringify({ agent_id: agentId, nickname }),
      };
    },
  };
}
