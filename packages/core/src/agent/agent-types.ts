// @summary Agent type definitions, builtin registry, and collab tool name set
import plannerPrompt from "./templates/planner.md" with { type: "text" };

/** Definition of an agent type — controls system prompt, tool access, and turn limits. */
export interface AgentTypeDef {
  name: string;
  description: string;
  systemPromptPrefix?: string;
  toolFilter: "all" | "readonly";
  maxTurns?: number;
}

/**
 * Built-in agent types (D063).
 * "general" — full tool access, task tool excluded to prevent infinite nesting (D064).
 * "explore" — read-only tools only (PLAN_MODE_ALLOWED_TOOLS).
 */
/**
 * Tool names belonging to the collab layer.
 * Used to filter collab tools out of child agents to prevent nesting.
 */
export const COLLAB_TOOL_NAMES = new Set(["spawn_agent", "wait", "send_input", "close_agent"]);

export const BUILTIN_AGENT_TYPES: Record<string, AgentTypeDef> = {
  general: {
    name: "general",
    description: "General-purpose agent with full tool access for complex tasks",
    toolFilter: "all",
    maxTurns: 30,
  },
  explore: {
    name: "explore",
    description: "Read-only agent for codebase exploration and research",
    systemPromptPrefix:
      "You are a read-only exploration agent. " +
      "You may only read files, search code, and explore the codebase. " +
      "You must NOT create, edit, delete, or write any files. " +
      "Do not run bash commands.\n",
    toolFilter: "readonly",
    maxTurns: 20,
  },
  planner: {
    name: "planner",
    description:
      "Planning agent that explores the codebase and writes a decision-complete plan document to .diligent/plans/",
    systemPromptPrefix: `${plannerPrompt}\n`,
    toolFilter: "all",
    maxTurns: 25,
  },
};
