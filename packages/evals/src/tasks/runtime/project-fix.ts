// @summary Runtime eval fixture for instruction-guided diagnosis, editing, and verification

import type { RuntimeEvalTask } from "../../runtime-task";
import { passingCommandRuns, RuntimeGrade, successfulWritesTo } from "./grading";
import {
  createFixtureRuntimeConfig,
  DEFAULT_RUNTIME_LIMITS,
  exactFile,
  type RuntimeFixtureWorld,
  runVerifier,
  sha256Text,
  writeFixture,
} from "./helpers";

const SOURCE_PATH = "src/value.ts";

interface ProjectFixWorld extends RuntimeFixtureWorld {
  operand: number;
  expectedHash: string;
}

export const projectFixTask: RuntimeEvalTask<ProjectFixWorld> = {
  id: "project-fix",
  description: "Fix a seeded TypeScript defect and verify it with the declared command.",
  fixtureVersion: "project-fix-v1",
  limits: { ...DEFAULT_RUNTIME_LIMITS, maxTurns: 16, maxToolCalls: 24, timeoutMs: 300_000 },
  statePolicy: { allowedMutations: ["infrastructure", "sessions"] },
  toolPolicy: {
    allowedTools: ["read", "grep", "glob", "ls", "write", "edit", "multi_edit", "apply_patch", "bash"],
    allowedCapabilities: ["read", "write", "execute"],
    allowedCommands: ["bun test"],
  },
  async setup(seed, root) {
    const operand = (Number.parseInt(seed.slice(0, 4), 36) % 7) + 2;
    await writeFixture(root, {
      "package.json": `${JSON.stringify({ scripts: { test: "bun test test/value.test.ts" } }, null, 2)}\n`,
      "src/value.ts": `export function addSeed(value: number): number {\n  return value - ${operand};\n}\n`,
      "test/value.test.ts": `import { expect, test } from "bun:test";\nimport { addSeed } from "../src/value";\ntest("adds", () => expect(addSeed(10)).toBe(${10 + operand}));\n`,
      "AGENTS.md": "Do not modify tests or package metadata. Verify the fix with exactly `bun test`.\n",
    });
    const expectedSource = `export function addSeed(value: number): number {\n  return value + ${operand};\n}\n`;
    return {
      root,
      seed,
      operand,
      expected: expectedSource,
      expectedHash: sha256Text(expectedSource),
      protectedPaths: ["test/value.test.ts", "AGENTS.md", "package.json"],
      allowedChanges: ["src/value.ts"],
    };
  },
  createRuntimeConfig: createFixtureRuntimeConfig,
  createSteps: () => [
    {
      kind: "turn",
      message:
        "Diagnose and fix the failing behavior. Follow project instructions and verify the result. Use dedicated read/search tools for inspection; the only allowed shell command is exactly `bun test`.",
    },
  ],
  verify: (world, signal) => runVerifier(world, ["bun", "test"], signal),
  snapshotWorld: async (world) => ({ operand: world.operand, source: await exactFile(world.root, SOURCE_PATH) }),
  evaluate(input) {
    const grade = new RuntimeGrade("project_fix");
    if (input.verifier?.timedOut)
      return grade.fail("test_failed", "Independent verifier timed out.", "harness_terminal");
    if (input.verifier?.exitCode !== 0)
      return grade.fail("test_failed", "Independent verifier failed.", "semantic_goal");
    const source = input.workspace.final.entries.find((entry) => entry.path === SOURCE_PATH);
    if (source?.sha256 !== input.world.expectedHash)
      return grade.fail("wrong_source", "The source does not match the expected semantic fix.", "semantic_goal");
    if (successfulWritesTo(input, SOURCE_PATH).length === 0)
      return grade.fail("no_write", `No successful write changed ${SOURCE_PATH}.`, "behavior");
    if (!input.toolCalls.some((call) => call.capability === "read" && call.outcome === "success"))
      grade.note("no_read", "The fix was made without a successful read.", { dimension: "behavior", impact: "info" });
    const lastWrite = Math.max(
      ...input.toolCalls
        .filter((call) => call.capability === "write" && call.outcome === "success")
        .map((call) => call.sequence),
    );
    const passingTests = passingCommandRuns(input, "bun test");
    if (passingTests.length === 0)
      return grade.fail("no_test", "No successful `bun test` with zero-exit evidence was recorded.", "behavior");
    if (!passingTests.some((call) => call.sequence > lastWrite))
      return grade.fail(
        "test_order",
        "The final successful write was not followed by a passing `bun test`.",
        "behavior",
      );
    return grade.pass();
  },
};
