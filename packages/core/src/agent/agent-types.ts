// @summary Agent type definitions, builtin registry, and role-guidance formatters for spawn_agent
import explorePrompt from "./templates/explore.md" with { type: "text" };
import plannerPrompt from "./templates/planner.md" with { type: "text" };

/** Built-in agent type names supported by spawn_agent. */
export const BUILTIN_AGENT_TYPE_NAMES = ["general", "explore", "planner"] as const;

export type BuiltinAgentTypeName = (typeof BUILTIN_AGENT_TYPE_NAMES)[number];

export interface AgentTypeSpawnGuidance {
  summary: string;
  whenToUse: string[];
  rules: string[];
  defaultModelClass: "pro" | "general" | "lite" | "same_as_parent";
}

/** Definition of an agent type — controls system prompt, tool access, and turn limits. */
export interface AgentTypeDef {
  name: BuiltinAgentTypeName;
  description: string;
  systemPromptPrefix?: string;
  toolFilter: "all" | "readonly";
  maxTurns?: number;
  spawnGuidance: AgentTypeSpawnGuidance;
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

export const BUILTIN_AGENT_TYPES: Record<BuiltinAgentTypeName, AgentTypeDef> = {
  general: {
    name: "general",
    description: "General-purpose agent with full tool access for complex tasks",
    toolFilter: "all",
    maxTurns: 30,
    spawnGuidance: {
      summary: "Execution agent for implementation and production work",
      whenToUse: [
        "Implementing features or refactors",
        "Fixing tests, bugs, and regressions",
        "Any task that requires file edits or command execution",
      ],
      rules: [
        "Assign clear ownership (files/responsibility)",
        "Not alone in the codebase: ignore unrelated edits made by others",
      ],
      defaultModelClass: "same_as_parent",
    },
  },
  explore: {
    name: "explore",
    description: "Read-only agent for codebase exploration and research",
    systemPromptPrefix: `${explorePrompt}\n`,
    toolFilter: "readonly",
    maxTurns: 20,
    spawnGuidance: {
      summary: "Fast, authoritative codebase Q&A for specific scoped questions",
      whenToUse: [
        "Answering narrowly scoped questions about existing code",
        "Researching APIs, behavior, or references without changing files",
        "Running multiple independent investigations in parallel",
      ],
      rules: [
        "Ask only specific, well-scoped questions",
        "Do not re-read/re-search areas already covered by an explorer",
        "Trust explorer results without re-verification",
      ],
      defaultModelClass: "lite",
    },
  },
  planner: {
    name: "planner",
    description:
      "Planning agent that explores the codebase and writes a decision-complete plan document to .diligent/plans/",
    systemPromptPrefix: `${plannerPrompt}\n`,
    toolFilter: "all",
    maxTurns: 25,
    spawnGuidance: {
      summary: "Planning-focused agent that writes structured plan documents",
      whenToUse: [
        "Breaking down multi-step work before implementation",
        "Producing a decision-complete plan in .diligent/plans/",
        "Clarifying scope, risks, and execution order",
      ],
      rules: [
        "Favor concrete, executable steps over vague ideas",
        "Keep plan output actionable and tied to repository paths",
      ],
      defaultModelClass: "pro",
    },
  },
};

function modelClassLabel(value: AgentTypeSpawnGuidance["defaultModelClass"]): string {
  if (value === "same_as_parent") return "same as parent";
  return value;
}

function formatGuidanceLine(type: AgentTypeDef): string {
  const whenToUse = type.spawnGuidance.whenToUse.join("; ");
  const rules = type.spawnGuidance.rules.join("; ");
  return (
    `'${type.name}': ${type.spawnGuidance.summary}. ` +
    `Use when: ${whenToUse}. ` +
    `Rules: ${rules}. ` +
    `Default model class: ${modelClassLabel(type.spawnGuidance.defaultModelClass)}.`
  );
}

/** Human-readable role guidance string for spawn_agent's top-level tool description. */
export function formatSpawnAgentToolDescription(): string {
  const roleLines = BUILTIN_AGENT_TYPE_NAMES.map((name) => `- ${formatGuidanceLine(BUILTIN_AGENT_TYPES[name])}`).join(
    "\n",
  );
  return (
    "Spawn a sub-agent in the background (non-blocking). Returns immediately with thread_id and nickname. " +
    "Use 'wait' to collect results.\n" +
    "Role selection guide:\n" +
    roleLines +
    "\n\nDelegation rules:\n" +
    "- Do not duplicate sub-agent work by searching the same areas yourself.\n" +
    "- Write prompts as if briefing a colleague who just walked into the room: explain what you're trying to accomplish, what you already know, and what specifically you need them to find or do. Terse, vague prompts produce shallow results."
  );
}

/** Human-readable role guidance string for spawn_agent.agent_type schema description. */
export function formatAgentTypeParameterDescription(): string {
  const roleLines = BUILTIN_AGENT_TYPE_NAMES.map((name) => `- ${formatGuidanceLine(BUILTIN_AGENT_TYPES[name])}`).join(
    "\n",
  );
  return `Agent type to run. Available built-in roles:\n${roleLines}`;
}
