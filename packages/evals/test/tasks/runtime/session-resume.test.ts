// @summary Outcome and resumed-turn write regressions for session-resume

import { describe, expect, test } from "bun:test";
import type { RuntimeEvalExecution, RuntimeToolTrace } from "../../../src/runtime-task";
import { sha256Text } from "../../../src/tasks/runtime/helpers";
import { type SessionResumeWorld, sessionResumeTask } from "../../../src/tasks/runtime/session-resume";

describe("session-resume", () => {
  test("passes when the resumed turn writes the exact codename", async () => {
    const world = await sessionResumeTask.setup("shared-seed-123", "$WORKSPACE");
    expect(sessionResumeTask.evaluate(execution(world, [write(world, 1)]))).toEqual({ passed: true });
  });

  test("accepts an alternative write tool, relative path, and recovered failure with a diagnostic", async () => {
    const world = await sessionResumeTask.setup("shared-seed-123", "$WORKSPACE");
    const failed: RuntimeToolTrace = {
      ...write(world, 1),
      toolCallId: "failed-edit",
      outcome: "runtime_error",
      error: "old_string not found",
    };
    const patch: RuntimeToolTrace = {
      sequence: 2,
      toolCallId: "patch",
      name: "apply_patch",
      capability: "write",
      turnIndex: 1,
      input: { patch: `*** Begin Patch\n*** Add File: CODENAME.txt\n+${world.codename}\n*** End Patch` },
      outcome: "success",
    };
    const result = sessionResumeTask.evaluate(execution(world, [failed, patch]));
    expect(result.passed).toBe(true);
    expect(result.diagnostics?.map((diagnostic) => diagnostic.code)).toEqual(["session_resume.tool_recovery"]);
  });

  test("fails when the codename was written only before the restart", async () => {
    const world = await sessionResumeTask.setup("shared-seed-123", "$WORKSPACE");
    expect(sessionResumeTask.evaluate(execution(world, [write(world, 0)]))).toMatchObject({
      passed: false,
      code: "session_resume.no_resumed_write",
      dimension: "behavior",
    });
  });

  test("separates a wrong codename from a missing trailing newline", async () => {
    const world = await sessionResumeTask.setup("shared-seed-123", "$WORKSPACE");
    const wrong = execution(world, [write(world, 1)]);
    wrong.workspace.final.entries[0]!.sha256 = sha256Text("OTHER\n");
    expect(sessionResumeTask.evaluate(wrong)).toMatchObject({ passed: false, dimension: "semantic_goal" });
    const unterminated = execution(world, [write(world, 1)]);
    unterminated.workspace.final.entries[0]!.sha256 = sha256Text(world.codename);
    expect(sessionResumeTask.evaluate(unterminated)).toMatchObject({ passed: false, dimension: "format_contract" });
  });
});

function write(world: SessionResumeWorld, turnIndex: number): RuntimeToolTrace {
  return {
    sequence: 1,
    toolCallId: `write-${turnIndex}`,
    name: "write",
    capability: "write",
    turnIndex,
    input: { file_path: "$WORKSPACE/CODENAME.txt", content: world.expected },
    outcome: "success",
  };
}

function execution(world: SessionResumeWorld, toolCalls: RuntimeToolTrace[]): RuntimeEvalExecution<SessionResumeWorld> {
  return {
    taskId: sessionResumeTask.id,
    profile: { provider: "anthropic", model: "test-model", effort: "medium" },
    seed: world.seed,
    startedAt: new Date(0).toISOString(),
    elapsedMs: 1,
    termination: "completed",
    turns: [turn(0), turn(1)],
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
        entries: [{ path: "CODENAME.txt", kind: "file", size: world.expected.length, sha256: world.expectedHash }],
      },
    },
    runtimeState: { initial: [], final: [], diff: [] },
    world,
  };
}

function turn(index: number): RuntimeEvalExecution<unknown>["turns"][number] {
  return {
    index,
    threadId: "thread-1",
    clientPrompt: "prompt",
    startedAt: new Date(0).toISOString(),
    elapsedMs: 1,
    termination: "completed",
    coreEvents: [],
    runtimeEvents: [],
    notifications: [],
    messages: [],
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
}
