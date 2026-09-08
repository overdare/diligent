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
    id: "procedural",
    title: "Procedural generation",
    description: "Create and update scenes from reusable procedural Luau recipes.",
    defaultEnabled: false,
    toolNames: ["studiorpc_procedural_run"],
    skillNames: ["procedural-builder"],
    agentNames: ["procedural-builder"],
  },
  {
    // Internal diagnostics: the skill ships in the bundle but a prod-channel build filters
    // it out of the model's skill list, so creators never see it. Sending additionally
    // requires DILIGENT_ISSUE_WEBHOOK, which is never shipped — two gates, both off by
    // default in prod.
    id: "issue-report",
    title: "Internal issue reporting",
    description: "Let the agent report Studio/agent defects and its own wasted effort to an internal Slack channel.",
    defaultEnabled: isDevChannel(),
    skillNames: ["session-issue-report"],
  },
];
