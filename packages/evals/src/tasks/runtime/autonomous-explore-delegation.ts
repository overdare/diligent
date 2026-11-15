// @summary Runtime eval for grounded multi-file lookup with autonomous delegation choice

import type { RuntimeEvalTask } from "../../runtime-task";
import type { EvalProfile } from "../../task";
import { finalAssistantText, RuntimeGrade } from "./grading";
import {
  createIsolatedFixtureRuntimeConfig,
  DEFAULT_RUNTIME_LIMITS,
  type RuntimeFixtureWorld,
  seededToken,
  writeFixture,
} from "./helpers";

const SOURCE_FILES = ["primary.txt", "routing.md", "marker.conf", "entry.txt", "reference.md", "routing.conf"];
const SOURCE_PATHS = SOURCE_FILES.map((file, index) => `reference-map/region-${index + 1}/${file}`);

export interface AutonomousExploreDelegationWorld extends RuntimeFixtureWorld {
  facts: string[];
  sourcePaths: string[];
  clientPrompt: string;
}

export const autonomousExploreDelegationTask: RuntimeEvalTask<AutonomousExploreDelegationWorld> = {
  id: "autonomous-explore-delegation",
  description: "Resolve a bounded multi-file lookup, choosing direct work or delegation without a prescribed strategy.",
  fixtureVersion: "autonomous-explore-delegation-v4",
  limits: {
    ...DEFAULT_RUNTIME_LIMITS,
    maxTurns: 20,
    maxToolCalls: 20,
    maxChildAgents: 1,
    maxChangedFiles: 0,
    maxChangedBytes: 0,
    timeoutMs: 240_000,
  },
  statePolicy: { allowedMutations: ["infrastructure", "sessions"] },
  toolPolicy: {
    allowedTools: ["spawn_agent", "wait", "read", "glob", "ls"],
    allowedCapabilities: ["collab", "read"],
    allowedCommands: [],
  },
  async setup(seed, root) {
    const facts = SOURCE_PATHS.map((_, index) => seededToken(seed, `REGION_${index + 1}`));
    await writeFixture(
      root,
      Object.fromEntries(SOURCE_PATHS.map((path, index) => [path, `region_marker=${facts[index]}\n`])),
    );
    return {
      root,
      seed,
      facts,
      sourcePaths: [...SOURCE_PATHS],
      clientPrompt:
        "Locate every definition of the known key region_marker across the regional subdirectories and filename " +
        "variants under reference-map/. Report the six values in region-number order with their defining file paths. " +
        "Do not modify the files or interpret the values.",
      expected: facts.join("\n"),
      protectedPaths: [...SOURCE_PATHS],
      allowedChanges: [],
    };
  },
  createRuntimeConfig: createAgentEnabledConfig,
  createSteps: (world) => [{ kind: "turn", mode: "default", message: world.clientPrompt }],
  snapshotWorld: async (world) => ({ sourcePaths: world.sourcePaths }),
  evaluate(input) {
    const grade = new RuntimeGrade("autonomous_explore");
    const { world } = input;
    const spawns = input.toolCalls.filter((call) => call.name === "spawn_agent" && call.outcome === "success");
    if (spawns.length > 0)
      grade.note(
        "delegation",
        "The bounded lookup used delegation; compare its latency and token cost with direct lookup.",
        { impact: "info" },
      );
    const readOutputs = input.toolCalls
      .filter((call) => call.capability === "read" && call.outcome === "success")
      .map((call) => JSON.stringify(call.output ?? ""));
    if (!world.facts.every((fact) => readOutputs.some((output) => output.includes(fact))))
      return grade.fail("coverage", "The exploration did not ground every regional value.", "semantic_goal");
    const text = finalAssistantText(input);
    const positions = world.facts.map((fact) => text.indexOf(fact));
    if (positions.some((position) => position < 0))
      return grade.fail("synthesis", "The final response omitted a grounded regional value.", "semantic_goal");
    if (positions.some((position, index) => index > 0 && position < positions[index - 1]!))
      return grade.fail("order", "The values were not reported in region-number order.", "format_contract");
    if (input.toolCalls.some((call) => call.outcome !== "success"))
      grade.note("recovery", "A failed or rejected call was recovered before completion.", { impact: "info" });
    return grade.pass();
  },
};

async function createAgentEnabledConfig(world: AutonomousExploreDelegationWorld, profile: EvalProfile) {
  const config = await createIsolatedFixtureRuntimeConfig(world, profile);
  config.diligent = { ...config.diligent, agents: { enabled: true } };
  return config;
}
