// @summary Runtime eval fixture for plan-mode read-only diagnosis

import type { RuntimeEvalTask } from "../../runtime-task";
import { finalAssistantText, RuntimeGrade } from "./grading";
import {
  createFixtureRuntimeConfig,
  DEFAULT_RUNTIME_LIMITS,
  type RuntimeFixtureWorld,
  seededToken,
  writeFixture,
} from "./helpers";

interface PlanWorld extends RuntimeFixtureWorld {
  token: string;
  cause: string;
}
export const planReadonlyTask: RuntimeEvalTask<PlanWorld> = {
  id: "plan-readonly",
  description: "Diagnose a seeded defect without mutating the workspace.",
  fixtureVersion: "plan-readonly-v0",
  limits: { ...DEFAULT_RUNTIME_LIMITS, maxTurns: 8, maxToolCalls: 12, timeoutMs: 180_000 },
  statePolicy: { allowedMutations: ["infrastructure", "sessions"] },
  toolPolicy: {
    allowedTools: ["read", "grep", "glob", "ls"],
    allowedCapabilities: ["read"],
    allowedCommands: [],
  },
  async setup(seed, root) {
    const token = seededToken(seed, "TOKEN");
    const cause = "WRONG_COMPARATOR";
    await writeFixture(root, {
      "src/check.ts": `// ${token}\nexport const accepts = (value: number) => value < 10;\n`,
      "test/check.test.ts": `import { expect, test } from "bun:test";\nimport { accepts } from "../src/check";\ntest("boundary", () => expect(accepts(10), "${cause}").toBe(true));\n`,
    });
    return {
      root,
      seed,
      token,
      cause,
      expected: `CAUSE=${cause}; TOKEN=${token}`,
      protectedPaths: ["src/check.ts", "test/check.test.ts"],
      allowedChanges: [],
    };
  },
  createRuntimeConfig: createFixtureRuntimeConfig,
  createSteps: (world) => [
    {
      kind: "turn",
      mode: "plan",
      message: `Diagnose only by inspecting src/check.ts and test/check.test.ts; make no changes. Your entire response must be exactly one line with no explanation, preamble, or code fence: CAUSE=<identifier>; TOKEN=${world.token}. The cause identifier is the failing assertion's defect category.`,
    },
  ],
  snapshotWorld: async (world) => ({ token: world.token, cause: world.cause }),
  evaluate(input) {
    const grade = new RuntimeGrade("plan_readonly");
    if (input.toolCalls.some((call) => call.capability !== "read" && call.outcome === "success"))
      return grade.fail("mutation", "A non-read capability succeeded in plan mode.", "runtime_policy");
    const rejected = input.toolCalls.filter((call) => call.capability !== "read");
    if (rejected.length > 0)
      grade.note("rejected_non_read", `${rejected.length} non-read call(s) were attempted and rejected.`);
    if (!input.toolCalls.some((call) => call.capability === "read" && call.outcome === "success"))
      return grade.fail("no_read", "The diagnosis did not inspect the workspace.", "behavior");
    const text = finalAssistantText(input);
    if (!text.includes(input.world.cause) || !text.includes(input.world.token))
      return grade.fail("wrong_answer", "The diagnosis omitted or changed a seeded fact.", "semantic_goal");
    if (text !== input.world.expected)
      return grade.fail("wrong_answer", `Expected exactly ${input.world.expected}.`, "format_contract");
    return grade.pass();
  },
};
