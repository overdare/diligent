// @summary Outcome, adaptation, and code-mode-independence coverage for loop-context-adaptation

import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StreamContext, StreamFunction } from "@diligent/core/provider-contract";
import { DEFAULT_PROFILES } from "../../../src/profiles";
import { runRuntimeEvalExecution } from "../../../src/runner/runtime-execution";
import { removeTemporaryRoot } from "../../../src/runner/runtime-workspace";
import type { RuntimeEvalExecution, RuntimeToolTrace } from "../../../src/runtime-task";
import type { EvalProfile } from "../../../src/task";
import { writeFixture } from "../../../src/tasks/runtime/helpers";
import {
  type LoopContextAdaptationWorld,
  loopContextAdaptationTask,
} from "../../../src/tasks/runtime/loop-context-adaptation";
import { assistantMessage, sequenceStream } from "../../helpers/fake-stream";

const SEED = "shared-seed-123";

describe("loop-context-adaptation", () => {
  test("defines a deterministic fixture whose prompt hides both lanes", async () => {
    const root = await mkdtemp(join(tmpdir(), "diligent-runtime-loop-context-"));
    try {
      const world = await loopContextAdaptationTask.setup(SEED, root);
      expect(await loopContextAdaptationTask.setup(SEED, root)).toEqual(world);
      expect(world.initialValue).not.toBe(world.injectedValue);
      expect(world.initialBrief).toContain(world.initialValue);
      expect(world.injectedContext).toContain(world.injectedValue);
      expect(world.clientPrompt).not.toContain(world.initialValue);
      expect(world.clientPrompt).not.toContain(world.injectedValue);
    } finally {
      await removeTemporaryRoot(root);
    }
  });

  test("arms the injection only after a successful brief read that revealed the initial lane, then injects once", async () => {
    const root = await mkdtemp(join(tmpdir(), "diligent-runtime-loop-hook-"));
    try {
      const world = await loopContextAdaptationTask.setup(SEED, root);
      const [provider] = await loopContextAdaptationTask.createBundledToolProviders!(world);
      const [hook] = provider!.createAgentLoopHooks!({
        cwd: root,
        agentKind: "main",
        model: {} as never,
        tools: [{ name: "read" }] as never,
        logger: {} as never,
      });
      const before = (turnId: string) => hook!.beforeTurn!({ messages: [], turnId, compactedThisTurn: false });
      const observe = (trace: Partial<RuntimeToolTrace>) =>
        loopContextAdaptationTask.observeToolTrace!(world, {
          sequence: 1,
          toolCallId: "call",
          name: "read",
          capability: "read",
          input: { file_path: "$WORKSPACE/deployment-brief.txt" },
          outcome: "success",
          output: { output: world.initialBrief },
          ...trace,
        });

      observe({ input: { file_path: "$WORKSPACE/other.txt" } });
      observe({ outcome: "runtime_error" });
      expect(before("turn-1")).toBeUndefined();

      observe({ sequence: 3, input: { file_path: "deployment-brief.txt" } });
      expect(before("turn-2")).toEqual([expect.objectContaining({ content: world.injectedContext })]);
      expect(before("turn-3")).toBeUndefined();
      expect(world.briefReadSequence).toBe(3);
    } finally {
      await removeTemporaryRoot(root);
    }
  });

  test("independent verifier accepts only exact injected bytes and observes abort", async () => {
    const root = await mkdtemp(join(tmpdir(), "diligent-runtime-loop-verifier-"));
    try {
      const world = await loopContextAdaptationTask.setup(SEED, root);
      await writeFixture(root, { "RESULT.txt": world.expected });
      expect((await loopContextAdaptationTask.verify!(world, new AbortController().signal)).exitCode).toBe(0);
      await writeFixture(root, { "RESULT.txt": `${world.initialValue}\n` });
      expect((await loopContextAdaptationTask.verify!(world, new AbortController().signal)).exitCode).toBe(1);
      const aborted = new AbortController();
      aborted.abort();
      expect(await loopContextAdaptationTask.verify!(world, aborted.signal)).toMatchObject({ timedOut: true });
    } finally {
      await removeTemporaryRoot(root);
    }
  });

  test("passes the adapted result with direct tool calls for both default providers", async () => {
    for (const profile of DEFAULT_PROFILES) {
      const execution = await assembledExecution(profile, "direct");
      expect(loopContextAdaptationTask.evaluate(execution), profile.provider).toEqual({ passed: true });
      expect(JSON.stringify(execution.providerCalls[1]!.messages.items)).toContain(execution.world.injectedContext);
    }
  });

  test("passes when the brief is read inside a code-mode exec script", async () => {
    const execution = await assembledExecution(DEFAULT_PROFILES[0]!, "exec");
    expect(execution.toolCalls.map((call) => call.name)).toContain("read");
    expect(execution.world.hookRecords.filter((record) => record.injected)).toHaveLength(1);
    expect(loopContextAdaptationTask.evaluate(execution)).toEqual({ passed: true });
  });

  test("accepts a longer path with probes, recovery, and confirmation as a degraded pass", async () => {
    const execution = await assembledExecution(DEFAULT_PROFILES[0]!, "direct", { longPath: true });
    const result = loopContextAdaptationTask.evaluate(execution);
    expect(result.passed).toBe(true);
    expect(result.diagnostics?.map((diagnostic) => diagnostic.code)).toContain(
      "loop_context_adaptation.stale_write_corrected",
    );
  });

  test("fails when RESULT.txt keeps the stale lane", async () => {
    const execution = await assembledExecution(DEFAULT_PROFILES[0]!, "direct");
    execution.verifier!.exitCode = 1;
    execution.workspace.final.entries.find((entry) => entry.path === "RESULT.txt")!.sha256 = "stale";
    expect(loopContextAdaptationTask.evaluate(execution)).toMatchObject({
      passed: false,
      code: "loop_context_adaptation.result",
      dimension: "semantic_goal",
    });
  });

  test("fails when the brief was never read, because no adaptation was exercised", async () => {
    const execution = await assembledExecution(DEFAULT_PROFILES[0]!, "direct");
    execution.toolCalls = execution.toolCalls.filter((call) => call.capability !== "read");
    expect(loopContextAdaptationTask.evaluate(execution)).toMatchObject({
      passed: false,
      code: "loop_context_adaptation.brief_not_read",
    });
  });

  test("fails when the final answer reports only the stale lane", async () => {
    const execution = await assembledExecution(DEFAULT_PROFILES[0]!, "direct");
    const message = execution.turns[0]!.messages.at(-1)!;
    if (message.role !== "assistant") throw new Error("Missing final assistant.");
    message.content = [{ type: "text", text: `Recorded ${execution.world.initialValue}.` }];
    expect(loopContextAdaptationTask.evaluate(execution)).toMatchObject({
      passed: false,
      code: "loop_context_adaptation.final_answer",
    });
  });
});

