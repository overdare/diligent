// @summary Runtime eval for deleting one durable preference while completing an independent workspace task

import { join } from "node:path";
import { type KnowledgeEntry, readKnowledge } from "@diligent/runtime";
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

const OUTPUT_PATH = "FORGET.txt";

export interface KnowledgeForgetWorld extends RuntimeFixtureWorld {
  knowledgeId: string;
  forgottenValue: string;
  targetContent: string;
  taskValue: string;
  controlEntry: KnowledgeEntry;
  expectedHash: string;
}

export const knowledgeForgetTask: RuntimeEvalTask<KnowledgeForgetWorld> = {
  id: "knowledge-forget",
  description: "Delete one durable preference while completing an unrelated exact workspace task.",
  fixtureVersion: "knowledge-forget-v6",
  limits: { ...DEFAULT_RUNTIME_LIMITS, maxTurns: 5, maxToolCalls: 5, timeoutMs: 180_000 },
  statePolicy: {
    allowedMutations: ["infrastructure", "sessions", "knowledge"],
    requiredMutations: ["knowledge"],
  },
  toolPolicy: {
    allowedTools: ["search_knowledge", "update_knowledge", "apply_patch", "edit"],
    allowedCapabilities: ["knowledge", "write"],
    allowedCommands: [],
  },
  async setup(seed, root) {
    const knowledgeId = "preference.deploy-window";
    const forgottenValue = seededToken(seed, "WINDOW");
    const targetContent = `Preferred deployment window is ${forgottenValue}.`;
    const taskValue = seededToken(seed, "FORGET_TASK");
    const controlEntry: KnowledgeEntry = {
      id: "preference.control-format",
      timestamp: "2026-07-18T00:01:00.000Z",
      type: "preference",
      content: `Preferred control format is ${seededToken(seed, "CONTROL")}.`,
      confidence: 0.9,
      tags: ["control", "format"],
    };
    const targetEntry: KnowledgeEntry = {
      id: knowledgeId,
      timestamp: "2026-07-18T00:00:00.000Z",
      type: "preference",
      content: targetContent,
      confidence: 0.8,
      tags: ["deployment", "window"],
    };
    const expected = `${taskValue}\n`;
    await writeFixture(root, {
      ".diligent/knowledge/knowledge.jsonl": `${JSON.stringify(targetEntry)}\n${JSON.stringify(controlEntry)}\n`,
    });
    return {
      root,
      seed,
      knowledgeId,
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
  createRuntimeConfig: createKnowledgeRuntimeConfig,
  createSteps: (world) => [
    {
      kind: "turn",
      message: `Please forget my saved deployment-window preference at stable key ${world.knowledgeId}. Separately, create ${OUTPUT_PATH} containing exactly ${world.taskValue} and one trailing newline for this task.`,
    },
  ],
  verify: verifyForgottenKnowledge,
  snapshotWorld: async (world) => ({
    entries: await readKnowledge(join(world.root, ".diligent/knowledge")),
    output: await exactFile(world.root, OUTPUT_PATH),
  }),
  evaluate(input) {
    const grade = new RuntimeGrade("knowledge_forget");
    if (input.verifier?.timedOut)
      return grade.fail("verifier_timeout", "Independent verification timed out.", "harness_terminal");
    const output = input.workspace.final.entries.find((entry) => entry.path === OUTPUT_PATH);
    if (output?.sha256 !== input.world.expectedHash)
      return grade.fail("output", `${OUTPUT_PATH} does not contain exactly the task value.`, "semantic_goal");
    if (input.verifier?.exitCode !== 0)
      return grade.fail(
        "knowledge_store",
        "The store does not hold exactly the untouched control preference after forgetting the target.",
        "semantic_goal",
      );
    if (input.toolCalls.some((call) => call.name === "search_knowledge"))
      grade.note("knowledge_search", "Knowledge was searched around the deletion.", { impact: "info" });
    if (input.toolCalls.some((call) => call.outcome !== "success"))
      grade.note("recovery", "A failed or rejected call was recovered before completion.");
    return grade.pass();
  },
};

async function createKnowledgeRuntimeConfig(world: KnowledgeForgetWorld, profile: EvalProfile) {
  const config = await createFixtureRuntimeConfig(world, profile);
  return {
    ...config,
    diligent: { ...config.diligent, knowledge: { enabled: true, injectionBudget: 1024, maxItems: 5 } },
  };
}

async function verifyForgottenKnowledge(
  world: KnowledgeForgetWorld,
  signal: AbortSignal,
): Promise<RuntimeVerifierResult> {
  const started = performance.now();
  const entries = await readKnowledge(join(world.root, ".diligent/knowledge"));
  const output = await exactFile(world.root, OUTPUT_PATH);
  const storeText = JSON.stringify(entries);
  const validStore =
    entries.length === 1 &&
    JSON.stringify(entries[0]) === JSON.stringify(world.controlEntry) &&
    !entries.some((entry) => entry.id === world.knowledgeId) &&
    !storeText.includes(world.targetContent) &&
    !storeText.includes(world.forgottenValue);
  const valid = !signal.aborted && validStore && output === world.expected;
  return {
    argv: ["knowledge-forget-verifier"],
    exitCode: valid ? 0 : 1,
    elapsedMs: Math.round(performance.now() - started),
    stdout: valid ? JSON.stringify({ entries, outputHash: world.expectedHash }) : "",
    stderr: valid ? "" : "Forgotten knowledge or independent project output did not match the exact final state.",
    timedOut: signal.aborted,
  };
}
