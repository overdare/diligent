// @summary Runtime eval for nested AGENTS.md instruction hierarchy compliance

import type { RuntimeEvalTask } from "../../runtime-task";
import { RuntimeGrade, successfulReadsOf } from "./grading";
import {
  createFixtureRuntimeConfigForCwd,
  DEFAULT_RUNTIME_LIMITS,
  exactFile,
  type RuntimeFixtureWorld,
  seededToken,
  sha256Text,
  verifyExactFiles,
  writeFixture,
} from "./helpers";

export interface InstructionHierarchyWorld extends RuntimeFixtureWorld {
  cwd: string;
  target: string;
  rootMarker: string;
  nestedMarker: string;
  expectedHash: string;
}

const TARGET_PATH = "nested/project/target.txt";
const RESULT_PATH = "nested/project/RESULT.txt";

export const instructionHierarchyTask: RuntimeEvalTask<InstructionHierarchyWorld> = {
  id: "instruction-hierarchy",
  description: "Apply independently seeded root and nested project instructions from a nested runtime cwd.",
  fixtureVersion: "instruction-hierarchy-v2",
  limits: { ...DEFAULT_RUNTIME_LIMITS, maxTurns: 5, maxToolCalls: 4, timeoutMs: 180_000 },
  statePolicy: { allowedMutations: ["infrastructure", "sessions"] },
  toolPolicy: {
    allowedTools: ["read", "write", "edit", "multi_edit", "apply_patch"],
    allowedCapabilities: ["read", "write"],
    allowedCommands: [],
  },
  async setup(seed, root) {
    const target = seededToken(seed, "PAYLOAD");
    const rootMarker = seededToken(seed, "ROOT_RULE");
    const nestedMarker = seededToken(seed, "NESTED_RULE");
    const expected = `${rootMarker}[${target}]${nestedMarker}\n`;
    await writeFixture(root, {
      ".git/.keep": "fixture boundary\n",
      "AGENTS.md": `For RESULT.txt, wrap the exact target payload as ${rootMarker}[PAYLOAD]. Preserve all instruction files.\n`,
      "nested/project/AGENTS.md": `For RESULT.txt, append ${nestedMarker} immediately after the root transformation and finish with one newline.\n`,
      [TARGET_PATH]: `${target}\n`,
    });
    return {
      root,
      seed,
      cwd: `${root}/nested/project`,
      target,
      rootMarker,
      nestedMarker,
      expected,
      expectedHash: sha256Text(expected),
      protectedPaths: [".git/.keep", "AGENTS.md", "nested/project/AGENTS.md", TARGET_PATH],
      allowedChanges: [RESULT_PATH],
    };
  },
  resolveThreadCwd: (world) => world.cwd,
  createRuntimeConfig: (world, profile) => createFixtureRuntimeConfigForCwd(world, profile, world.cwd),
  createSteps: () => [
    {
      kind: "turn",
      mode: "execute",
      message:
        "Inspect target.txt and create RESULT.txt by following every applicable project instruction. Do not modify the target or instruction files.",
    },
  ],
  verify: (world, signal) => verifyExactFiles(world, { [RESULT_PATH]: world.expected }, signal),
  snapshotWorld: async (world) => ({ result: await exactFile(world.root, RESULT_PATH) }),
  evaluate(input) {
    const grade = new RuntimeGrade("instruction_hierarchy");
    if (input.verifier?.timedOut)
      return grade.fail("verifier_timeout", "Independent exact-file verification timed out.", "harness_terminal");
    if (input.verifier?.exitCode !== 0)
      return grade.fail("verifier", "Independent exact-file verification failed.", "semantic_goal");
    const result = input.workspace.final.entries.find((entry) => entry.path === RESULT_PATH);
    if (result?.sha256 !== input.world.expectedHash)
      return grade.fail(
        "wrong_result",
        "RESULT.txt did not combine both hidden instruction transformations exactly.",
        "semantic_goal",
      );
    if (successfulReadsOf(input, TARGET_PATH).length === 0)
      grade.note("target_read_indirect", "The target payload was obtained without a direct read of target.txt.", {
        impact: "info",
      });
    const reads = input.toolCalls.filter((call) => call.capability === "read" && call.outcome === "success");
    if (reads.length > 1)
      grade.note("additional_safe_read", `Observed ${reads.length - 1} additional successful project read(s).`, {
        impact: "info",
      });
    const failed = input.toolCalls.filter((call) => call.outcome !== "success");
    if (failed.length > 0)
      grade.note("failed_call", `Observed ${failed.length} failed or rejected tool call(s) before completion.`);
    return grade.pass();
  },
};
