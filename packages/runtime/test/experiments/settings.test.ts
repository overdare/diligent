// @summary Tests product experiment resolution and coupled skill/tool gating.

import { describe, expect, it } from "bun:test";
import { resolveExperimentGates, resolveExperimentStates } from "../../src/experiments";

const definitions = [
  {
    id: "preview",
    title: "Preview feature",
    description: "Expose a product-owned preview capability.",
    defaultEnabled: false,
    toolNames: ["preview_tool"],
    skillNames: ["preview-skill"],
    agentNames: ["preview-agent"],
  },
];

describe("experiment settings", () => {
  it("uses product defaults and applies one override to both gates", () => {
    expect(resolveExperimentStates(definitions, undefined)[0]?.enabled).toBe(false);

    const enabled = resolveExperimentGates(resolveExperimentStates(definitions, { preview: true }));
    expect(enabled).toEqual({
      disabledToolNames: new Set(),
      disabledSkillNames: new Set(),
      disabledAgentNames: new Set(),
    });

    const disabled = resolveExperimentGates(resolveExperimentStates(definitions, { preview: false }));
    expect(disabled.disabledToolNames).toEqual(new Set(["preview_tool"]));
    expect(disabled.disabledSkillNames).toEqual(new Set(["preview-skill"]));
    expect(disabled.disabledAgentNames).toEqual(new Set(["preview-agent"]));
  });
});
