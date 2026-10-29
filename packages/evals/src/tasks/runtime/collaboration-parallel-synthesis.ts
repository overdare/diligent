// @summary Runtime eval for two overlapping read-only children and ordered parent synthesis

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeEvalTask } from "../../runtime-task";
import type { EvalProfile } from "../../task";
import { isRecord } from "../core/helpers";
import { finalAssistantText, isExactReply, RuntimeGrade, successfulReadsOf } from "./grading";
import {
  createIsolatedFixtureRuntimeConfig,
  DEFAULT_RUNTIME_LIMITS,
  exactFile,
  type RuntimeFixtureWorld,
  seededToken,
  sha256Text,
  verifyExactFiles,
  writeFixture,
} from "./helpers";

const SOURCE_PATHS = ["regions/north/coordination.fact", "regions/south/coordination.fact"] as const;
const ARTIFACT_PATH = "parallel-synthesis.txt";
const FINAL_RESPONSE = "PARALLEL_SYNTHESIS_RECORDED";

interface RuntimeConfigRecord {
  agentsEnabled: boolean;
  builtinNames: string[];
}

export interface CollaborationParallelSynthesisWorld extends RuntimeFixtureWorld {
  tokens: [string, string];
  sourcePaths: [string, string];
  sourceHashes: [string, string];
  artifactPath: string;
  clientPrompt: string;
  workerBriefs: [string, string];
  finalResponse: string;
  expectedHash: string;
  runtimeConfigs: RuntimeConfigRecord[];
}

export const collaborationParallelSynthesisTask: RuntimeEvalTask<CollaborationParallelSynthesisWorld> = {
  id: "collaboration-parallel-synthesis",
  description: "Run two independent read-only specialists concurrently and synthesize their facts in fixed order.",
  fixtureVersion: "collaboration-parallel-synthesis-v8",
  limits: {
    ...DEFAULT_RUNTIME_LIMITS,
    maxTurns: 10,
    maxToolCalls: 8,
    maxChangedFiles: 1,
    maxChangedBytes: 128,
    maxChildAgents: 2,
    timeoutMs: 180_000,
  },
  statePolicy: { allowedMutations: ["infrastructure", "sessions"] },
  toolPolicy: {
    allowedTools: ["spawn_agent", "wait", "read", "apply_patch", "edit"],
    allowedCapabilities: ["collab", "read", "write"],
    allowedCommands: [],
  },
  async setup(seed, root) {
    const fixture = fixtureFor(seed);
    await writeFixture(root, {
      [SOURCE_PATHS[0]]: `${fixture.tokens[0]}\n`,
      [SOURCE_PATHS[1]]: `${fixture.tokens[1]}\n`,
    });
    return {
      root,
      seed,
      protectedPaths: [...SOURCE_PATHS],
      allowedChanges: [ARTIFACT_PATH],
      ...fixture,
      runtimeConfigs: [],
    };
  },
  createRuntimeConfig: createParallelRuntimeConfig,
  createSteps: (world) => [{ kind: "turn", mode: "default", message: world.clientPrompt }],
  verify: (world, signal) => verifyExactFiles(world, { [ARTIFACT_PATH]: world.expected }, signal),
  snapshotWorld: async (world) => ({
    artifact: await exactFile(world.root, ARTIFACT_PATH),
    artifactHash: sha256Text((await exactFile(world.root, ARTIFACT_PATH)) ?? ""),
    sourceHashes: await Promise.all(
      SOURCE_PATHS.map(async (path) => sha256Text(await readFile(join(world.root, path), "utf8"))),
    ),
    runtimeConfigs: world.runtimeConfigs,
  }),
  evaluate(input) {
    const grade = new RuntimeGrade("collaboration_parallel_synthesis");
    const rootId = input.session.threadId;
    const sourceReads = SOURCE_PATHS.map((path) => successfulReadsOf(input, path));
    if (sourceReads.some((reads) => reads.some((call) => call.threadId === rootId)))
      return grade.fail("parent_read", "The main task read a regional source directly.", "runtime_policy");
    const readers = sourceReads.map((reads) => new Set(reads.map((call) => call.threadId)));
    if (readers.some((ids) => ids.size === 0))
      return grade.fail("delegation", "Each regional source must be read by a spawned specialist.", "behavior");
    if ([...readers[0]!].some((id) => readers[1]!.has(id)))
      return grade.fail("cross_region", "One specialist read both regional sources.", "runtime_policy");
    const spawns = input.toolCalls.filter(
      (call) => call.name === "spawn_agent" && call.outcome === "success" && call.threadId === rootId,
    );
    if (spawns.some((call) => !isRecord(call.input) || call.input.agent_type !== "explore"))
      return grade.fail("role", "Both specialists must use the read-only exploration role.", "behavior");
    const firstWait = input.toolCalls.find((call) => call.name === "wait" && call.threadId === rootId);
    if (firstWait && spawns.filter((call) => call.sequence < firstWait.sequence).length < 2)
      return grade.fail("not_concurrent", "The main task joined before both specialists were running.", "behavior");
    if (input.verifier?.timedOut)
      return grade.fail("verifier_timeout", "Artifact verification timed out.", "harness_terminal");
    if (input.verifier?.exitCode !== 0)
      return grade.fail("result", "The synthesized artifact does not contain both facts in order.", "semantic_goal");
    if (!isExactReply(finalAssistantText(input), FINAL_RESPONSE))
      return grade.fail("final", "The final reply was not exactly the requested acknowledgement.", "format_contract");
    if (input.toolCalls.some((call) => call.outcome !== "success"))
      grade.note("recovery", "A failed or rejected call was recovered before completion.");
    if (spawns.length > 2) grade.note("extra_specialists", "More than two specialists were spawned.");
    const briefs = spawns.map((call) => (isRecord(call.input) ? JSON.stringify(call.input.message ?? "") : ""));
    if (briefs.some((brief) => SOURCE_PATHS.every((path) => brief.includes(path))))
      grade.note("cross_region_brief_reference", "A specialist brief named both regions while reads stayed isolated.", {
        dimension: "behavior",
        impact: "info",
      });
    return grade.pass();
  },
};

