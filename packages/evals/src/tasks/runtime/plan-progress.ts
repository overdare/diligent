// @summary Runtime eval for visible plan creation, ordered progress updates, implementation, and verification

import type { RuntimeEvalTask, RuntimeToolTrace } from "../../runtime-task";
import { isRecord } from "../core/helpers";
import { passingCommandRuns, RuntimeGrade, successfulReadsOf, successfulWritesTo } from "./grading";
import {
  createIsolatedFixtureRuntimeConfig,
  DEFAULT_RUNTIME_LIMITS,
  exactFile,
  type RuntimeFixtureWorld,
  runVerifier,
  seededToken,
  sha256Text,
  writeFixture,
} from "./helpers";

export interface PlanProgressWorld extends RuntimeFixtureWorld {
  base: string;
  middle: string;
  final: string;
  outputs: Record<string, string>;
  outputHashes: Record<string, string>;
  planSteps: string[];
}

const OUTPUT_PATHS = ["generated/stage-one.txt", "generated/stage-two.txt", "generated/stage-three.txt"];

export const planProgressTask: RuntimeEvalTask<PlanProgressWorld> = {
  id: "plan-progress",
  description: "Create and maintain a one-active-step plan while implementing an ordered three-file pipeline.",
  fixtureVersion: "plan-progress-v7",
  limits: { ...DEFAULT_RUNTIME_LIMITS, maxTurns: 24, maxToolCalls: 24, timeoutMs: 300_000 },
  statePolicy: { allowedMutations: ["infrastructure", "sessions"] },
  toolPolicy: {
    allowedTools: ["read", "plan", "write", "edit", "multi_edit", "apply_patch", "bash"],
    allowedCapabilities: ["read", "write", "execute"],
    allowedCommands: ["bun test"],
  },
  async setup(seed, root) {
    const base = seededToken(seed, "BASE");
    const middle = seededToken(seed, "MIDDLE");
    const final = seededToken(seed, "FINAL");
    const outputs = {
      [OUTPUT_PATHS[0]!]: `${base}\n`,
      [OUTPUT_PATHS[1]!]: `${base}:${middle}\n`,
      [OUTPUT_PATHS[2]!]: `${base}:${middle}:${final}\n`,
    };
    const planSteps = [
      `${seededToken(seed, "STEP_ONE")}: Create generated/stage-one.txt`,
      `${seededToken(seed, "STEP_TWO")}: Create generated/stage-two.txt from stage one`,
      `${seededToken(seed, "STEP_THREE")}: Create generated/stage-three.txt from stage two`,
      `${seededToken(seed, "STEP_VERIFY")}: Verify the completed pipeline`,
    ];
    await writeFixture(root, {
      ".git/.keep": "fixture boundary\n",
      "AGENTS.md":
        "Implement the generated stages strictly in numeric order. Each later stage must extend the exact prior stage. Keep a visible plan current and verify with exactly `bun test`.\n",
      "package.json": `${JSON.stringify({ scripts: { test: "bun test test/pipeline.test.ts" } }, null, 2)}\n`,
      "inputs/base.txt": `${base}\n`,
      "inputs/suffixes.txt": `${middle}\n${final}\n`,
      "test/pipeline.test.ts": [
        'import { expect, test } from "bun:test";',
        'const base = (await Bun.file("inputs/base.txt").text()).trimEnd();',
        'const [middle, final] = (await Bun.file("inputs/suffixes.txt").text()).trimEnd().split("\\n");',
        "const expected = {",
        '  "generated/stage-one.txt": base + "\\n",',
        '  "generated/stage-two.txt": base + ":" + middle + "\\n",',
        '  "generated/stage-three.txt": base + ":" + middle + ":" + final + "\\n",',
        "};",
        "for (const [path, value] of Object.entries(expected))",
        "  test(path, async () => expect(await Bun.file(path).text()).toBe(value));",
        "",
      ].join("\n"),
    });
    return {
      root,
      seed,
      base,
      middle,
      final,
      outputs,
      outputHashes: Object.fromEntries(Object.entries(outputs).map(([path, value]) => [path, sha256Text(value)])),
      planSteps,
      expected: outputs[OUTPUT_PATHS[2]!]!,
      protectedPaths: [
        ".git/.keep",
        "AGENTS.md",
        "package.json",
        "inputs/base.txt",
        "inputs/suffixes.txt",
        "test/pipeline.test.ts",
      ],
      allowedChanges: OUTPUT_PATHS,
    };
  },
  createRuntimeConfig: createIsolatedFixtureRuntimeConfig,
  createSteps: () => [
    {
      kind: "turn",
      mode: "execute",
      message:
        "Implement the three-stage generated-file pipeline described by the project. Use the read tool for inputs/base.txt and inputs/suffixes.txt, then create only generated/stage-one.txt, generated/stage-two.txt, and generated/stage-three.txt directly in numeric dependency order. Do not add scripts or configuration files. The only permitted shell command is exactly bun test. Keep a visible plan current and finish only after verification succeeds.",
    },
  ],
  verify: (world, signal) => runVerifier(world, ["bun", "test"], signal),
  snapshotWorld: async (world) => ({
    outputs: Object.fromEntries(
      await Promise.all(OUTPUT_PATHS.map(async (path) => [path, await exactFile(world.root, path)])),
    ),
  }),
  evaluate(input) {
    const grade = new RuntimeGrade("plan_progress");
    if (input.verifier?.timedOut)
      return grade.fail("verifier_timeout", "Independent pipeline verification timed out.", "harness_terminal");
    if (input.verifier?.exitCode !== 0)
      return grade.fail("verifier", "Independent pipeline verification failed.", "semantic_goal");
    for (const path of OUTPUT_PATHS) {
      if (input.workspace.final.entries.find((entry) => entry.path === path)?.sha256 !== input.world.outputHashes[path])
        return grade.fail("output", `The exact output content was wrong for ${path}.`, "semantic_goal");
    }
    const planCalls = input.toolCalls
      .filter((call) => call.name === "plan" && call.outcome === "success")
      .sort((left, right) => left.sequence - right.sequence);
    if (planCalls.length < 2)
      return grade.fail("plan_updates", "Expected a plan before work and a final completed plan.", "behavior");
    const payloads = planCalls.map(planPayload);
    if (payloads.some((payload) => !payload || !validInProgressState(payload)))
      return grade.fail(
        "in_progress",
        "Every unresolved plan payload must have exactly one in-progress step.",
        "behavior",
      );
    const writes = input.toolCalls
      .filter((call) => call.capability === "write" && call.outcome === "success")
      .sort((left, right) => left.sequence - right.sequence);
    const firstWrite = writes[0];
    if (!firstWrite || planCalls[0]!.sequence >= firstWrite.sequence)
      return grade.fail("plan_before_mutation", "A successful plan must precede the first mutating call.", "behavior");
    for (const path of ["inputs/base.txt", "inputs/suffixes.txt"]) {
      const reads = successfulReadsOf(input, path);
      if (reads.length === 0) grade.note("input_discovery", `${path} was never read successfully.`, { impact: "info" });
      else if (reads[0]!.sequence > firstWrite.sequence)
        grade.note("input_discovery", `${path} was first read after the first write.`, { impact: "info" });
    }
    const firstWrites = OUTPUT_PATHS.map((path) => successfulWritesTo(input, path)[0]);
    for (let index = 1; index < firstWrites.length; index++) {
      const previous = firstWrites[index - 1];
      const current = firstWrites[index];
      if (!previous || !current) continue;
      if (current.sequence < previous.sequence)
        return grade.fail("write_order", "The generated files were not created in dependency order.", "behavior");
      if (current.sequence === previous.sequence)
        grade.note("write_order", "Several generated stages were created by one write call.", { impact: "info" });
    }
    const lastWriteSequence = writes.at(-1)!.sequence;
    const testCall = passingCommandRuns(input, "bun test").findLast((call) => call.sequence > lastWriteSequence);
    if (!testCall) return grade.fail("verify_progress", "No passing `bun test` followed the final write.", "behavior");
    if (planCalls.at(-1)!.sequence <= testCall.sequence || !isResolved(payloads.at(-1)!))
      return grade.fail("incomplete", "A fully resolved plan must follow the passing verification.", "behavior");
    if (planCalls.some((call, index) => call.sequence < testCall.sequence && isResolved(payloads[index]!)))
      return grade.fail("premature_completion", "The plan was marked complete before final verification.", "behavior");
    return grade.pass();
  },
};

interface ParsedPlan {
  steps: Array<{ text: string; status: string }>;
}

function planPayload(call: RuntimeToolTrace): ParsedPlan | undefined {
  if (!isRecord(call.input) || !Array.isArray(call.input.steps)) return undefined;
  const steps: ParsedPlan["steps"] = [];
  for (const raw of call.input.steps) {
    if (!isRecord(raw) || typeof raw.text !== "string" || typeof raw.status !== "string") return undefined;
    steps.push({ text: raw.text, status: raw.status });
  }
  return { steps };
}

function validInProgressState(payload: ParsedPlan): boolean {
  if (
    payload.steps.length === 0 ||
    payload.steps.some((step) => !["pending", "in_progress", "done", "cancelled"].includes(step.status))
  )
    return false;
  const unresolved = payload.steps.filter((step) => step.status === "pending" || step.status === "in_progress");
  const inProgress = payload.steps.filter((step) => step.status === "in_progress");
  return inProgress.length <= 1 && (unresolved.length === 0 || inProgress.length === 1);
}

function isResolved(payload: ParsedPlan): boolean {
  return payload.steps.length > 0 && payload.steps.every((step) => ["done", "cancelled"].includes(step.status));
}
