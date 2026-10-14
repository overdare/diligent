// @summary OVERDARE product experiment definitions shared by web and MCP surfaces.

import type { ExperimentDefinition } from "@diligent/runtime";

export const OVERDARE_EXPERIMENTS: ExperimentDefinition[] = [
  {
    // Internal diagnostics: expose the skill and its authenticated transmission tool together.
    // All release channels are opt-in through the existing experiment override.
    id: "issue-report",
    title: "Internal issue reporting",
    description: "Let the agent report Studio/agent defects and its own wasted effort to an internal Slack channel.",
    defaultEnabled: false,
    skillNames: ["session-issue-report"],
    toolNames: ["agent_report"],
  },
];
