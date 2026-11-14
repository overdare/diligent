// @summary Tests product experiment resolution and coupled skill/tool gating.

import { describe, expect, it } from "bun:test";
import { resolveExperimentGates, resolveExperimentStates } from "../../src/experiments";

const definitions = [
  {
    id: "procedural",
    title: "Procedural generation",
    description: "Generate reports from reusable templates.",
    defaultEnabled: false,
    toolNames: ["generate_report"],
    skillNames: ["report-recipes"],
    agentNames: ["procedural-builder"],
  },
];

describe("experiment settings", () => {
  it("uses product defaults and applies one override to both gates", () => {
    expect(resolveExperimentStates(definitions, undefined)[0]?.enabled).toBe(false);

    const enabled = resolveExperimentGates(resolveExperimentStates(definitions, { procedural: true }));
    expect(enabled).toEqual({
      disabledToolNames: new Set(),
      disabledSkillNames: new Set(),
      disabledAgentNames: new Set(),
    });

    const disabled = resolveExperimentGates(resolveExperimentStates(definitions, { procedural: false }));
    expect(disabled.disabledToolNames).toEqual(new Set(["generate_report"]));
    expect(disabled.disabledSkillNames).toEqual(new Set(["report-recipes"]));
    expect(disabled.disabledAgentNames).toEqual(new Set(["procedural-builder"]));
  });
});
