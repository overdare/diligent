// @summary Runtime eval fixture for persisted multi-turn session restart and resume

import type { RuntimeEvalTask } from "../../runtime-task";
import { RuntimeGrade, successfulWritesTo } from "./grading";
import {
  createFixtureRuntimeConfig,
  DEFAULT_RUNTIME_LIMITS,
  exactFile,
  type RuntimeFixtureWorld,
  seededToken,
  sha256Text,
} from "./helpers";

const TARGET_PATH = "CODENAME.txt";

export interface SessionResumeWorld extends RuntimeFixtureWorld {
  codename: string;
  expectedHash: string;
}
export const sessionResumeTask: RuntimeEvalTask<SessionResumeWorld> = {
  id: "session-resume",
  description: "Resume a persisted session and use earlier context in a file mutation.",
  fixtureVersion: "session-resume-v0",
  limits: { ...DEFAULT_RUNTIME_LIMITS, maxTurns: 10, maxToolCalls: 8, timeoutMs: 300_000 },
  statePolicy: { allowedMutations: ["infrastructure", "sessions"] },
  toolPolicy: {
    allowedTools: ["write", "edit", "multi_edit", "apply_patch"],
    allowedCapabilities: ["write"],
    allowedCommands: [],
  },
  async setup(seed, root) {
    const codename = seededToken(seed, "CODENAME");
    return {
      root,
      seed,
      codename,
      expected: `${codename}\n`,
      expectedHash: sha256Text(`${codename}\n`),
      protectedPaths: [],
      allowedChanges: [TARGET_PATH],
    };
  },
  createRuntimeConfig: createFixtureRuntimeConfig,
  createSteps: (world) => [
    { kind: "turn", message: `Remember project codename ${world.codename}. Reply only ACK.` },
    { kind: "restart_and_resume" },
    {
      kind: "turn",
      message:
        "Create CODENAME.txt containing the earlier codename and one trailing newline. Do not repeat it in your response.",
    },
  ],
  snapshotWorld: async (world) => ({ codename: world.codename, result: await exactFile(world.root, TARGET_PATH) }),
  evaluate(input) {
    const grade = new RuntimeGrade("session_resume");
    const result = input.workspace.final.entries.find((entry) => entry.path === TARGET_PATH);
    if (result?.sha256 === sha256Text(input.world.codename))
      return grade.fail(
        "wrong_codename",
        "CODENAME.txt omitted the prompt-declared trailing newline.",
        "format_contract",
      );
    if (result?.sha256 !== input.world.expectedHash)
      return grade.fail("wrong_codename", "CODENAME.txt does not contain the exact earlier codename.", "semantic_goal");
    const resumedTurn = input.turns.at(-1)?.index;
    const writes = successfulWritesTo(input, TARGET_PATH);
    if (!writes.some((call) => call.turnIndex === resumedTurn))
      return grade.fail(
        "no_resumed_write",
        "CODENAME.txt was not written in the resumed turn, so the restored context was not exercised.",
        "behavior",
      );
    if (writes.some((call) => call.turnIndex !== resumedTurn))
      grade.note("pre_resume_write", "CODENAME.txt was also written before the restart.");
    const failed = input.toolCalls.filter((call) => call.outcome !== "success");
    if (failed.length > 0)
      grade.note("tool_recovery", `Recovered from ${failed.length} failed or rejected tool call(s).`);
    return grade.pass();
  },
};