async function assembledExecution(
  profile: EvalProfile,
  transport: "direct" | "exec",
  scenario: { longPath?: boolean } = {},
): Promise<RuntimeEvalExecution<LoopContextAdaptationWorld>> {
  const initial = token(SEED, "LANE_INITIAL");
  const updated = token(SEED, "LANE_UPDATED");
  let stream: StreamFunction | undefined;
  const result = await runRuntimeEvalExecution({
    task: loopContextAdaptationTask,
    seed: SEED,
    profile,
    streamFunction(model, context, options) {
      const cwd = cwdFromContext(context);
      const brief = join(cwd, "deployment-brief.txt");
      const result = join(cwd, "RESULT.txt");
      const write = (id: string, from: string | undefined, value: string) =>
        assistantMessage(
          [
            profile.provider === "anthropic"
              ? {
                  type: "tool_call" as const,
                  id,
                  name: "edit",
                  input: {
                    file_path: result,
                    old_string: from === undefined ? "" : `${from}\n`,
                    new_string: `${value}\n`,
                    replace_all: false,
                  },
                }
              : {
                  type: "tool_call" as const,
                  id,
                  name: "apply_patch",
                  input: {
                    patch:
                      from === undefined
                        ? `*** Begin Patch\n*** Add File: RESULT.txt\n+${value}\n*** End Patch`
                        : `*** Begin Patch\n*** Update File: RESULT.txt\n@@\n-${from}\n+${value}\n*** End Patch`,
                  },
                },
          ],
          "tool_use",
        );
      const read = (id: string, path: string) =>
        assistantMessage([{ type: "tool_call", id, name: "read", input: { file_path: path } }], "tool_use");
      stream ??= sequenceStream([
        transport === "exec"
          ? assistantMessage(
              [
                {
                  type: "tool_call",
                  id: "loop-exec-read",
                  name: "exec",
                  input: { code: `return await tools.read({ file_path: ${JSON.stringify(brief)} });` },
                },
              ],
              "tool_use",
            )
          : read("loop-read-1", brief),
        ...(scenario.longPath
          ? [
              read("loop-read-instructions", join(cwd, "AGENTS.md")),
              write("loop-write-stale", undefined, initial),
              write("loop-write-fix", initial, updated),
              read("loop-confirm", result),
            ]
          : [write("loop-write-1", undefined, updated)]),
        assistantMessage([{ type: "text", text: updated }]),
      ]);
      return stream(model, context, options);
    },
  });
  expect(result.failures, JSON.stringify(result.execution.toolCalls)).toEqual([]);
  return result.execution as RuntimeEvalExecution<LoopContextAdaptationWorld>;
}

function token(seed: string, prefix: string): string {
  return `${prefix}_${seed.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10)}`;
}

function cwdFromContext(context: StreamContext): string {
  const base = context.systemPrompt.find((section) => section.label === "base")?.content ?? "";
  const match = base.match(/^Current working directory: (.+)$/m);
  if (!match?.[1]) throw new Error("Missing runtime cwd in provider context.");
  return match[1];
}
