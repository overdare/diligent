// @summary Synthetic evaluator regressions for post-write baseline verification semantics

import { describe, expect, test } from "bun:test";
import type { Message } from "@diligent/core/message-contract";
import type { RuntimeEvalExecution, RuntimeToolTrace } from "../../../src/runtime-task";
import type { EvalSemanticResult } from "../../../src/task";
import { planToExecuteTask } from "../../../src/tasks/runtime/plan-to-execute";
import { projectFixTask } from "../../../src/tasks/runtime/project-fix";

describe("baseline verification semantics", () => {
  test("project-fix requires a passing bun test after the final successful write", () => {
    assertVerificationRegressions(projectFixExecution, (execution) => projectFixTask.evaluate(execution));
  });

  test("plan-to-execute requires a passing bun test after the final successful write", () => {
    assertVerificationRegressions(planToExecuteExecution, (execution) => planToExecuteTask.evaluate(execution));
  });

  test("project-fix fails a wrong end state regardless of verification calls", () => {
    const wrongSource = projectFixExecution();
    wrongSource.workspace.final.entries = [file("src/value.ts", "other-hash")];
    expect(projectFixTask.evaluate(wrongSource)).toMatchObject({ passed: false, dimension: "semantic_goal" });

    const failingVerifier = projectFixExecution();
    failingVerifier.verifier!.exitCode = 1;
    expect(projectFixTask.evaluate(failingVerifier)).toMatchObject({ passed: false, dimension: "semantic_goal" });
  });

  test("project-fix notes a fix made without any read", () => {
    const execution = projectFixExecution();
    execution.toolCalls = execution.toolCalls.filter((call) => call.capability !== "read");
    expect(projectFixTask.evaluate(execution)).toMatchObject({
      passed: true,
      diagnostics: [expect.objectContaining({ code: "project_fix.no_read" })],
    });
  });

  test("plan-to-execute treats a planning-turn mutation as a crossed boundary and a rejected one as a note", () => {
    const mutated = planToExecuteExecution();
    mutated.toolCalls.push({ ...writeTrace(mutated), sequence: 10, toolCallId: "plan-write", turnIndex: 0 });
    expect(planToExecuteTask.evaluate(mutated)).toMatchObject({
      passed: false,
      code: "plan_to_execute.plan_mutation",
      dimension: "runtime_policy",
    });

    const rejected = planToExecuteExecution();
    rejected.toolCalls.unshift({
      ...writeTrace(rejected),
      sequence: 0,
      toolCallId: "plan-write",
      turnIndex: 0,
      outcome: "policy_rejection",
    });
    expect(planToExecuteTask.evaluate(rejected)).toMatchObject({
      passed: true,
      diagnostics: [expect.objectContaining({ code: "plan_to_execute.plan_rejected_non_read" })],
    });
  });

  test("plan-to-execute requires the plan to retain the contract and the contract to be read", () => {
    const forgotten = planToExecuteExecution();
    forgotten.turns[0]!.messages = [assistant("I will implement the formula.")];
    expect(planToExecuteTask.evaluate(forgotten)).toMatchObject({
      passed: false,
      code: "plan_to_execute.plan_context",
      dimension: "semantic_goal",
    });

    const unread = planToExecuteExecution();
    unread.toolCalls[0]!.outcome = "runtime_error";
    expect(planToExecuteTask.evaluate(unread)).toMatchObject({
      passed: false,
      code: "plan_to_execute.diagnosis",
      dimension: "behavior",
    });
  });
});

function assertVerificationRegressions<T>(
  createExecution: () => RuntimeEvalExecution<T>,
  evaluate: (execution: RuntimeEvalExecution<T>) => EvalSemanticResult,
): void {
  expect(evaluate(createExecution())).toEqual({ passed: true });

  const variants: Array<[string, (execution: RuntimeEvalExecution<T>) => void]> = [
    [
      "relative path patch, failed probe, failed first test, and verification read",
      (execution) => {
        const write = writeTrace(execution);
        write.name = "apply_patch";
        write.input = { patch: "*** Begin Patch\n*** Update File: src/value.ts\n*** End Patch" };
        const test = testTrace(execution);
        execution.toolCalls.push(
          { ...test, sequence: 1.5, toolCallId: "early-test", output: { metadata: { exitCode: 1 } } },
          {
            sequence: 0.5,
            toolCallId: "probe",
            turnIndex: test.turnIndex,
            name: "read",
            capability: "read",
            input: { file_path: "AGENTS.local.md" },
            outcome: "runtime_error",
          },
          {
            sequence: 4,
            toolCallId: "verify-read",
            turnIndex: test.turnIndex,
            name: "read",
            capability: "read",
            input: { file_path: "src/value.ts" },
            outcome: "success",
          },
        );
      },
    ],
  ];
  for (const [name, mutate] of variants) {
    const execution = createExecution();
    mutate(execution);
    expect(evaluate(execution), name).toMatchObject({ passed: true });
  }

  const cases: Array<[string, (execution: RuntimeEvalExecution<T>) => void]> = [
    ["non-exact command", (execution) => (testTrace(execution).input = { command: "bun test --watch" })],
    ["runtime-error outcome", (execution) => (testTrace(execution).outcome = "runtime_error")],
    ["missing output evidence", (execution) => delete testTrace(execution).output],
    [
      "missing exit metadata",
      (execution) => (testTrace(execution).output = { output: "tests passed without exit evidence" }),
    ],
    ["nonzero exit", (execution) => (testTrace(execution).output = { output: "failed", metadata: { exitCode: 1 } })],
    [
      "test before final write",
      (execution) => {
        writeTrace(execution).sequence = 3;
        testTrace(execution).sequence = 2;
      },
    ],
    [
      "write after last passing test",
      (execution) =>
        execution.toolCalls.push({
          sequence: 4,
          toolCallId: "write-after-test",
          turnIndex: testTrace(execution).turnIndex,
          name: "edit",
          capability: "write",
          input: { file_path: "$WORKSPACE/src/value.ts" },
          outcome: "success",
        }),
    ],
  ];

  for (const [name, mutate] of cases) {
    const execution = createExecution();
    mutate(execution);
    expect(evaluate(execution), name).toMatchObject({ passed: false, dimension: "behavior" });
  }
}

