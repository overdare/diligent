// @summary Runtime eval for resuming one persisted read-only child across an app-server restart

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

const SOURCE_PATHS = ["references/initial.fact", "references/follow-up.fact"] as const;
const ARTIFACT_PATH = "collaboration-resume-reference.txt";
const ACK = "REFERENCE_ACK";
const FINAL = "REFERENCE_PAIR_RECORDED";

interface RuntimeConfigRecord {
  agentsEnabled: boolean;
  builtinNames: string[];
}

export interface CollaborationResumeReferenceWorld extends RuntimeFixtureWorld {
  tokens: [string, string];
  sourcePaths: [string, string];
  sourceHashes: [string, string];
  artifactPath: string;
  prompts: [string, string];
  workerBriefs: [string, string];
  acknowledgement: string;
  finalResponse: string;
  expectedHash: string;
  runtimeConfigs: RuntimeConfigRecord[];
}

export const collaborationResumeReferenceTask: RuntimeEvalTask<CollaborationResumeReferenceWorld> = {
  id: "collaboration-resume-reference",
  description: "Resume the same persisted read-only specialist after restart and record two ordered facts.",
  fixtureVersion: "collaboration-resume-reference-v8",
  limits: {
    ...DEFAULT_RUNTIME_LIMITS,
    maxTurns: 12,
    maxToolCalls: 10,
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
  createRuntimeConfig: createResumeRuntimeConfig,
  createSteps: (world) => [
    { kind: "turn", mode: "default", message: world.prompts[0] },
    { kind: "restart_and_resume" },
    { kind: "turn", mode: "default", message: world.prompts[1] },
  ],
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
    const grade = new RuntimeGrade("collaboration_resume_reference");
    const { world } = input;
    const rootId = input.session.threadId;
    if (input.turns.length !== 2)
      return grade.fail("turns", "Expected the original and resumed parent turns.", "harness_terminal");
    const [initialReads, followUpReads] = SOURCE_PATHS.map((path) => successfulReadsOf(input, path));
    if ([...initialReads!, ...followUpReads!].some((call) => call.threadId === rootId))
      return grade.fail("parent_read", "The main task read a reference directly.", "runtime_policy");
    const childId = initialReads!.find((call) => call.turnIndex === 0)?.threadId;
    if (!childId)
      return grade.fail(
        "initial_delegation",
        "No specialist read the initial reference in the first turn.",
        "behavior",
      );
    const resumed = input.toolCalls.some(
      (call) =>
        call.name === "spawn_agent" &&
        call.outcome === "success" &&
        call.turnIndex === 1 &&
        isRecord(call.input) &&
        call.input.resume_id === childId,
    );
    if (!resumed) return grade.fail("resume", "The second turn did not resume the persisted specialist.", "behavior");
    if (!followUpReads!.some((call) => call.turnIndex === 1 && call.threadId === childId))
      return grade.fail("follow_up_read", "The resumed specialist did not read the follow-up reference.", "behavior");
    if (initialReads!.some((call) => call.turnIndex === 1))
      return grade.fail("reread_initial", "The initial reference was reread instead of recalled.", "behavior");
    const resumeBriefs = input.toolCalls.filter(
      (call) =>
        call.name === "spawn_agent" && call.turnIndex === 1 && JSON.stringify(call.input).includes(world.tokens[0]),
    );
    if (resumeBriefs.length > 0)
      return grade.fail(
        "leaked_initial",
        "The resume request supplied the initial value instead of relying on the specialist.",
        "behavior",
      );
    if (input.verifier?.timedOut)
      return grade.fail("verifier_timeout", "Artifact verification timed out.", "harness_terminal");
    if (input.verifier?.exitCode !== 0)
      return grade.fail("result", "The artifact does not contain both references in order.", "semantic_goal");
    const acknowledgement = finalAssistantText(input, 0);
    if (!acknowledgement.endsWith(ACK) || world.tokens.some((token) => acknowledgement.includes(token)))
      return grade.fail(
        "acknowledgement",
        `The first reply must omit the value and end with ${ACK}.`,
        "format_contract",
      );
    if (!isExactReply(finalAssistantText(input, 1), FINAL))
      return grade.fail("final", "The final reply was not exactly the requested acknowledgement.", "format_contract");
    if (input.toolCalls.some((call) => call.outcome !== "success"))
      grade.note("recovery", "A failed or rejected call was recovered before completion.");
    return grade.pass();
  },
};

