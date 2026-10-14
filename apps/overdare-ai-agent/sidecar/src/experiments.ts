// @summary OVERDARE product experiment definitions shared by web and MCP surfaces.

import type { ExperimentDefinition } from "@diligent/runtime";

/**
 * True only on a dev-channel build, mirroring `plugin-sdk`'s `currentEnv()`: `DILIGENT_ENV`
 * must be exactly "dev" (case-insensitive), so unset — including a legacy launcher that
 * forwards nothing — reads as prod. Inlined rather than importing `@diligent/plugin-sdk`,
 * which the sidecar does not otherwise depend on.
 */
function isDevChannel(): boolean {
  return process.env.DILIGENT_ENV?.trim().toLowerCase() === "dev";
}

export const OVERDARE_EXPERIMENTS: ExperimentDefinition[] = [
  {
    // Internal diagnostics: expose the skill and its authenticated transmission tool together.
    // Production remains opt-in through the existing experiment override.
    id: "issue-report",
    title: "Internal issue reporting",
    description: "Let the agent report Studio/agent defects and its own wasted effort to an internal Slack channel.",
    defaultEnabled: isDevChannel(),
    skillNames: ["session-issue-report"],
    toolNames: ["agent_report"],
  },
];
