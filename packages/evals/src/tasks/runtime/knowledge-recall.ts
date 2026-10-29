// @summary Runtime eval for exact project-knowledge prompt recall

import type { RuntimeEvalTask } from "../../runtime-task";
import type { EvalProfile } from "../../task";
import { finalAssistantText, RuntimeGrade } from "./grading";
import {
  createFixtureRuntimeConfig,
  DEFAULT_RUNTIME_LIMITS,
  exactFile,
  type RuntimeFixtureWorld,
  seededToken,
  sha256Text,
  writeFixture,
} from "./helpers";

export interface KnowledgeRecallWorld extends RuntimeFixtureWorld {
  token: string;
  expectedHash: string;
}

export const knowledgeRecallTask: RuntimeEvalTask<KnowledgeRecallWorld> = {
  id: "knowledge-recall",
  description: "Use project knowledge injected into the runtime prompt to create an exact file.",
  fixtureVersion: "knowledge-recall-v0",
  limits: { ...DEFAULT_RUNTIME_LIMITS, maxTurns: 8, maxToolCalls: 6, timeoutMs: 180_000 },
  statePolicy: { allowedMutations: ["infrastructure", "sessions"] },
  toolPolicy: {
    allowedTools: ["write", "edit", "multi_edit", "apply_patch"],
    allowedCapabilities: ["write"],
    allowedCommands: [],
  },
  async setup(seed, root) {
    const token = seededToken(seed, "CHANNEL");
    const expected = `${token}\n`;
    await writeFixture(root, {
      ".diligent/knowledge/knowledge.jsonl": `${JSON.stringify({
        id: "preference.release-channel",
        timestamp: "2026-07-18T00:00:00.000Z",
        type: "preference",
        content: `The preferred release channel is ${token}.`,
        confidence: 1,
        tags: ["release", "channel"],
      })}\n`,
    });
    return {
      root,
      seed,
      token,
      expected,
      expectedHash: sha256Text(expected),
      protectedPaths: [],
      allowedChanges: ["RELEASE.txt"],
    };
  },
  createRuntimeConfig: createKnowledgeRuntimeConfig,
  createSteps: () => [
    {
      kind: "turn",
      message:
        "Create RELEASE.txt containing only the release channel from the stored project knowledge and one trailing newline. Do not repeat the channel in your response.",
    },
  ],
  snapshotWorld: async (world) => ({ token: world.token, result: await exactFile(world.root, "RELEASE.txt") }),
  evaluate(input) {
    const grade = new RuntimeGrade("knowledge_recall");
    const result = input.workspace.final.entries.find((entry) => entry.path === "RELEASE.txt");
    if (result?.sha256 === sha256Text(input.world.token))
      return grade.fail(
        "wrong_release",
        "RELEASE.txt omitted the prompt-declared trailing newline.",
        "format_contract",
      );
    if (result?.sha256 !== input.world.expectedHash)
      return grade.fail(
        "wrong_release",
        "RELEASE.txt did not contain the exact stored release channel.",
        "semantic_goal",
      );
    if (finalAssistantText(input).includes(input.world.token))
      return grade.fail(
        "repeated_channel",
        "The response repeated the channel despite the instruction.",
        "format_contract",
      );
    if (input.toolCalls.some((call) => call.outcome !== "success"))
      grade.note("write_recovery", "A failed write was recovered.");
    return grade.pass();
  },
};

async function createKnowledgeRuntimeConfig(world: KnowledgeRecallWorld, profile: EvalProfile) {
  const config = await createFixtureRuntimeConfig(world, profile);
  return {
    ...config,
    diligent: { ...config.diligent, knowledge: { enabled: true, injectionBudget: 1024, maxItems: 5 } },
  };
}