function projectFixExecution() {
  const world = {
    root: "$WORKSPACE",
    seed: "seed",
    operand: 3,
    expected: "fixed source",
    expectedHash: "fixed-hash",
    protectedPaths: [],
    allowedChanges: ["src/value.ts"],
  };
  const execution = baseExecution(world, [turn(0, "repair", [assistant("Implemented and verified.")])]);
  execution.toolCalls = verificationTraces(0);
  execution.workspace.initial.entries = [file("src/value.ts", "initial-hash")];
  execution.workspace.final.entries = [file("src/value.ts", world.expectedHash)];
  return execution;
}

function planToExecuteExecution() {
  const world = {
    root: "$WORKSPACE",
    seed: "seed",
    token: "CONTRACT_seed",
    multiplier: 3,
    offset: 5,
    diagnosisPath: "spec/private-contract.txt",
    expected: "fixed source",
    expectedHash: "fixed-hash",
    protectedPaths: [],
    allowedChanges: ["src/value.ts"],
  };
  const plan = turn(0, "plan", [assistant(`Contract ${world.token}: value * ${world.multiplier} + ${world.offset}`)]);
  const execution = baseExecution(world, [plan, turn(1, "execute", [assistant("Implemented and verified.")])]);
  execution.session.lines.push({ type: "mode_change", mode: "default" });
  execution.toolCalls = verificationTraces(1);
  execution.toolCalls[0]!.input = { file_path: "$WORKSPACE/spec/private-contract.txt" };
  execution.toolCalls[0]!.turnIndex = 0;
  execution.workspace.final.entries = [file("src/value.ts", world.expectedHash)];
  return execution;
}

function verificationTraces(turnIndex: number): RuntimeToolTrace[] {
  return [
    {
      sequence: 1,
      toolCallId: "read-source",
      turnIndex,
      name: "read",
      capability: "read",
      input: { file_path: "$WORKSPACE/src/value.ts" },
      outcome: "success",
    },
    {
      sequence: 2,
      toolCallId: "write-source",
      turnIndex,
      name: "edit",
      capability: "write",
      input: { file_path: "$WORKSPACE/src/value.ts" },
      outcome: "success",
    },
    {
      sequence: 3,
      toolCallId: "test-project",
      turnIndex,
      name: "bash",
      capability: "execute",
      input: { command: "bun test" },
      outcome: "success",
      output: { output: "1 pass", metadata: { exitCode: 0 } },
    },
  ];
}

function testTrace<T>(execution: RuntimeEvalExecution<T>): RuntimeToolTrace {
  const trace = execution.toolCalls.find((call) => call.toolCallId === "test-project");
  if (!trace) throw new Error("Missing synthetic test trace.");
  return trace;
}

function writeTrace<T>(execution: RuntimeEvalExecution<T>): RuntimeToolTrace {
  const trace = execution.toolCalls.find((call) => call.toolCallId === "write-source");
  if (!trace) throw new Error("Missing synthetic write trace.");
  return trace;
}

function baseExecution<T>(world: T, turns: RuntimeEvalExecution<T>["turns"]): RuntimeEvalExecution<T> {
  return {
    taskId: "baseline-verification",
    profile: { provider: "anthropic", model: "test-model", effort: "medium" },
    seed: "seed",
    startedAt: new Date(0).toISOString(),
    elapsedMs: 1,
    termination: "completed",
    turns,
    compactions: [],
    threadCwd: "$WORKSPACE",
    advertisedTools: [],
    threadReads: [],
    protocolActions: [],
    providerCalls: [],
    toolCalls: [],
    toolOutputFiles: [],
    approvals: [],
    userInputRequests: [],
    logs: [],
    session: { threadId: "thread-1", lines: [{ type: "session", id: "thread-1" }] },
    childSessions: [],
    workspace: { initial: { entries: [] }, final: { entries: [] } },
    runtimeState: { initial: [], final: [], diff: [] },
    verifier: { argv: ["bun", "test"], exitCode: 0, elapsedMs: 1, stdout: "", stderr: "", timedOut: false },
    world,
  };
}

function turn(
  index: number,
  clientPrompt: string,
  messages: Message[],
): RuntimeEvalExecution<unknown>["turns"][number] {
  return {
    index,
    threadId: "thread-1",
    clientPrompt,
    startedAt: new Date(0).toISOString(),
    elapsedMs: 1,
    termination: "completed",
    coreEvents: [],
    runtimeEvents: [],
    notifications: [],
    messages,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
}

function assistant(text: string): Message {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    model: {
      provider: "anthropic",
      modelId: "test-model",
    },
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    stopReason: "end_turn",
    timestamp: 0,
  };
}

function file(path: string, sha256: string) {
  return { path, kind: "file" as const, size: 1, sha256 };
}
