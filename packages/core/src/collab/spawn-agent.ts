// @summary spawn_agent tool — non-blocking sub-agent creation returning thread_id and nickname
import { z } from "zod";
import {
  BUILTIN_AGENT_TYPE_NAMES,
  formatAgentTypeParameterDescription,
  formatSpawnAgentToolDescription,
} from "../agent/agent-types";
import type { Tool, ToolContext, ToolResult } from "../tool/types";
import type { AgentRegistry } from "./registry";

const SpawnAgentParams = z.object({
  message: z.string().describe("The full prompt/instruction for the sub-agent"),
  description: z.string().optional().describe("Brief description for status display"),
  agent_type: z.enum(BUILTIN_AGENT_TYPE_NAMES).default("general").describe(formatAgentTypeParameterDescription()),
  resume_id: z.string().optional().describe("Session ID to resume a previous sub-agent session"),
  model_class: z
    .enum(["pro", "general", "lite"])
    .optional()
    .describe(
      "Override the model class for this sub-agent. " +
        "'pro' for complex reasoning, 'general' for balanced tasks, 'lite' for simple/read-only. " +
        "Defaults by role: general→same as parent, explore→lite, planner→pro.",
    ),
});

export function createSpawnAgentTool(registry: AgentRegistry): Tool<typeof SpawnAgentParams> {
  return {
    name: "spawn_agent",
    description: formatSpawnAgentToolDescription(),
    parameters: SpawnAgentParams,
    execute: async (args, _ctx: ToolContext): Promise<ToolResult> => {
      const { threadId, nickname } = registry.spawn({
        prompt: args.message,
        description: args.description ?? "",
        agentType: args.agent_type,
        resumeId: args.resume_id,
        modelClass: args.model_class,
      });
      return {
        output: JSON.stringify({ thread_id: threadId, nickname }),
      };
    },
  };
}
