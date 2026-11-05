// @summary OVERDARE product experiment definitions shared by web and MCP surfaces.

import type { ExperimentDefinition } from "@diligent/runtime";
import type { call } from "./tools/studiorpc/rpc";
import { applyLuauTestFrameworkToggle, LUAU_TEST_TOOL_NAME } from "./tools/studiorpc/tools/luau-test";

export const STUDIO_TESTING_EXPERIMENT_ID = "studio-testing";

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
  {
    // One switch for every Studio testing capability: frktest Luau tests and autoplay playtests.
    id: STUDIO_TESTING_EXPERIMENT_ID,
    title: "Studio testing",
    description:
      "Let the agent write Luau tests (frktest) and autoplay playtest harnesses in Studio and run them in PIE. Turning it on injects the test framework into the open level; turning it off removes it and keeps your tests.",
    defaultEnabled: false,
    skillNames: ["autonomous-playtest", "luau-testing"],
    toolNames: ["studiorpc_game_playtest", "studiorpc_game_playtest_harness", LUAU_TEST_TOOL_NAME],
  },
];

/** Web host definitions: the Studio testing toggle also injects/removes the framework in the connected level. */
export function withStudioSideEffects(callRpc: typeof call): ExperimentDefinition[] {
  return OVERDARE_EXPERIMENTS.map((definition) =>
    definition.id === STUDIO_TESTING_EXPERIMENT_ID
      ? { ...definition, onEnabledChange: (enabled: boolean) => applyLuauTestFrameworkToggle(callRpc, enabled) }
      : definition,
  );
}
