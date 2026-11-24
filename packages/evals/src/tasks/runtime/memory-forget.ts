// @summary Runtime eval for deleting one durable preference while completing an independent workspace task

import { join } from "node:path";
import { type MemoryEntry, readMemory, readMemoryIndex } from "@diligent/runtime";
import type { RuntimeEvalTask, RuntimeVerifierResult } from "../../runtime-task";
import type { EvalProfile } from "../../task";
import { RuntimeGrade } from "./grading";
import {
  createFixtureRuntimeConfig,
  DEFAULT_RUNTIME_LIMITS,
  exactFile,
  memoryFixtureFiles,
  type RuntimeFixtureWorld,
  seededToken,
  sha256Text,
  writeFixture,
} from "./helpers";

const OUTPUT_PATH = "FORGET.txt";

export interface MemoryForgetWorld extends RuntimeFixtureWorld {
  memoryId: string;
  forgottenValue: string;
  targetContent: string;
  taskValue: string;
  controlEntry: MemoryEntry;
  expectedHash: string;
}

export const memoryForgetTask: RuntimeEvalTask<MemoryForgetWorld> = {
  id: "memory-forget",
  description: "Delete one durable preference while completing an unrelated exact workspace task.",
  fixtureVersion: "memory-forget-v7",
  limits: { ...DEFAULT_RUNTIME_LIMITS, maxTurns: 5, maxToolCalls: 5, timeoutMs: 180_000 },
  statePolicy: {
    allowedMutations: ["infrastructure", "sessions", "memory"],
    requiredMutations: ["memory"],
  },
  toolPolicy: {
    allowedTools: ["search_memory", "update_memory", "apply_patch", "edit"],
    allowedCapabilities: ["memory", "write"],
    allowedCommands: [],
  },
  async setup(seed, root) {
    const memoryId = "preference.deploy-window";
    const forgottenValue = seededToken(seed, "WINDOW");
    const targetContent = `Preferred deployment window is ${forgottenValue}.`;
    const taskValue = seededToken(seed, "FORGET_TASK");
    const controlEntry: MemoryEntry = {
      id: "preference.control-format",
      name: "Control format",
      description: "Preferred control format",
      type: "feedback",
      content: `Preferred control format is ${seededToken(seed, "CONTROL")}.`,
      modified: "2026-07-18T00:01:00.000Z",
    };
    const targetEntry: MemoryEntry = {
      id: memoryId,
      name: "Deployment window",
      description: "Preferred deployment window",
      type: "feedback",
      content: targetContent,
      modified: "2026-07-18T00:00:00.000Z",
    };
    const expected = `${taskValue}\n`;
    await writeFixture(root, memoryFixtureFiles([targetEntry, controlEntry]));
    return {
      root,
      seed,
      memoryId,
      forgottenValue,
      targetContent,
      taskValue,
      controlEntry,
      expected,
      expectedHash: sha256Text(expected),
      protectedPaths: [],
      allowedChanges: [OUTPUT_PATH],
    };
  },
  createRuntimeConfig: createMemoryRuntimeConfig,
  createSteps: (world) => [
    {
      kind: "turn",
      message: `Please forget my saved deployment-window preference at stable key ${world.memoryId}. Separately, create ${OUTPUT_PATH} containing exactly ${world.taskValue} and one trailing newline for this task.`,
    },
  ],
  verify: verifyForgottenMemory,
  snapshotWorld: async (world) => ({
    entries: await readMemory(join(world.root, ".diligent/memory")),
    output: await exactFile(world.root, OUTPUT_PATH),
  }),
  evaluate(input) {
    const grade = new RuntimeGrade("memory_forget");
    if (input.verifier?.timedOut)
      return grade.fail("verifier_timeout", "Independent verification timed out.", "harness_terminal");
    const output = input.workspace.final.entries.find((entry) => entry.path === OUTPUT_PATH);
    if (output?.sha256 !== input.world.expectedHash)
      return grade.fail("output", `${OUTPUT_PATH} does not contain exactly the task value.`, "semantic_goal");
    if (input.verifier?.exitCode !== 0)
      return grade.fail(
        "memory_store",
        "The store does not hold exactly the untouched control preference after forgetting the target.",
        "semantic_goal",
      );
    if (input.toolCalls.some((call) => call.name === "search_memory"))
      grade.note("memory_search", "Memory was searched around the deletion.", { impact: "info" });
    if (input.toolCalls.some((call) => call.outcome !== "success"))
      grade.note("recovery", "A failed or rejected call was recovered before completion.");
    return grade.pass();
  },
};

async function createMemoryRuntimeConfig(world: MemoryForgetWorld, profile: EvalProfile) {
  const config = await createFixtureRuntimeConfig(world, profile);
  return {
    ...config,
    diligent: { ...config.diligent, memory: { enabled: true, injectionBudget: 1024, maxItems: 5 } },
  };
}

async function verifyForgottenMemory(world: MemoryForgetWorld, signal: AbortSignal): Promise<RuntimeVerifierResult> {
  const started = performance.now();
  const memoryPath = join(world.root, ".diligent/memory");
  const entries = await readMemory(memoryPath);
  const index = await readMemoryIndex(memoryPath);
  const output = await exactFile(world.root, OUTPUT_PATH);
  const storeText = JSON.stringify(entries) + index;
  const validStore =
    entries.length === 1 &&
    JSON.stringify(entries[0]) === JSON.stringify(world.controlEntry) &&
    index.includes(`(${world.controlEntry.id}.md)`) &&
    !entries.some((entry) => entry.id === world.memoryId) &&
    !storeText.includes(world.targetContent) &&
    !storeText.includes(world.forgottenValue);
  const valid = !signal.aborted && validStore && output === world.expected;
  return {
    argv: ["memory-forget-verifier"],
    exitCode: valid ? 0 : 1,
    elapsedMs: Math.round(performance.now() - started),
    stdout: valid ? JSON.stringify({ entries, outputHash: world.expectedHash }) : "",
    stderr: valid ? "" : "Forgotten memory or independent project output did not match the exact final state.",
    timedOut: signal.aborted,
  };
}
