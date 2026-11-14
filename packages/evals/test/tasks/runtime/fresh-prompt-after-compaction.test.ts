// @summary Outcome, archival-turn mutation, and compaction-event regressions for fresh-prompt-after-compaction

import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTemporaryRoot } from "../../../src/runner/runtime-workspace";
import type { RuntimeEvalExecution, RuntimeToolTrace } from "../../../src/runtime-task";
import {
  type FreshPromptAfterCompactionWorld,
  freshPromptAfterCompactionTask,
} from "../../../src/tasks/runtime/fresh-prompt-after-compaction";

type Notification = RuntimeEvalExecution<unknown>["turns"][number]["notifications"][number];

describe("fresh-prompt-after-compaction", () => {
  test("passes when the fresh request is applied after compaction in the second turn", async () => {
    await withWorld(async (world) => {
      expect(freshPromptAfterCompactionTask.evaluate(execution(world, [write(1)], [0, 1]))).toEqual({ passed: true });
    });
  });

  test("notes earlier compaction, a rejected archival write, and a relative-path retry without failing", async () => {
    await withWorld(async (world) => {
      const rejected: RuntimeToolTrace = { ...write(0), toolCallId: "early", outcome: "policy_rejection" };
      const failed: RuntimeToolTrace = { ...write(1), toolCallId: "failed", outcome: "runtime_error" };
      const retry: RuntimeToolTrace = { ...write(1), input: { file_path: "FRESH.txt", content: world.expected } };
      const result = freshPromptAfterCompactionTask.evaluate(execution(world, [rejected, failed, retry], [1, 0]));
      expect(result.passed).toBe(true);
      expect(result.diagnostics?.map((diagnostic) => diagnostic.code).sort()).toEqual([
        "fresh_prompt.archival_write_attempt",
        "fresh_prompt.compaction_not_observed",
        "fresh_prompt.tool_recovery",
      ]);
    });
  });

  test("fails a successful archival-turn mutation as a policy violation", async () => {
    await withWorld(async (world) => {
      expect(freshPromptAfterCompactionTask.evaluate(execution(world, [write(0)], [0, 1]))).toMatchObject({
        passed: false,
        code: "fresh_prompt.early_mutation",
        dimension: "runtime_policy",
      });
    });
  });

  test("fails when no compaction completed in any turn", async () => {
    await withWorld(async (world) => {
      expect(freshPromptAfterCompactionTask.evaluate(execution(world, [write(1)], [0, 0]))).toMatchObject({
        passed: false,
        code: "fresh_prompt.compaction_missing",
        dimension: "behavior",
      });
    });
  });

  test("fails a missing fresh requirement as a semantic outcome failure", async () => {
    await withWorld(async (world) => {
      const input = execution(world, [write(1)], [0, 1]);
      input.verifier!.exitCode = 1;
      expect(freshPromptAfterCompactionTask.evaluate(input)).toMatchObject({
        passed: false,
        code: "fresh_prompt.artifact",
        dimension: "semantic_goal",
      });
    });
  });
});

async function withWorld(run: (world: FreshPromptAfterCompactionWorld) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "diligent-fresh-prompt-evaluate-"));
  try {
    await run(await freshPromptAfterCompactionTask.setup("shared-seed-123", root));
  } finally {
    await removeTemporaryRoot(root);
  }
}

function write(turnIndex: number): RuntimeToolTrace {
  return {
    sequence: turnIndex + 1,
    toolCallId: `write-${turnIndex}`,
    name: "write",
    capability: "write",
    turnIndex,
    input: { file_path: "$WORKSPACE/FRESH.txt", content: "value\n" },
    outcome: "success",
  };
}

function compactionEnd(): Notification {
  const notification = { method: "agent/event", params: { event: { type: "compaction_end" } } };
  // Synthetic fixture: only the event type is read by the evaluator.
  return notification as unknown as Notification;
}

function execution(
  world: FreshPromptAfterCompactionWorld,
  toolCalls: RuntimeToolTrace[],
  compactionsPerTurn: [number, number],
): RuntimeEvalExecution<FreshPromptAfterCompactionWorld> {
  return {
    taskId: freshPromptAfterCompactionTask.id,
    profile: { provider: "anthropic", model: "test-model", effort: "medium" },
    seed: world.seed,
    startedAt: new Date(0).toISOString(),
    elapsedMs: 1,
    termination: "completed",
    turns: compactionsPerTurn.map((count, index) => turn(index, Array.from({ length: count }, compactionEnd))),
    compactions: [],
    threadCwd: "$WORKSPACE",
    advertisedTools: [],
    threadReads: [],
    protocolActions: [],
    providerCalls: [],
    toolCalls,
    toolOutputFiles: [],
    approvals: [],
    userInputRequests: [],
    logs: [],
    session: { threadId: "thread-1", lines: [] },
    childSessions: [],
    workspace: {
      initial: { entries: [] },
      final: {
        entries: [
          { path: "FRESH.txt", kind: "file", size: world.expected.length, sha256: world.expectedHash },
          { path: "control.txt", kind: "file", size: 18, sha256: world.controlHash },
        ],
      },
    },
    runtimeState: { initial: [], final: [], diff: [] },
    verifier: { argv: [], exitCode: 0, elapsedMs: 1, stdout: "", stderr: "", timedOut: false },
    world,
  };
}

function turn(index: number, notifications: Notification[]): RuntimeEvalExecution<unknown>["turns"][number] {
  return {
    index,
    threadId: "thread-1",
    clientPrompt: "prompt",
    startedAt: new Date(0).toISOString(),
    elapsedMs: 1,
    termination: "completed",
    coreEvents: [],
    runtimeEvents: [],
    notifications,
    messages: [],
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
}
