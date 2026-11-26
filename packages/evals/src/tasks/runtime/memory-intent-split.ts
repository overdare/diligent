// @summary Runtime eval for separating a durable preference from transient current-task intent

import { join } from "node:path";
import { readMemory, readMemoryIndex } from "@diligent/runtime";
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

const OUTPUT_PATH = "CURRENT.txt";
const SEEDED_TIMESTAMP = "2026-07-18T00:00:00.000Z";

export interface MemoryIntentSplitWorld extends RuntimeFixtureWorld {
  memoryId: string;
  durableValue: string;
  transientValue: string;
  content: string;
  expectedHash: string;
}

export const memoryIntentSplitTask: RuntimeEvalTask<MemoryIntentSplitWorld> = {
  id: "memory-intent-split",
  description: "Persist one durable preference while keeping unrelated current-task intent out of memory.",
  fixtureVersion: "memory-intent-split-v6",
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
    const memoryId = "preference.review-audience";
    const durableValue = seededToken(seed, "AUDIENCE");
    const transientValue = seededToken(seed, "CURRENT");
    const content = `Preferred review audience is ${durableValue}.`;
    const expected = `${transientValue}\n`;
    await writeFixture(
      root,
      memoryFixtureFiles([
        {
          id: memoryId,
          name: "Review audience",
          description: "Who reviews this user's work",
          type: "user",
          content: "Preferred review audience is OLD_AUDIENCE.",
          modified: SEEDED_TIMESTAMP,
        },
      ]),
    );
    return {
      root,
      seed,
      memoryId,
      durableValue,
      transientValue,
      content,
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
      message: `For future sessions, please remember that my preferred review audience is ${world.durableValue}, using the stable preference key ${world.memoryId}. Separately, for this task only, create ${OUTPUT_PATH} containing exactly ${world.transientValue} and one trailing newline.`,
    },
  ],
  verify: verifyIntentSplit,
  snapshotWorld: async (world) => ({
    entries: await readMemory(join(world.root, ".diligent/memory")),
    output: await exactFile(world.root, OUTPUT_PATH),
  }),
  evaluate(input) {
    const grade = new RuntimeGrade("memory_intent_split");
    if (input.verifier?.timedOut)
      return grade.fail("verifier_timeout", "Independent verification timed out.", "harness_terminal");
    const output = input.workspace.final.entries.find((entry) => entry.path === OUTPUT_PATH);
    if (output?.sha256 !== input.world.expectedHash)
      return grade.fail("output", `${OUTPUT_PATH} does not contain exactly the current-task value.`, "semantic_goal");
    if (input.verifier?.exitCode !== 0)
      return grade.fail(
        "memory_store",
        "The store does not hold exactly the updated durable preference without the transient value.",
        "semantic_goal",
      );
    if (input.toolCalls.some((call) => call.name === "search_memory"))
      grade.note("memory_search", "Memory was searched before the update.", { impact: "info" });
    if (input.toolCalls.some((call) => call.outcome !== "success"))
      grade.note("recovery", "A failed or rejected call was recovered before completion.");
    return grade.pass();
  },
};

async function createMemoryRuntimeConfig(world: MemoryIntentSplitWorld, profile: EvalProfile) {
  const config = await createFixtureRuntimeConfig(world, profile);
  return {
    ...config,
    diligent: { ...config.diligent, memory: { enabled: true, injectionBudget: 1024, maxItems: 5 } },
  };
}

async function verifyIntentSplit(world: MemoryIntentSplitWorld, signal: AbortSignal): Promise<RuntimeVerifierResult> {
  const started = performance.now();
  const memoryPath = join(world.root, ".diligent/memory");
  const entries = await readMemory(memoryPath);
  const index = await readMemoryIndex(memoryPath);
  const output = await exactFile(world.root, OUTPUT_PATH);
  const entry = entries[0];
  const storeText = JSON.stringify(entries) + index;
  const validEntry =
    entries.length === 1 &&
    entry !== undefined &&
    JSON.stringify(Object.keys(entry).sort()) ===
      JSON.stringify(["content", "description", "id", "modified", "name", "type"]) &&
    entry.id === world.memoryId &&
    (entry.type === "user" || entry.type === "feedback") &&
    entry.content.includes(world.durableValue) &&
    !entry.content.includes("OLD_AUDIENCE") &&
    entry.modified !== SEEDED_TIMESTAMP &&
    Number.isFinite(Date.parse(entry.modified)) &&
    index.includes(`(${world.memoryId}.md)`);
  const valid = !signal.aborted && validEntry && !storeText.includes(world.transientValue) && output === world.expected;
  return verifierResult(
    started,
    valid,
    signal.aborted,
    valid ? JSON.stringify({ entry, outputHash: world.expectedHash }) : JSON.stringify({ entries, output }),
    "Memory intent split did not match the exact final store and project output.",
  );
}

function verifierResult(
  started: number,
  valid: boolean,
  timedOut: boolean,
  stdout: string,
  error: string,
): RuntimeVerifierResult {
  return {
    argv: ["memory-intent-split-verifier"],
    exitCode: valid ? 0 : 1,
    elapsedMs: Math.round(performance.now() - started),
    stdout: valid ? stdout : "",
    stderr: valid ? "" : error,
    timedOut,
  };
}
