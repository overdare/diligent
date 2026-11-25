// @summary Runtime eval for separating a durable preference from transient current-task intent

import { join } from "node:path";
import { readMemory } from "@diligent/runtime";
import type { RuntimeEvalTask, RuntimeVerifierResult } from "../../runtime-task";
import type { EvalProfile } from "../../task";
import { RuntimeGrade } from "./grading";
import {
  createFixtureRuntimeConfig,
  DEFAULT_RUNTIME_LIMITS,
  exactFile,
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
  tags: string[];
  expectedHash: string;
}

export const memoryIntentSplitTask: RuntimeEvalTask<MemoryIntentSplitWorld> = {
  id: "memory-intent-split",
  description: "Persist one durable preference while keeping unrelated current-task intent out of memory.",
  fixtureVersion: "memory-intent-split-v5",
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
    const tags = ["review", "audience"];
    const expected = `${transientValue}\n`;
    await writeFixture(root, {
      ".diligent/memory/memory.jsonl": `${JSON.stringify({
        id: memoryId,
        timestamp: SEEDED_TIMESTAMP,
        type: "preference",
        content: "Preferred review audience is OLD_AUDIENCE.",
        confidence: 0.7,
        tags,
      })}\n`,
    });
    return {
      root,
      seed,
      memoryId,
      durableValue,
      transientValue,
      content,
      tags,
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
  const entries = await readMemory(join(world.root, ".diligent/memory"));
  const output = await exactFile(world.root, OUTPUT_PATH);
  const entry = entries[0];
  const storeText = JSON.stringify(entries);
  const validEntry =
    entries.length === 1 &&
    entry !== undefined &&
    sameKeys(entry, ["confidence", "content", "id", "tags", "timestamp", "type"]) &&
    entry.id === world.memoryId &&
    entry.type === "preference" &&
    entry.content.includes(world.durableValue) &&
    !entry.content.includes("OLD_AUDIENCE") &&
    entry.confidence === 0.7 &&
    Array.isArray(entry.tags) &&
    entry.tags.every((tag) => typeof tag === "string") &&
    entry.timestamp !== SEEDED_TIMESTAMP &&
    Number.isFinite(Date.parse(entry.timestamp));
  const valid = !signal.aborted && validEntry && !storeText.includes(world.transientValue) && output === world.expected;
  return verifierResult(
    started,
    valid,
    signal.aborted,
    valid ? JSON.stringify({ entry, outputHash: world.expectedHash }) : JSON.stringify({ entries, output }),
    "Memory intent split did not match the exact final store and project output.",
  );
}

function sameKeys(value: object, expected: string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);
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
