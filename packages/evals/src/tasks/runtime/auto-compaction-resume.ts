// @summary Runtime eval for exact continuation after automatic in-turn context compaction

import { COMPACTION_MIN_INPUT_TOKENS } from "@diligent/core/compaction-contract";
import type { BundledToolProvider, RuntimeConfig } from "@diligent/runtime";
import { z } from "zod";
import type { RuntimeEvalExecution, RuntimeEvalTask } from "../../runtime-task";
import type { EvalProfile } from "../../task";
import { compactionEndCount, RuntimeGrade, successfulWritesTo } from "./grading";
import {
  createFixtureRuntimeConfig,
  DEFAULT_RUNTIME_LIMITS,
  exactFile,
  type RuntimeFixtureWorld,
  seededToken,
  sha256Text,
  writeFixture,
} from "./helpers";

const TARGET_PATH = "COMPACTED.txt";
const CONTROL_PATH = "control.txt";
const INFLATE_TOOL = "inflate_context";
const INFLATE_MARKER = "AUTO_COMPACTION_INFLATE_RESULT";
const INFLATE_OUTPUT = `${INFLATE_MARKER}\n${"x".repeat(COMPACTION_MIN_INPUT_TOKENS * 4)}`;
const INFLATE_MAX_OUTPUT_BYTES = Buffer.byteLength(INFLATE_OUTPUT) + 1_024;
const RESERVE_PERCENT = 99.95;

export interface AutoCompactionResumeWorld extends RuntimeFixtureWorld {
  facts: string[];
  targetPath: string;
  expectedHash: string;
  controlHash: string;
  summaryBody: string;
}

