// @summary Runtime eval for one tool-free turn that must return an exact seeded reply

import type { RuntimeEvalTask } from "../../runtime-task";
import { finalAssistantText, RuntimeGrade, unwrapReply } from "./grading";
import { createFixtureRuntimeConfig, DEFAULT_RUNTIME_LIMITS, type RuntimeFixtureWorld, seededToken } from "./helpers";

export type BasicResponseWorld = RuntimeFixtureWorld;

export const basicResponseTask: RuntimeEvalTask<BasicResponseWorld> = {
  id: "basic-response",
  description: "Answer one tool-free prompt through the runtime with an exact seeded reply.",
  fixtureVersion: "basic-response-v1",
  capability: "basic_response",
  limits: { ...DEFAULT_RUNTIME_LIMITS, maxTurns: 1, maxToolCalls: 0, maxChangedFiles: 0, timeoutMs: 300_000 },
  toolPolicy: { allowedTools: [], allowedCapabilities: [], allowedCommands: [] },
  async setup(seed, root) {
    return { root, seed, expected: seededToken(seed, "PONG"), protectedPaths: [], allowedChanges: [] };
  },
  createRuntimeConfig: createFixtureRuntimeConfig,
  createSteps: (world) => [{ kind: "turn", message: `Reply with exactly ${world.expected} and nothing else.` }],
  snapshotWorld: async (world) => ({ expected: world.expected }),
  evaluate(input) {
    const grade = new RuntimeGrade("basic_response");
    const answer = finalAssistantText(input);
    if (!answer) return grade.fail("empty", "The model returned no assistant text.", "semantic_goal");
    if (unwrapReply(answer) === input.world.expected) return grade.pass();
    return answer.includes(input.world.expected)
      ? grade.fail("format", `Expected exactly ${input.world.expected}.`, "format_contract")
      : grade.fail("answer", "The reply did not contain the requested token.", "semantic_goal");
  },
};
