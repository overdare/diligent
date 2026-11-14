// @summary Runtime eval for manual compaction, restart, and exact context continuation

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { COMPACTION_MIN_INPUT_TOKENS } from "@diligent/core/compaction-contract";
import type { RuntimeEvalTask, RuntimeVerifierResult } from "../../runtime-task";
import type { EvalProfile } from "../../task";
import { isRecord } from "../core/helpers";
import { RuntimeGrade, successfulWritesTo } from "./grading";
import {
  createFixtureRuntimeConfig,
  DEFAULT_RUNTIME_LIMITS,
  exactFile,
  type RuntimeFixtureWorld,
  seededToken,
  sha256Text,
} from "./helpers";

const CONTEXT_PATH = "CONTEXT.json";

export interface ManualCompactionResumeWorld extends RuntimeFixtureWorld {
  alpha: string;
  beta: string;
  expectedHash: string;
}

export const manualCompactionResumeTask: RuntimeEvalTask<ManualCompactionResumeWorld> = {
  id: "manual-compaction-resume",
  description: "Compact a session, restart the server, and continue from the compacted facts.",
  fixtureVersion: "manual-compaction-resume-v1",
  limits: { ...DEFAULT_RUNTIME_LIMITS, maxTurns: 12, maxToolCalls: 8, timeoutMs: 360_000 },
  statePolicy: { allowedMutations: ["infrastructure", "sessions"] },
  toolPolicy: {
    allowedTools: ["write", "edit", "multi_edit", "apply_patch"],
    allowedCapabilities: ["write"],
    allowedCommands: [],
  },
  async setup(seed, root) {
    const alpha = seededToken(seed, "ALPHA");
    const beta = seededToken(seed, "BETA");
    const expected = `${JSON.stringify({ alpha, beta })}\n`;
    return {
      root,
      seed,
      alpha,
      beta,
      expected,
      expectedHash: sha256Text(expected),
      protectedPaths: [],
      allowedChanges: [CONTEXT_PATH],
    };
  },
  createRuntimeConfig: createCompactionRuntimeConfig,
  createSteps: (world) => [
    {
      kind: "turn",
      message: [
        `Remember these two exact project facts for work after context compaction: alpha=${world.alpha}; beta=${world.beta}.`,
        "The following deterministic filler makes this session eligible for manual compaction; it carries no additional facts:",
        eligibleCompactionPadding(),
        "Reply only ACK.",
      ].join("\n"),
    },
    { kind: "compact" },
    { kind: "restart_and_resume" },
    {
      kind: "turn",
      message:
        "Create CONTEXT.json as one valid JSON object with exactly the keys alpha and beta containing the two exact facts from before compaction, followed by exactly one newline. JSON whitespace and key order are not constrained. Do not repeat the values in your response.",
    },
  ],
  verify: verifyContextJson,
  snapshotWorld: async (world) => ({
    alpha: world.alpha,
    beta: world.beta,
    result: await exactFile(world.root, CONTEXT_PATH),
  }),
  evaluate(input) {
    const grade = new RuntimeGrade("manual_compaction");
    if (!input.compactions.some((compaction) => compaction.response.compacted))
      return grade.fail("not_compacted", "The manual compaction step did not compact the session.", "behavior");
    if (input.verifier?.timedOut)
      return grade.fail("wrong_context", "The independent semantic JSON verifier timed out.", "harness_terminal");
    const result = input.workspace.final.entries.find((entry) => entry.path === CONTEXT_PATH);
    if (result?.kind !== "file" || input.verifier?.exitCode !== 0)
      return grade.fail(
        "wrong_context",
        "CONTEXT.json did not contain the exact pre-compaction facts and declared envelope.",
        input.verifier?.stderr.startsWith("format_contract:") ? "format_contract" : "semantic_goal",
      );
    const continuationTurn = input.turns.at(-1)?.index;
    const writes = successfulWritesTo(input, CONTEXT_PATH);
    if (!writes.some((call) => call.turnIndex === continuationTurn))
      return grade.fail(
        "no_write",
        "CONTEXT.json was not written after compaction and resume, so the compacted facts were not exercised.",
        "behavior",
      );
    if (writes.some((call) => call.turnIndex !== continuationTurn))
      grade.note("pre_compaction_write", "CONTEXT.json was also written before compaction.");
    const failed = input.toolCalls.filter((call) => call.outcome !== "success");
    if (failed.length > 0)
      grade.note("tool_recovery", `Recovered from ${failed.length} failed or rejected tool call(s).`);
    return grade.pass();
  },
};

function eligibleCompactionPadding(): string {
  const unit = "eligible-manual-compaction-padding ";
  return unit.repeat(Math.ceil((COMPACTION_MIN_INPUT_TOKENS * 4) / unit.length) + 1);
}

async function verifyContextJson(world: ManualCompactionResumeWorld): Promise<RuntimeVerifierResult> {
  const started = performance.now();
  let valid = false;
  let stdout = "";
  let stderr = "";
  try {
    const text = await readFile(join(world.root, CONTEXT_PATH), "utf8");
    const body = text.endsWith("\n") ? text.slice(0, -1) : text;
    const parsed: unknown = JSON.parse(body);
    const semanticValid =
      isRecord(parsed) &&
      Object.keys(parsed).sort().join(",") === "alpha,beta" &&
      parsed.alpha === world.alpha &&
      parsed.beta === world.beta;
    const formatValid = text.endsWith("\n") && !text.endsWith("\n\n") && body.trimEnd() === body;
    valid = semanticValid && formatValid;
    stdout = valid ? "semantic JSON matched" : "semantic JSON mismatch";
    if (!valid)
      stderr = semanticValid
        ? "format_contract: CONTEXT.json violated the declared final-newline envelope."
        : "semantic_goal: CONTEXT.json did not preserve the exact compacted facts.";
  } catch (error) {
    stderr = error instanceof Error ? error.message : String(error);
  }
  return {
    argv: ["semantic-json", CONTEXT_PATH],
    exitCode: valid ? 0 : 1,
    elapsedMs: Math.round(performance.now() - started),
    stdout,
    stderr,
    timedOut: false,
  };
}

async function createCompactionRuntimeConfig(world: ManualCompactionResumeWorld, profile: EvalProfile) {
  const config = await createFixtureRuntimeConfig(world, profile);
  return {
    ...config,
    compaction: { enabled: true, reservePercent: 16, timeoutMs: 180_000 },
  };
}
