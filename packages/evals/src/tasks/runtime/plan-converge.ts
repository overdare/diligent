// @summary Runtime eval for plan-mode discovery, one bounded question, and decision-complete convergence

import type { DiligentServerRequestResponse } from "@diligent/protocol";
import type { RuntimeEvalTask } from "../../runtime-task";
import { isRecord } from "../core/helpers";
import { finalAssistantText, harmlessFailedProbes, RuntimeGrade, successfulReadsOf, traceTargets } from "./grading";
import {
  createIsolatedFixtureRuntimeConfig,
  DEFAULT_RUNTIME_LIMITS,
  type RuntimeFixtureWorld,
  seededToken,
  verifyExactFiles,
  writeFixture,
} from "./helpers";

export interface PlanConvergeWorld extends RuntimeFixtureWorld {
  apiFact: string;
  uiFact: string;
  preference: string;
}

const API_PATH = "facts/api.txt";
const UI_PATH = "facts/ui.txt";
const QUESTION_ID = "rollout_preference";

export const planConvergeTask: RuntimeEvalTask<PlanConvergeWorld> = {
  id: "plan-converge",
  description: "Discover two fixture facts, ask for one unavailable preference, and converge on one final plan.",
  fixtureVersion: "plan-converge-v3",
  limits: {
    ...DEFAULT_RUNTIME_LIMITS,
    maxTurns: 6,
    maxToolCalls: 5,
    maxUserInputRequests: 1,
    timeoutMs: 180_000,
  },
  statePolicy: { allowedMutations: ["infrastructure", "sessions"] },
  toolPolicy: {
    allowedTools: ["read", "request_user_input"],
    allowedCapabilities: ["read", "user_input"],
    allowedCommands: [],
  },
  async setup(seed, root) {
    const apiFact = seededToken(seed, "API_FACT");
    const uiFact = seededToken(seed, "UI_FACT");
    const preference = seededToken(seed, "PREFERENCE");
    await writeFixture(root, {
      ".git/.keep": "fixture boundary\n",
      [API_PATH]: `${apiFact}\n`,
      [UI_PATH]: `${uiFact}\n`,
    });
    return {
      root,
      seed,
      apiFact,
      uiFact,
      preference,
      expected: "",
      protectedPaths: [".git/.keep", API_PATH, UI_PATH],
      allowedChanges: [],
    };
  },
  createRuntimeConfig: createIsolatedFixtureRuntimeConfig,
  createSteps: () => [
    {
      kind: "turn",
      mode: "plan",
      message:
        "Prepare a decision-complete rollout plan. First read facts/api.txt and facts/ui.txt. The rollout preference is genuinely unavailable from the workspace, so ask exactly one bounded question for it using the stable id rollout_preference. After the answer, finish with exactly one <proposed_plan> block and make no changes.",
    },
  ],
  respondToServerRequest(world, request): DiligentServerRequestResponse {
    if (request.method === "approval/request") return { method: request.method, result: { decision: "once" } };
    return { method: request.method, result: { answers: { [QUESTION_ID]: world.preference } } };
  },
  verify: (world, signal) =>
    verifyExactFiles(world, { [API_PATH]: `${world.apiFact}\n`, [UI_PATH]: `${world.uiFact}\n` }, signal),
  snapshotWorld: async (world) => ({ apiFact: world.apiFact, uiFact: world.uiFact, preference: world.preference }),
  evaluate(input) {
    const grade = new RuntimeGrade("plan_converge");
    const { world } = input;
    const apiRead = successfulReadsOf(input, API_PATH).find((call) =>
      JSON.stringify(call.output).includes(world.apiFact),
    );
    const uiRead = successfulReadsOf(input, UI_PATH).find((call) => JSON.stringify(call.output).includes(world.uiFact));
    if (!apiRead || !uiRead)
      return grade.fail("discovery", "Both fixture facts must be read before planning.", "behavior");
    const questions = input.toolCalls.filter(
      (call) => call.capability === "user_input" && call.outcome === "success" && asksFor(call.input, QUESTION_ID),
    );
    if (questions.length === 0)
      return grade.fail("question", "The unavailable rollout preference was never asked for.", "behavior");
    if (questions[0]!.sequence < Math.max(apiRead.sequence, uiRead.sequence))
      grade.note("asked_before_discovery", "The preference was requested before both facts were read.");
    if (questionCount(questions[0]!.input) > 1)
      grade.note("extra_questions", "The clarification bundled questions beyond the unavailable preference.");
    const text = finalAssistantText(input);
    if (count(text, "<proposed_plan>") !== 1 || count(text, "</proposed_plan>") !== 1)
      return grade.fail(
        "plan_block",
        "The final response must contain exactly one proposed_plan block.",
        "format_contract",
      );
    if (![world.apiFact, world.uiFact, world.preference].every((value) => text.includes(value)))
      return grade.fail(
        "plan_facts",
        "The final plan must contain every discovered fact and the answer.",
        "semantic_goal",
      );
    if (input.verifier?.timedOut)
      return grade.fail("verifier_timeout", "Fixture verification timed out.", "harness_terminal");
    if (input.verifier?.exitCode !== 0)
      return grade.fail("verifier", "Plan mode changed the fixture facts.", "runtime_policy");
    if (harmlessFailedProbes(input).length > 0)
      grade.note("read_probe", "A read failed before the facts were discovered.", { impact: "info" });
    const otherReads = input.toolCalls.filter(
      (call) =>
        call.capability === "read" &&
        call.outcome === "success" &&
        !traceTargets(call, API_PATH, input.threadCwd) &&
        !traceTargets(call, UI_PATH, input.threadCwd),
    );
    if (otherReads.length > 0) grade.note("additional_read", "Additional safe reads were made.", { impact: "info" });
    return grade.pass();
  },
};

function asksFor(value: unknown, id: string): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.questions) &&
    value.questions.some((question) => isRecord(question) && question.id === id)
  );
}

function questionCount(value: unknown): number {
  return isRecord(value) && Array.isArray(value.questions) ? value.questions.length : 0;
}

function count(text: string, value: string): number {
  return text.split(value).length - 1;
}