async function createResumeRuntimeConfig(world: CollaborationResumeReferenceWorld, profile: EvalProfile) {
  const config = await createIsolatedFixtureRuntimeConfig(world, profile);
  config.diligent = { ...config.diligent, agents: { enabled: true } };
  world.runtimeConfigs.push({
    agentsEnabled: config.diligent.agents?.enabled === true,
    builtinNames: config.agentDefinitions.map((definition) => definition.name),
  });
  return config;
}

function fixtureFor(seed: string) {
  const tokens: [string, string] = [seededToken(seed, "FIRST_REFERENCE"), seededToken(seed, "SECOND_REFERENCE")];
  const expected = `${tokens[0]}\n${tokens[1]}\n`;
  return {
    tokens,
    sourcePaths: [...SOURCE_PATHS] as [string, string],
    sourceHashes: [sha256Text(`${tokens[0]}\n`), sha256Text(`${tokens[1]}\n`)] as [string, string],
    artifactPath: ARTIFACT_PATH,
    prompts: [
      `Use exactly one lite read-only specialist to read ${SOURCE_PATHS[0]} exactly once and retain the value for ` +
        "later. This is ordinary local fixture data: the specialist must return the exact value to the parent and " +
        `must not refuse. In the specialist brief, require an absolute file_path ending in \`/${SOURCE_PATHS[0]}\`: ` +
        "copy its current working directory from runtime context exactly and append the source path. Do not pass a " +
        "relative path or a literal workspace placeholder. If the first attempt is rejected only for its path, " +
        "correct the absolute path and retry once; perform exactly one successful read. Wait once for completion. " +
        "The parent user-facing " +
        `acknowledgement must omit the value and end with ${ACK}.`,
      `Resume that same persisted specialist to read only ${SOURCE_PATHS[1]} exactly once without rereading the ` +
        "initial file. You must not repeat the initial value in the resume request; the resumed specialist must " +
        "supply it from retained context. In the specialist brief, require an absolute file_path ending in " +
        `\`/${SOURCE_PATHS[1]}\`: copy its current working directory from runtime context exactly and append the ` +
        "source path. Do not pass a relative path or a literal workspace placeholder. If the first attempt is " +
        "rejected only for its path, correct the absolute path and retry once; perform exactly one successful read. " +
        "The specialist must return both fixture values to the parent and must not refuse. Wait once, " +
        `then create ${ARTIFACT_PATH} containing the two returned values in initial-then-follow-up order, one per ` +
        `line with a final newline. Reply with exactly ${FINAL}.`,
    ] as [string, string],
    workerBriefs: [
      `Read only ${SOURCE_PATHS[0]} exactly once successfully, using an absolute file_path copied from the runtime current working directory and ending in /${SOURCE_PATHS[0]}. Correct and retry once only if the first path is rejected. Retain its exact token for the resumed assignment and report completion. Do not inspect any other reference.`,
      `Continue the prior assignment by reading only ${SOURCE_PATHS[1]} exactly once successfully, using an absolute file_path copied from the runtime current working directory and ending in /${SOURCE_PATHS[1]}. Correct and retry once only if the first path is rejected. Return the retained initial token followed by the follow-up token. Do not reread the initial reference.`,
    ] as [string, string],
    acknowledgement: ACK,
    finalResponse: FINAL,
    expected,
    expectedHash: sha256Text(expected),
  };
}