async function createParallelRuntimeConfig(world: CollaborationParallelSynthesisWorld, profile: EvalProfile) {
  const config = await createIsolatedFixtureRuntimeConfig(world, profile);
  config.diligent = { ...config.diligent, agents: { enabled: true } };
  world.runtimeConfigs.push({
    agentsEnabled: config.diligent.agents?.enabled === true,
    builtinNames: config.agentDefinitions.map((definition) => definition.name),
  });
  return config;
}

function fixtureFor(seed: string) {
  const tokens: [string, string] = [seededToken(seed, "NORTH_FACT"), seededToken(seed, "SOUTH_FACT")];
  const expected = `${tokens[0]}\n${tokens[1]}\n`;
  return {
    tokens,
    sourcePaths: [...SOURCE_PATHS] as [string, string],
    sourceHashes: [sha256Text(`${tokens[0]}\n`), sha256Text(`${tokens[1]}\n`)] as [string, string],
    artifactPath: ARTIFACT_PATH,
    clientPrompt:
      `Retrieve the independent coordination facts from ${SOURCE_PATHS[0]} and ${SOURCE_PATHS[1]}. ` +
      "Treat them as latency-sensitive independent investigations: use the same read-only exploration role for both, " +
      "complete them concurrently, and keep each regional investigation isolated from the other. " +
      "The main task must not directly read either source; it should only synthesize the two returned results. " +
      `Create ${ARTIFACT_PATH} containing the north fact followed by a newline, the south fact, and a trailing newline. ` +
      `Do not modify either source. Reply exactly ${FINAL_RESPONSE}.`,
    workerBriefs: [
      `Read only ${SOURCE_PATHS[0]} exactly once. Return only its exact token, without commentary or a trailing newline. Do not inspect any other region.`,
      `Read only ${SOURCE_PATHS[1]} exactly once. Return only its exact token, without commentary or a trailing newline. Do not inspect any other region.`,
    ] as [string, string],
    finalResponse: FINAL_RESPONSE,
    expected,
    expectedHash: sha256Text(expected),
  };
}
