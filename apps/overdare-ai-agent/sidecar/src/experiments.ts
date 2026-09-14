// @summary OVERDARE product experiment definitions shared by web and MCP surfaces.

import type { ExperimentDefinition } from "@diligent/runtime";

export const OVERDARE_EXPERIMENTS: ExperimentDefinition[] = [
  {
    id: "procedural",
    title: "Procedural generation",
    description: "Create and update scenes from reusable procedural Luau recipes.",
    defaultEnabled: false,
    toolNames: ["studiorpc_procedural_run"],
    skillNames: ["procedural-builder"],
    agentNames: ["procedural-builder"],
  },
  {
    id: "agent-report",
    title: "Agent failure reports",
    description: "Let the agent file a failure report to the OVERDARE gateway when a repeat-failure signal fires.",
    defaultEnabled: false,
    toolNames: ["agent_report_failure"],
  },
];
