// @summary spawn_agent tool — non-blocking sub-agent creation returning thread_id and nickname

import type { Tool, ToolContext, ToolResult } from "@diligent/core/tool/types";
import { z } from "zod";
import { formatAgentTypeParameterDescription, formatSpawnAgentToolDescription } from "../agent/agent-types";
import type { ResolvedAgentDefinition } from "../agent/resolved-agent";
import type { AgentRegistry } from "./registry";

const SpawnAgentParams = z.object({
  message: z.string().describe("The full prompt/instruction for the sub-agent"),
  description: z.string().optional().describe("Brief description for status display"),
  agent_type: z.string().default("general").describe(formatAgentTypeParameterDescription()),
  resume_id: z.string().optional().describe("Session ID to resume a previous sub-agent session"),
  allow_nested_agents: z
    .boolean()
    .optional()
    .describe(
      "Explicit opt-in for nested subagents. Disabled by default; child agents cannot access collab tools unless this is true.",
    ),
  model_class: z
    .enum(["pro", "general", "lite"])
    .optional()
    .describe(
      "Override the model class for this sub-agent. " +
        "'pro' for complex reasoning, 'general' for balanced tasks, 'lite' for simple/read-only. " +
        "Defaults by role: general→same as parent, explore→lite.",
    ),
  thoroughness: z
    .enum(["quick", "thorough"])
    .optional()
    .describe(
      "Search depth for explore agents only. " +
        "'quick' for targeted lookups (1–2 searches, fast answer). " +
        "'thorough' for comprehensive analysis across multiple locations and naming conventions (default).",
    ),
  allowed_tools: z
    .array(z.string())
    .optional()
    .describe(
      "Optional per-spawn child-tool allow-list. Can only narrow the selected agent's default tool access and may intentionally narrow to zero tools. Collab tools remain excluded unless allow_nested_agents=true.",
    ),
});

export function createSpawnAgentTool(
  registry: AgentRegistry,
  agentDefinitions: ResolvedAgentDefinition[],
): Tool<typeof SpawnAgentParams> {
  const parameters = SpawnAgentParams.extend({
    agent_type: z.string().default("general").describe(formatAgentTypeParameterDescription(agentDefinitions)),
  });

  return {
    name: "spawn_agent",
    description: formatSpawnAgentToolDescription(agentDefinitions),
    parameters,
    execute: async (args, _ctx: ToolContext): Promise<ToolResult> => {
      const prompt =
        args.agent_type === "explore" && args.thoroughness
          ? `[thoroughness: ${args.thoroughness}]\n\n${args.message}`
          : args.message;
      const { threadId, nickname } = registry.spawn({
        prompt,
        description: args.description ?? "",
        agentType: args.agent_type,
        resumeId: args.resume_id,
        allowNestedAgents: args.allow_nested_agents === true,
        modelClass: args.model_class,
        allowedTools: args.allowed_tools,
      });
      return { output: JSON.stringify({ thread_id: threadId, nickname }) };
    },
  };
}
