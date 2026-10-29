// @summary Runtime eval for adapting to one runner-owned steering requirement after an exact target read

import type { RuntimeEvalTask } from "../../runtime-task";
import { harmlessFailedProbes, RuntimeGrade, successfulReadsOf, successfulWritesTo } from "./grading";
import {
  createFixtureRuntimeConfig,
  DEFAULT_RUNTIME_LIMITS,
  exactFile,
  type RuntimeFixtureWorld,
  seededToken,
  sha256Text,
  writeFixture,
} from "./helpers";

const TARGET_PATH = "config/live-value.txt";
const ACTION_ID = "steer-during-fix-after-read";
const ACTION_TIMEOUT_MS = 30_000;

export interface SteerDuringFixWorld extends RuntimeFixtureWorld {
  targetPath: string;
  baseValue: string;
  originalRequestedValue: string;
  replacementValue: string;
  initialContent: string;
  initialHash: string;
  expectedHash: string;
  actionId: string;
  steerId: string;
  steeringContent: string;
}

export const steerDuringFixTask: RuntimeEvalTask<SteerDuringFixWorld> = {
  id: "steer-during-fix",
  description: "Adapt one exact file mutation to a replacement requirement injected after the target read.",
  fixtureVersion: "steer-during-fix-v5",
  limits: {
    ...DEFAULT_RUNTIME_LIMITS,
    maxTurns: 5,
    maxToolCalls: 4,
    maxChangedFiles: 1,
    maxChangedBytes: 4_096,
    timeoutMs: 180_000,
  },
  statePolicy: { allowedMutations: ["infrastructure", "sessions"] },
  toolPolicy: {
    allowedTools: ["read", "apply_patch", "edit"],
    allowedCapabilities: ["read", "write"],
    allowedCommands: [],
  },
  async setup(seed, root) {
    const baseValue = seededToken(seed, "BASE");
    const originalRequestedValue = seededToken(seed, "ORIGINAL_REQUEST");
    const replacementValue = seededToken(seed, "REPLACEMENT");
    const safeSeed = seed.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "seed";
    const initialContent = `${baseValue}\n`;
    const expected = `${replacementValue}\n`;
    const steeringContent = `Change the requirement for ${TARGET_PATH}: it must contain exactly ${replacementValue} and one trailing newline. Do not use ${originalRequestedValue}.`;
    await writeFixture(root, {
      [TARGET_PATH]: initialContent,
      "control.txt": `${seededToken(seed, "CONTROL")}\n`,
    });
    return {
      root,
      seed,
      targetPath: TARGET_PATH,
      baseValue,
      originalRequestedValue,
      replacementValue,
      initialContent,
      expected,
      initialHash: sha256Text(initialContent),
      expectedHash: sha256Text(expected),
      actionId: ACTION_ID,
      steerId: `steer-during-fix-${safeSeed}`,
      steeringContent,
      protectedPaths: ["control.txt"],
      allowedChanges: [TARGET_PATH],
    };
  },
  createRuntimeConfig: createFixtureRuntimeConfig,
  createSteps: (world) => [
    {
      kind: "turn",
      message: `Inspect ${world.targetPath} to confirm its current value, then change that file so it contains exactly ${world.originalRequestedValue} and one trailing newline.`,
      actions: [
        {
          id: world.actionId,
          timeoutMs: ACTION_TIMEOUT_MS,
          trigger: {
            source: "runtime_event",
            eventType: "tool_end",
            toolName: "read",
            isError: false,
            occurrence: 1,
            allowSubsequentMatches: true,
          },
          request: {
            method: "turn/steer",
            params: { content: world.steeringContent, steerId: world.steerId },
          },
        },
      ],
    },
  ],
  async verify(world, signal) {
    const started = performance.now();
    const actual = await exactFile(world.root, world.targetPath);
    const valid = !signal.aborted && actual === world.expected && !actual.includes(world.originalRequestedValue);
    return {
      argv: ["steer-during-fix-verifier", world.targetPath],
      exitCode: valid ? 0 : 1,
      elapsedMs: Math.round(performance.now() - started),
      stdout: valid ? `Exact replacement verified: ${world.expectedHash}\n` : "",
      stderr: valid ? "" : "Target bytes did not match the steered replacement requirement.\n",
      timedOut: signal.aborted,
    };
  },
  snapshotWorld: async (world) => ({ target: await exactFile(world.root, world.targetPath) }),
  evaluate(input) {
    const grade = new RuntimeGrade("steer_during_fix");
    const { world } = input;
    const reads = successfulReadsOf(input, world.targetPath);
    const writes = successfulWritesTo(input, world.targetPath);
    if (reads.length === 0 || !reads.some((read) => JSON.stringify(read.output).includes(world.baseValue)))
      return grade.fail("read", "The target was never inspected before the change.", "behavior");
    if (writes.length > 0 && writes[0]!.sequence < reads[0]!.sequence)
      return grade.fail("write_before_read", "The target changed before it was inspected.", "behavior");
    if (input.verifier?.timedOut)
      return grade.fail("verifier_timeout", "Independent exact-byte verification timed out.", "harness_terminal");
    if (input.verifier?.exitCode !== 0)
      return grade.fail(
        "verifier",
        "The target does not contain exactly the steered replacement value.",
        "semantic_goal",
      );
    if (writes.some((write) => JSON.stringify(write.input).includes(world.originalRequestedValue)))
      grade.note("superseded_value_written", "The superseded value was written before the steer was applied.");
    if (harmlessFailedProbes(input).length > 0)
      grade.note("failed_read_probe", "A read probe failed before completion.", { impact: "info" });
    if (reads.length > 1) grade.note("repeated_target_read", "The target was read more than once.", { impact: "info" });
    return grade.pass();
  },
};
