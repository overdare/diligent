// @summary Renders discovered agents into the parent system prompt
import type { AgentMetadata } from "./types";

function describeTools(agent: AgentMetadata): string {
  if (!agent.tools || agent.tools.length === 0) {
    return "inherits parent-visible tools";
  }
  return agent.tools.join(", ");
}

export function renderAgentsSection(agents: AgentMetadata[]): string {
  if (agents.length === 0) return "";

  const lines = [
    "## Available Agents",
    "",
    "Reusable sub-agents that can be spawned through the spawn_agent tool.",
    "",
  ];
  for (const agent of agents) {
    const modelSummary = agent.defaultModelClass ? `; default model class: ${agent.defaultModelClass}` : "";
    lines.push(`- **${agent.name}**: ${agent.description}. Default tools: ${describeTools(agent)}${modelSummary}.`);
  }
  return lines.join("\n");
}
