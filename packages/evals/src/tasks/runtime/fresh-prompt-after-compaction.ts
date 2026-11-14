// @summary Runtime eval for preserving a fresh second-turn request across automatic compaction

import type { RuntimeConfig } from "@diligent/runtime";
import type { RuntimeEvalTask } from "../../runtime-task";
import type { EvalProfile } from "../../task";
import { compactionEndCount, RuntimeGrade } from "./grading";
import {
  createFixtureRuntimeConfig,
  DEFAULT_RUNTIME_LIMITS,
  exactFile,
  type RuntimeFixtureWorld,
  seededToken,
  sha256Text,
  verifyExactFiles,
  writeFixture,
} from "./helpers";

const TARGET_PATH = "FRESH.txt";
const CONTROL_PATH = "control.txt";
const LARGE_PRIOR_CONTEXT = `Prior context for compaction only. ${"archive detail ".repeat(24_000)}`;

export interface FreshPromptAfterCompactionWorld extends RuntimeFixtureWorld {
  freshValue: string;
  expectedHash: string;
  controlHash: string;
}

export const freshPromptAfterCompactionTask: RuntimeEvalTask<FreshPromptAfterCompactionWorld> = {
  id: "fresh-prompt-after-compaction",
  description: "Apply an opaque second-turn request that arrives exactly when prior context is compacted.",
  fixtureVersion: "fresh-prompt-after-compaction-v1",
  limits: {
    ...DEFAULT_RUNTIME_LIMITS,
    maxTurns: 6,
    maxToolCalls: 2,
    maxChangedFiles: 1,
    maxChangedBytes: 4_096,
    timeoutMs: 300_000,
  },
  statePolicy: { allowedMutations: ["infrastructure", "sessions"] },
  toolPolicy: {
    allowedTools: ["apply_patch", "edit", "write"],
    allowedCapabilities: ["write"],
    allowedCommands: [],
  },
  async setup(seed, root) {
    const freshValue = seededToken(seed, "FRESH_REQUIREMENT");
    const expected = `${freshValue}\n`;
    const control = "protected control\n";
    await writeFixture(root, { [CONTROL_PATH]: control });
    return {
      root,
      seed,
      freshValue,
      expected,
      expectedHash: sha256Text(expected),
      controlHash: sha256Text(control),
      protectedPaths: [CONTROL_PATH],
      allowedChanges: [TARGET_PATH],
    };
  },
  createRuntimeConfig: createCompactingConfig,
  createSteps: (world) => [
    {
      kind: "turn",
      mode: "default",
      message: `${LARGE_PRIOR_CONTEXT}\nAcknowledge this archival context with only ACK. Do not create or change files.`,
    },
    {
      kind: "turn",
      mode: "default",
      message:
        `Create ${TARGET_PATH} containing only ${world.freshValue} and one trailing newline. ` +
        "This new requirement supersedes any prior archival context.",
    },
  ],
  verify: (world, signal) => verifyExactFiles(world, { [TARGET_PATH]: world.expected }, signal),
  snapshotWorld: async (world) => ({ artifact: await exactFile(world.root, TARGET_PATH) }),
  evaluate(input) {
    const grade = new RuntimeGrade("fresh_prompt");
    const archivalTurn = input.turns[0]?.index ?? 0;
    const archivalWrites = input.toolCalls.filter(
      (call) => call.capability === "write" && call.turnIndex === archivalTurn,
    );
    if (archivalWrites.some((call) => call.outcome === "success"))
      return grade.fail("early_mutation", "The archival turn mutated the workspace.", "runtime_policy");
    if (input.verifier?.timedOut)
      return grade.fail("verifier_timeout", "Fresh-request verification timed out.", "harness_terminal");
    if (input.verifier?.exitCode !== 0)
      return grade.fail("artifact", "The fresh post-compaction requirement was not applied.", "semantic_goal");
    const artifact = input.workspace.final.entries.find((entry) => entry.path === TARGET_PATH);
    const control = input.workspace.final.entries.find((entry) => entry.path === CONTROL_PATH);
    if (artifact?.sha256 !== input.world.expectedHash)
      return grade.fail("artifact_bytes", "The fresh requirement was not preserved exactly.", "format_contract");
    if (control?.sha256 !== input.world.controlHash)
      return grade.fail("protected_state", "Protected state changed.", "runtime_policy");
    const compactionsByTurn = input.turns.map(compactionEndCount);
    if (compactionsByTurn.every((count) => count === 0))
      return grade.fail("compaction_missing", "No automatic compaction completed in any turn.", "behavior");

    if (archivalWrites.length > 0)
      grade.note("archival_write_attempt", "The archival turn attempted a write that did not take effect.");
    if ((compactionsByTurn[1] ?? 0) === 0)
      grade.note(
        "compaction_not_observed",
        "Compaction completed before the fresh request rather than while it was being applied.",
        { impact: "info" },
      );
    const failed = input.toolCalls.filter((call) => call.outcome !== "success");
    if (failed.length > 0)
      grade.note("tool_recovery", `Recovered from ${failed.length} failed or rejected tool call(s).`);
    return grade.pass();
  },
};

async function createCompactingConfig(
  world: FreshPromptAfterCompactionWorld,
  profile: EvalProfile,
): Promise<RuntimeConfig> {
  const config = await createFixtureRuntimeConfig(world, profile);
  return { ...config, compaction: { enabled: true, reservePercent: 99.95, timeoutMs: 60_000 } };
}
