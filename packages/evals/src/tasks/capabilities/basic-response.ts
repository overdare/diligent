// @summary Capability probe: one plain runtime turn returns an exact seeded reply

import type { RuntimeEvalTask } from "../../runtime-task";
import { finalAssistantText, RuntimeGrade, unwrapReply } from "../runtime/grading";
import {
  createFixtureRuntimeConfig,
  DEFAULT_RUNTIME_LIMITS,
  type RuntimeFixtureWorld,
  seededToken,
} from "../runtime/helpers";

export type BasicResponseCapabilityWorld = RuntimeFixtureWorld;

export const basicResponseCapabilityTask: RuntimeEvalTask<BasicResponseCapabilityWorld> = {
  id: "capability-basic-response",
  description: "Answer one tool-free prompt through the runtime with an exact seeded reply.",
  fixtureVersion: "capability-basic-response-v1",
  limits: { ...DEFAULT_RUNTIME_LIMITS, maxTurns: 1, maxToolCalls: 0, maxChangedFiles: 0, timeoutMs: 300_000 },
  toolPolicy: { allowedTools: [], allowedCapabilities: [], allowedCommands: [] },
  async setup(seed, root) {
    return { root, seed, expected: seededToken(seed, "PONG"), protectedPaths: [], allowedChanges: [] };
  },
  createRuntimeConfig: createFixtureRuntimeConfig,
  createSteps: (world) => [{ kind: "turn", message: `Reply with exactly ${world.expected} and nothing else.` }],
  snapshotWorld: async (world) => ({ expected: world.expected }),
  evaluate(input) {
    const grade = new RuntimeGrade("capability_basic_response");
    const answer = finalAssistantText(input);
    if (!answer) return grade.fail("empty", "The model returned no assistant text.", "semantic_goal");
    if (unwrapReply(answer) === input.world.expected) return grade.pass();
    return answer.includes(input.world.expected)
      ? grade.fail("format", `Expected exactly ${input.world.expected}.`, "format_contract")
      : grade.fail("answer", "The reply did not contain the requested token.", "semantic_goal");
  },
};
