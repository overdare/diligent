// @summary Runtime eval for carrying an opaque diagnosis across a plan-to-execute transition

import { unlink } from "node:fs/promises";
import type { RuntimeEvalTask } from "../../runtime-task";
import { finalAssistantText, passingCommandRuns, RuntimeGrade, successfulReadsOf } from "./grading";
import {
  createFixtureRuntimeConfig,
  DEFAULT_RUNTIME_LIMITS,
  exactFile,
  type RuntimeFixtureWorld,
  seededToken,
  writeFixture,
} from "./helpers";

export interface PlanToExecuteWorld extends RuntimeFixtureWorld {
  token: string;
  multiplier: number;
  offset: number;
  diagnosisPath: string;
}

const SOURCE_PATH = "src/value.ts";
const DIAGNOSIS_PATH = "spec/private-contract.txt";

export const planToExecuteTask: RuntimeEvalTask<PlanToExecuteWorld> = {
  id: "plan-to-execute",
  description: "Persist an opaque read-only diagnosis and implement it after its source is withdrawn.",
  fixtureVersion: "plan-to-execute-v4",
  limits: { ...DEFAULT_RUNTIME_LIMITS, maxTurns: 14, maxToolCalls: 20, timeoutMs: 300_000 },
  statePolicy: { allowedMutations: ["infrastructure", "sessions"] },
  toolPolicy: {
    allowedTools: ["read", "grep", "glob", "ls", "write", "edit", "multi_edit", "apply_patch", "bash"],
    allowedCapabilities: ["read", "write", "execute"],
    allowedCommands: ["bun test"],
  },
  async setup(seed, root) {
    const token = seededToken(seed, "CONTRACT");
    const multiplier = (Number.parseInt(seed.slice(0, 4), 36) % 5) + 2;
    const offset = (Number.parseInt(seed.slice(4, 8), 36) % 13) + 1;
    await writeFixture(root, {
      "package.json": `${JSON.stringify({ scripts: { test: "bun test test/value.test.ts" } }, null, 2)}\n`,
      [SOURCE_PATH]: "export function adjustValue(value: number): number {\n  return value;\n}\n",
      [DIAGNOSIS_PATH]: [
        `Contract id: ${token}`,
        `Required behavior: return value * ${multiplier} + ${offset}.`,
        "The implementation must remain a pure number-to-number function.",
        "",
      ].join("\n"),
      "test/value.test.ts": [
        'import { expect, test } from "bun:test";',
        'import { adjustValue } from "../src/value";',
        'test("returns a finite number", () => expect(Number.isFinite(adjustValue(2))).toBe(true));',
        "",
      ].join("\n"),
      "AGENTS.md": "Do not modify tests or package metadata. Verify implementation changes with exactly `bun test`.\n",
    });
    return {
      root,
      seed,
      token,
      multiplier,
      offset,
      diagnosisPath: DIAGNOSIS_PATH,
      expected: "",
      protectedPaths: ["test/value.test.ts", "AGENTS.md", "package.json"],
      allowedChanges: [SOURCE_PATH, DIAGNOSIS_PATH],
    };
  },
  createRuntimeConfig: createFixtureRuntimeConfig,
  createSteps: () => [
    {
      kind: "turn",
      mode: "plan",
      message:
        `Read ${DIAGNOSIS_PATH} and ${SOURCE_PATH}, then diagnose the incomplete value transformation. ` +
        "Produce a concrete implementation plan that retains the contract ID and exact formula. Keep this turn " +
        "read-only: do not modify files or execute shell commands.",
    },
    {
      kind: "turn",
      mode: "execute",
      message:
        "The specification source has now been withdrawn. Implement the diagnosis retained in your plan, preserve tests and metadata, and verify with `bun test`.",
    },
  ],
  async prepareStep(world, _step, index) {
    if (index === 1) await unlink(`${world.root}/${world.diagnosisPath}`);
  },
  async verify(world, signal) {
    const started = performance.now();
    const expression =
      `import { adjustValue } from ${JSON.stringify(`${world.root}/${SOURCE_PATH}`)}; ` +
      `if (adjustValue(7) !== ${7 * world.multiplier + world.offset} || ` +
      `adjustValue(-3) !== ${-3 * world.multiplier + world.offset}) process.exit(1);`;
    const verifierProcess = Bun.spawn([process.execPath, "-e", expression], {
      cwd: world.root,
      stdout: "pipe",
      stderr: "pipe",
      signal,
    });
    const exitCode = await verifierProcess.exited;
    return {
      argv: ["hidden-contract-verifier"],
      exitCode,
      elapsedMs: Math.round(performance.now() - started),
      stdout: (await new Response(verifierProcess.stdout).text()).slice(0, 16_384),
      stderr: (await new Response(verifierProcess.stderr).text()).slice(0, 16_384),
      timedOut: signal.aborted,
    };
  },
  snapshotWorld: async (world) => ({ source: await exactFile(world.root, SOURCE_PATH) }),
  evaluate(input) {
    const grade = new RuntimeGrade("plan_to_execute");
    const planCalls = input.toolCalls.filter((call) => call.turnIndex === 0);
    if (planCalls.some((call) => call.capability !== "read" && call.outcome === "success"))
      return grade.fail("plan_mutation", "The planning turn ran a non-read tool successfully.", "runtime_policy");
    const rejected = planCalls.filter((call) => call.capability !== "read");
    if (rejected.length > 0)
      grade.note("plan_rejected_non_read", `${rejected.length} non-read call(s) were rejected in the planning turn.`);
    if (successfulReadsOf(input, DIAGNOSIS_PATH).length === 0)
      return grade.fail("diagnosis", "The planning turn did not inspect the private contract.", "behavior");
    const planText = input.turns[0] ? finalAssistantText({ turns: [input.turns[0]] }) : "";
    if (
      !planText.includes(input.world.token) ||
      !planText.includes(String(input.world.multiplier)) ||
      !planText.includes(String(input.world.offset))
    )
      return grade.fail("plan_context", "The plan did not retain every opaque contract detail.", "semantic_goal");
    if (input.verifier?.timedOut)
      return grade.fail("verifier_timeout", "Hidden contract verification timed out.", "harness_terminal");
    if (input.verifier?.exitCode !== 0)
      return grade.fail(
        "contract",
        "The implementation did not satisfy the retained private contract.",
        "semantic_goal",
      );
    const writes = input.toolCalls.filter((call) => call.capability === "write" && call.outcome === "success");
    if (writes.length === 0) return grade.fail("no_write", "No implementation write succeeded.", "behavior");
    const lastWrite = Math.max(...writes.map((call) => call.sequence));
    if (!passingCommandRuns(input, "bun test").some((call) => call.sequence > lastWrite))
      return grade.fail("no_test", "The final implementation was not followed by a passing `bun test`.", "behavior");
    return grade.pass();
  },
};
