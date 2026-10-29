// @summary Runtime eval for autonomous delegation of a multi-file known-key reference lookup

import type { RuntimeEvalTask } from "../../runtime-task";
import type { EvalProfile } from "../../task";
import { isRecord } from "../core/helpers";
import { finalAssistantText, RuntimeGrade, traceTargets } from "./grading";
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
  description: "Choose one read-only explore agent for a multi-file known-key lookup without being told to delegate.",
  fixtureVersion: "autonomous-explore-delegation-v3",
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
        "Complete this as one isolated read-only exploration: the main task must not directly read regional source " +
        "files and should only synthesize the exploration result. Do not interpret the values.",
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
    const rootId = input.session.threadId;
    const spawns = input.toolCalls.filter((call) => call.name === "spawn_agent" && call.outcome === "success");
    if (!spawns.some((call) => isRecord(call.input) && call.input.agent_type === "explore"))
      return grade.fail("spawn", "The multi-file lookup was not delegated to an explore agent.", "behavior");
    const parentSourceReads = input.toolCalls.filter(
      (call) =>
        call.threadId === rootId &&
        call.capability === "read" &&
        call.outcome === "success" &&
        (world.sourcePaths.some((path) => traceTargets(call, path)) ||
          world.facts.some((fact) => JSON.stringify(call.output ?? "").includes(fact))),
    );
    if (parentSourceReads.length > 0)
      return grade.fail("parent_read", "The main task read regional source content directly.", "runtime_policy");
    const childOutputs = input.toolCalls
      .filter((call) => call.threadId !== rootId && call.capability === "read" && call.outcome === "success")
      .map((call) => JSON.stringify(call.output ?? ""));
    if (!world.facts.every((fact) => childOutputs.some((output) => output.includes(fact))))
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