export const autoCompactionResumeTask: RuntimeEvalTask<AutoCompactionResumeWorld> = {
  id: "auto-compaction-resume",
  description: "Continue one outer turn after automatic compaction and reconstruct three exact seeded facts.",
  fixtureVersion: "auto-compaction-resume-v2",
  limits: {
    ...DEFAULT_RUNTIME_LIMITS,
    maxTurns: 5,
    maxToolCalls: 4,
    maxChangedFiles: 1,
    maxChangedBytes: 4_096,
    timeoutMs: 180_000,
  },
  statePolicy: { allowedMutations: ["infrastructure", "sessions"] },
  toolPolicy: {
    allowedTools: [INFLATE_TOOL, "apply_patch", "edit"],
    allowedCapabilities: ["execute", "write"],
    allowedCommands: [],
  },
  async setup(seed, root) {
    const facts = [seededToken(seed, "ORBIT"), seededToken(seed, "CIPHER"), seededToken(seed, "ANCHOR")];
    const expected = renderArtifact(facts);
    const control = `${seededToken(seed, "CONTROL")}\n`;
    const summaryBody = [
      "## Goal",
      `Create ${TARGET_PATH} after automatic context compaction.`,
      "",
      "## Critical Context",
      `ORBIT=${facts[0]}`,
      `CIPHER=${facts[1]}`,
      `ANCHOR=${facts[2]}`,
      `The inflate tool already completed. Next, write ${TARGET_PATH} with exactly those three lines.`,
    ].join("\n");
    await writeFixture(root, { [CONTROL_PATH]: control });
    return {
      root,
      seed,
      facts,
      targetPath: TARGET_PATH,
      expected,
      expectedHash: sha256Text(expected),
      controlHash: sha256Text(control),
      summaryBody,
      protectedPaths: [CONTROL_PATH],
      allowedChanges: [TARGET_PATH],
    };
  },
  createRuntimeConfig: createAutoCompactionRuntimeConfig,
  createBundledToolProviders: () => [inflateProvider()],
  createSteps: (world) => [
    {
      kind: "turn",
      message: [
        `Preserve these opaque project facts exactly: ORBIT=${world.facts[0]}; CIPHER=${world.facts[1]}; ANCHOR=${world.facts[2]}.`,
        `First use the context inflation capability exactly once to complete bounded preparatory work. Then create ${world.targetPath} with exactly three lines in the same declared order and one trailing newline. Each line must use LABEL=value format.`,
        "After the file is created, reply exactly Done.",
      ].join(" "),
    },
  ],
  async verify(world, signal) {
    const started = performance.now();
    const actual = await exactFile(world.root, world.targetPath);
    const valid = !signal.aborted && actual === world.expected;
    const factsPresent = actual !== undefined && world.facts.every((fact) => actual.includes(fact));
    return {
      argv: ["auto-compaction-resume-verifier", world.targetPath],
      exitCode: valid ? 0 : 1,
      elapsedMs: Math.round(performance.now() - started),
      stdout: valid ? `Exact compacted-context artifact verified: ${world.expectedHash}\n` : "",
      stderr: valid
        ? ""
        : factsPresent
          ? "format_contract: Artifact kept every seeded fact but violated the declared line envelope.\n"
          : "semantic_goal: Artifact bytes did not reconstruct all seeded compacted facts.\n",
      timedOut: signal.aborted,
    };
  },
  snapshotWorld: async (world) => ({ artifact: await exactFile(world.root, world.targetPath) }),
  evaluate(input) {
    const grade = new RuntimeGrade("auto_compaction_resume");
    if (input.compactions.length !== 0)
      return grade.fail(
        "manual_compaction",
        "Runner-owned manual compaction evidence must be empty.",
        "runtime_policy",
      );
    const turn = input.turns[0];
    const automaticCompactions = turn ? compactionEndCount(turn) : 0;
    if (automaticCompactions === 0)
      return grade.fail("compaction_missing", "No automatic compaction completed during the turn.", "behavior");
    const inflates = input.toolCalls.filter((call) => call.name === INFLATE_TOOL && call.outcome === "success");
    if (inflates.length === 0)
      return grade.fail("inflate", "The context-inflation capability never completed successfully.", "behavior");

    if (input.verifier?.timedOut)
      return grade.fail("verifier_timeout", "Independent exact-byte verification timed out.", "harness_terminal");
    const finalTarget = input.workspace.final.entries.find((entry) => entry.path === input.world.targetPath);
    if (!finalTarget)
      return grade.fail("artifact_missing", "The required reconstructed artifact is missing.", "semantic_goal");
    if (input.verifier?.exitCode !== 0)
      return grade.fail(
        "verifier",
        "Independent exact-byte verification failed.",
        input.verifier?.stderr.startsWith("format_contract:") ? "format_contract" : "semantic_goal",
      );
    if (finalTarget.sha256 !== input.world.expectedHash || finalTarget.size !== Buffer.byteLength(input.world.expected))
      return grade.fail("artifact_bytes", "Final artifact bytes, size, or hash were incorrect.", "format_contract");
    const finalControl = input.workspace.final.entries.find((entry) => entry.path === CONTROL_PATH);
    if (finalControl?.sha256 !== input.world.controlHash)
      return grade.fail("protected_state", "The protected control fixture changed.", "runtime_policy");
    if (hasUndeclaredProjectEntry(input))
      return grade.fail("undeclared_mutation", "An undeclared project mutation was present.", "runtime_policy");

    const firstInflate = inflates[0]!.sequence;
    const writes = successfulWritesTo(input, input.world.targetPath);
    if (writes.length === 0)
      return grade.fail("write", "No traced write produced the reconstructed artifact.", "behavior");
    if (!writes.some((call) => call.sequence > firstInflate))
      return grade.fail("tool_order", "The artifact was written only before context inflation completed.", "behavior");

    if (writes.some((call) => call.sequence < firstInflate))
      grade.note("pre_inflate_write", "The artifact was also written before context inflation.");
    if (inflates.length > 1)
      grade.note("repeated_inflate", `Context inflation ran ${inflates.length} times; the prompt asked for once.`);
    const failed = input.toolCalls.filter((call) => call.outcome !== "success");
    if (failed.length > 0)
      grade.note("tool_recovery", `Recovered from ${failed.length} failed or rejected tool call(s).`);
    if (input.providerCalls.length > 4)
      grade.note(
        "provider_call_variation",
        `Observed ${input.providerCalls.length} provider calls; bounded variation did not affect correctness.`,
      );
    if (automaticCompactions > 1)
      grade.note("additional_compaction", `Observed ${automaticCompactions} automatic compactions.`, {
        impact: "info",
      });
    return grade.pass();
  },
};

async function createAutoCompactionRuntimeConfig(
  world: AutoCompactionResumeWorld,
  profile: EvalProfile,
): Promise<RuntimeConfig> {
  const config = await createFixtureRuntimeConfig(world, profile);
  return {
    ...config,
    compaction: {
      enabled: true,
      reservePercent: RESERVE_PERCENT,
      timeoutMs: 30_000,
    },
  };
}

function inflateProvider(): BundledToolProvider {
  return {
    id: "eval-auto-compaction-inflate-provider",
    createTools: () => [
      {
        name: INFLATE_TOOL,
        description: "Perform deterministic bounded preparatory work that expands the current context.",
        parameters: z.object({}).strict(),
        execute: async () => ({ output: INFLATE_OUTPUT, maxOutputBytes: INFLATE_MAX_OUTPUT_BYTES }),
      },
    ],
  };
}

function hasUndeclaredProjectEntry(input: RuntimeEvalExecution<AutoCompactionResumeWorld>): boolean {
  const allowed = new Set([CONTROL_PATH, input.world.targetPath]);
  return input.workspace.final.entries.some(
    (entry) =>
      entry.kind !== "directory" &&
      entry.path !== ".diligent" &&
      !entry.path.startsWith(".diligent/") &&
      !allowed.has(entry.path),
  );
}

function renderArtifact(facts: string[]): string {
  return `ORBIT=${facts[0]}\nCIPHER=${facts[1]}\nANCHOR=${facts[2]}\n`;
}
