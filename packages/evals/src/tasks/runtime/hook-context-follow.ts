// @summary Runtime eval for synchronous UserPromptSubmit context injection and exact model behavior

import type { BundledToolProvider, PluginHookFn } from "@diligent/runtime";
import type { RuntimeEvalTask } from "../../runtime-task";
import { RuntimeGrade, successfulWritesTo } from "./grading";
import {
  createIsolatedFixtureRuntimeConfig,
  DEFAULT_RUNTIME_LIMITS,
  exactFile,
  type RuntimeFixtureWorld,
  seededToken,
  sha256Text,
  verifyExactFiles,
  writeFixture,
} from "./helpers";

export interface HookContextFollowWorld extends RuntimeFixtureWorld {
  hookFact: string;
  injectedContext: string;
  clientPrompt: string;
  expectedHash: string;
}

const OUTPUT_PATH = "HOOK.txt";

export const hookContextFollowTask: RuntimeEvalTask<HookContextFollowWorld> = {
  id: "hook-context-follow",
  description: "Follow a seeded fact injected by a fixture-owned synchronous UserPromptSubmit hook.",
  fixtureVersion: "hook-context-follow-v3",
  limits: { ...DEFAULT_RUNTIME_LIMITS, maxTurns: 4, maxToolCalls: 2, timeoutMs: 180_000 },
  statePolicy: { allowedMutations: ["infrastructure", "sessions"] },
  toolPolicy: {
    allowedTools: ["write", "edit", "multi_edit", "apply_patch"],
    allowedCapabilities: ["write"],
    allowedCommands: [],
  },
  async setup(seed, root) {
    const hookFact = seededToken(seed, "HOOK_FACT");
    const injectedContext =
      `[Runtime-provided deployment context]\n` +
      `A configured UserPromptSubmit hook resolved the required content for HOOK.txt to exactly ` +
      `READY:${hookFact} followed by one newline. This context is part of the current deployment request.`;
    const clientPrompt =
      "Create HOOK.txt using the runtime-provided deployment context above. " +
      "Preserve the resolved content exactly, including its single trailing newline.";
    const expected = `READY:${hookFact}\n`;
    await writeFixture(root, { ".git/.keep": "fixture boundary\n" });
    return {
      root,
      seed,
      hookFact,
      injectedContext,
      clientPrompt,
      expected,
      expectedHash: sha256Text(expected),
      protectedPaths: [".git/.keep"],
      allowedChanges: [OUTPUT_PATH],
    };
  },
  createRuntimeConfig: createIsolatedFixtureRuntimeConfig,
  createBundledToolProviders(world): readonly BundledToolProvider[] {
    const hook: PluginHookFn = async () => ({ blocked: false, additionalContext: world.injectedContext });
    hook.mode = "sync";
    return [{ id: "eval-user-prompt-hook", createTools: () => [], onUserPromptSubmit: hook }];
  },
  createSteps: (world) => [{ kind: "turn", mode: "execute", message: world.clientPrompt }],
  verify: (world, signal) => verifyExactFiles(world, { [OUTPUT_PATH]: world.expected }, signal),
  snapshotWorld: async (world) => ({ result: await exactFile(world.root, OUTPUT_PATH) }),
  evaluate(input) {
    const grade = new RuntimeGrade("hook_context_follow");
    if (input.verifier?.timedOut)
      return grade.fail("verifier_timeout", "Independent exact-file verification timed out.", "harness_terminal");
    if (input.verifier?.exitCode !== 0)
      return grade.fail("verifier", "Independent exact-file verification failed.", "format_contract");
    const output = input.workspace.final.entries.find((entry) => entry.path === OUTPUT_PATH);
    if (output?.sha256 !== input.world.expectedHash)
      return grade.fail(
        "output",
        "HOOK.txt did not combine the user request with the injected constraint.",
        "format_contract",
      );
    const failedWrites = input.toolCalls.filter((call) => call.capability === "write" && call.outcome !== "success");
    if (failedWrites.length > 0)
      grade.note("write_recovery", `Observed ${failedWrites.length} failed write attempt(s) before completion.`);
    if (successfulWritesTo(input, OUTPUT_PATH).length > 1)
      grade.note("repeated_write", "HOOK.txt was written more than once.");
    const otherCalls = input.toolCalls.filter((call) => call.capability !== "write");
    if (otherCalls.length > 0)
      grade.note(
        "non_write_call",
        `Observed ${otherCalls.length} non-write tool call(s), such as verification reads.`,
        {
          impact: "info",
        },
      );
    return grade.pass();
  },
};
