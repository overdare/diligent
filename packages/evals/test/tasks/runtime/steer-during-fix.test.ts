// @summary Outcome, steering, and code-mode-independence tests for the steer-during-fix runtime eval

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StreamContext, StreamFunction } from "@diligent/core/provider-contract";
import { runRuntimeEvalExecution } from "../../../src/runner/runtime-execution";
import { removeTemporaryRoot } from "../../../src/runner/runtime-workspace";
import type { RuntimeEvalExecution, RuntimeProtocolActionTrace, RuntimeToolTrace } from "../../../src/runtime-task";
import { sha256Text, writeFixture } from "../../../src/tasks/runtime/helpers";
import { type SteerDuringFixWorld, steerDuringFixTask } from "../../../src/tasks/runtime/steer-during-fix";
import { assistantMessage, sequenceStream } from "../../helpers/fake-stream";

describe("steer-during-fix runtime eval", () => {
  test("defines a deterministic fixture whose prompt names only the superseded value", async () => {
    const root = await mkdtemp(join(tmpdir(), "diligent-runtime-steer-during-fix-"));
    try {
      const world = await steerDuringFixTask.setup("shared-seed-123", root);
      expect(await steerDuringFixTask.setup("shared-seed-123", root)).toEqual(world);
      expect(await readFile(join(root, world.targetPath), "utf8")).toBe(world.initialContent);
      const [step] = steerDuringFixTask.createSteps(world);
      if (step?.kind !== "turn") throw new Error("Expected one turn step.");
      expect(step.message).toContain(world.originalRequestedValue);
      expect(step.message).not.toContain(world.replacementValue);
      expect(step.actions?.[0]?.request.params).toMatchObject({ content: world.steeringContent });
    } finally {
      await removeTemporaryRoot(root);
    }
  });

  test("independent verifier accepts only exact replacement bytes and observes abort", async () => {
    const root = await mkdtemp(join(tmpdir(), "diligent-runtime-steer-verifier-"));
    try {
      const world = await steerDuringFixTask.setup("shared-seed-123", root);
      await writeFixture(root, { [world.targetPath]: world.expected });
      expect((await steerDuringFixTask.verify!(world, new AbortController().signal)).exitCode).toBe(0);
      await writeFixture(root, { [world.targetPath]: `${world.originalRequestedValue}\n` });
      expect((await steerDuringFixTask.verify!(world, new AbortController().signal)).exitCode).toBe(1);
      const aborted = new AbortController();
      aborted.abort();
      expect(await steerDuringFixTask.verify!(world, aborted.signal)).toMatchObject({ exitCode: 1, timedOut: true });
    } finally {
      await removeTemporaryRoot(root);
    }
  });

  test("accepts any write tool and input shape that produced the steered bytes", () => {
    const world = resultWorld("seed");
    const writes: Array<Pick<RuntimeToolTrace, "name" | "input">> = [
      { name: "apply_patch", input: { patch: expectedPatch(world) } },
      {
        name: "edit",
        input: {
          file_path: world.targetPath,
          old_string: world.baseValue,
          new_string: world.replacementValue,
          replace_all: false,
        },
      },
      { name: "write", input: { file_path: `$WORKSPACE/${world.targetPath}`, content: world.expected } },
    ];
    for (const write of writes) {
      const execution = validExecution();
      Object.assign(execution.toolCalls[1]!, write);
      expect(steerDuringFixTask.evaluate(execution), write.name).toEqual({ passed: true });
    }
  });

  test("accepts failed probes, read retries, and a confirmation read as a pass with informational notes", () => {
    const execution = validExecution();
    const [read, write] = execution.toolCalls;
    execution.toolCalls = [
      trace(1, "read", { file_path: "$WORKSPACE/AGENTS.md" }, "runtime_error"),
      trace(2, "read", { file_path: "/elsewhere/live-value.txt" }, "runtime_error"),
      { ...read!, sequence: 3 },
      { ...write!, sequence: 4 },
      { ...trace(5, "read", { file_path: execution.world.targetPath }), output: execution.world.expected },
    ];
    const result = steerDuringFixTask.evaluate(execution);
    expect(result.passed).toBe(true);
    expect(result.diagnostics?.every((diagnostic) => diagnostic.impact === "info")).toBe(true);
  });

  test("degrades but passes when the superseded value was written before the steer was applied", () => {
    const execution = validExecution();
    const stale = trace(2, "edit", {
      file_path: execution.world.targetPath,
      old_string: execution.world.baseValue,
      new_string: execution.world.originalRequestedValue,
    });
    stale.capability = "write";
    execution.toolCalls.splice(1, 0, stale);
    execution.toolCalls[2]!.sequence = 3;
    expect(steerDuringFixTask.evaluate(execution)).toMatchObject({
      passed: true,
      diagnostics: [expect.objectContaining({ code: "steer_during_fix.superseded_value_written" })],
    });
  });

  test("fails a wrong end state, a skipped inspection, or a change made before inspection", () => {
    const cases: Array<[string, string, (execution: RuntimeEvalExecution<SteerDuringFixWorld>) => void]> = [
      ["final value", "steer_during_fix.verifier", (execution) => (execution.verifier!.exitCode = 1)],
      ["never inspected", "steer_during_fix.read", (execution) => execution.toolCalls.shift()],
      [
        "changed before inspection",
        "steer_during_fix.write_before_read",
        (execution) => {
          execution.toolCalls[0]!.sequence = 3;
          execution.toolCalls.reverse();
        },
      ],
      ["verifier timeout", "steer_during_fix.verifier_timeout", (execution) => (execution.verifier!.timedOut = true)],
    ];
    for (const [name, code, mutate] of cases) {
      const execution = validExecution();
      mutate(execution);
      expect(steerDuringFixTask.evaluate(execution), name).toMatchObject({ passed: false, code });
    }
  });

  test("delivers the steer and passes for a direct read and for a read nested in a code-mode exec script", async () => {
    for (const transport of ["direct", "exec"] as const) {
      const { result, sawSteeringBeforeMutation } = await runScripted(transport);
      expect(result.failures, transport).toEqual([]);
      expect(result.passed, transport).toBe(true);
      expect(sawSteeringBeforeMutation, transport).toBe(true);
      expect(result.execution.protocolActions[0]?.status, transport).toBe("completed");
    }
  });
});

async function runScripted(transport: "direct" | "exec") {
  const seed = "shared-seed-123";
  let providerCall = 0;
  let sawSteeringBeforeMutation = false;
  let scripted: StreamFunction | undefined;
  const result = await runRuntimeEvalExecution({
    task: steerDuringFixTask,
    seed,
    profile: { provider: "openai", model: "gpt-6.1-terra", effort: "medium" },
    streamFunction: (model, context, options) => {
      providerCall += 1;
      const world = resultWorld(seed);
      const target = join(cwdFromContext(context), world.targetPath);
      if (providerCall === 2)
        sawSteeringBeforeMutation = JSON.stringify(context.messages).includes(world.steeringContent);
      scripted ??= sequenceStream([
        assistantMessage(
          [
            transport === "exec"
              ? {
                  type: "tool_call",
                  id: "steer-exec-1",
                  name: "exec",
                  input: { code: `return await tools.read({ file_path: ${JSON.stringify(target)} });` },
                }
              : { type: "tool_call", id: "steer-read-1", name: "read", input: { file_path: target } },
          ],
          "tool_use",
        ),
        assistantMessage(
          [{ type: "tool_call", id: "steer-write-1", name: "apply_patch", input: { patch: expectedPatch(world) } }],
          "tool_use",
        ),
        assistantMessage([{ type: "text", text: "Done." }]),
      ]);
      return scripted(model, context, options);
    },
  });
  return { result, sawSteeringBeforeMutation };
}

function trace(
  sequence: number,
  name: string,
  input: unknown,
  outcome: RuntimeToolTrace["outcome"] = "success",
): RuntimeToolTrace {
  return { sequence, toolCallId: `call-${sequence}`, name, capability: "read", input, outcome, threadId: "thread-1" };
}

function resultWorld(seed: string): SteerDuringFixWorld {
  const safeSeed = seed.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "seed";
  const baseValue = `BASE_${safeSeed}`;
  const originalRequestedValue = `ORIGINAL_REQUEST_${safeSeed}`;
  const replacementValue = `REPLACEMENT_${safeSeed}`;
  const targetPath = "config/live-value.txt";
  const initialContent = `${baseValue}\n`;
  const expected = `${replacementValue}\n`;
  return {
    root: "$WORKSPACE",
    seed,
    targetPath,
    baseValue,
    originalRequestedValue,
    replacementValue,
    initialContent,
    expected,
    initialHash: sha256Text(initialContent),
    expectedHash: sha256Text(expected),
    actionId: "steer-during-fix-after-read",
    steerId: `steer-during-fix-${safeSeed}`,
    steeringContent: `Change the requirement for ${targetPath}: it must contain exactly ${replacementValue} and one trailing newline. Do not use ${originalRequestedValue}.`,
    protectedPaths: ["control.txt"],
    allowedChanges: [targetPath],
  };
}

function validExecution(): RuntimeEvalExecution<SteerDuringFixWorld> {
  const world = resultWorld("seed");
  const threadId = "thread-1";
  const prompt = `Inspect ${world.targetPath} to confirm its current value, then change that file so it contains exactly ${world.originalRequestedValue} and one trailing newline.`;
  const readTrace = {
    sequence: 1,
    toolCallId: "read-1",
    name: "read",
    capability: "read" as const,
    input: { file_path: `$WORKSPACE/${world.targetPath}` },
    outcome: "success" as const,
    output: world.initialContent,
    threadId,
  };
  const writeTrace = {
    sequence: 2,
    toolCallId: "write-1",
    name: "apply_patch",
    capability: "write" as const,
    input: { patch: expectedPatch(world) },
    outcome: "success" as const,
    threadId,
  };
  const action: RuntimeProtocolActionTrace = {
    id: world.actionId,
    turnIndex: 0,
    status: "completed",
    timeoutMs: 30_000,
    trigger: {
      source: "runtime_event",
      eventType: "tool_end",
      toolName: "read",
      isError: false,
      occurrence: 1,
      allowSubsequentMatches: true,
    },
    triggerCount: 1,
    triggeredAtMs: 4,
    triggerEvidence: { type: "tool_end", toolCallId: readTrace.toolCallId, toolName: "read", isError: false },
    request: { method: "turn/steer", params: { threadId, content: world.steeringContent, steerId: world.steerId } },
    requestedAtMs: 5,
    response: { queued: true, steerId: world.steerId },
    respondedAtMs: 6,
  };
  const readNotification = agentEvent(action.triggerEvidence);
  const steeringNotification = {
    method: "agent/event",
    params: {
      threadId,
      event: {
        type: "steering_injected",
        messageCount: 1,
        messages: [{ role: "user", content: world.steeringContent, timestamp: 1 }],
        steerIds: [world.steerId],
      },
    },
  };
  const writeNotification = agentEvent({
    type: "tool_start",
    toolCallId: writeTrace.toolCallId,
    toolName: "apply_patch",
  });
  return {
    taskId: steerDuringFixTask.id,
    profile: { provider: "openai", model: "test-model", effort: "medium" },
    seed: world.seed,
    startedAt: new Date(0).toISOString(),
    elapsedMs: 10,
    termination: "completed",
    turns: [
      {
        index: 0,
        threadId,
        clientPrompt: prompt,
        startedAt: new Date(0).toISOString(),
        elapsedMs: 10,
        termination: "completed",
        coreEvents: [],
        runtimeEvents: [],
        notifications: [readNotification, steeringNotification, writeNotification] as never,
        messages: [],
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    ],
    compactions: [],
    threadCwd: "$WORKSPACE",
    advertisedTools: [],
    threadReads: [],
    protocolActions: [action],
    providerCalls: [
      providerCall(1, [prompt]),
      providerCall(2, [readTrace.toolCallId, world.initialContent, world.steeringContent]),
    ],
    toolCalls: [readTrace, writeTrace],
    toolOutputFiles: [],
    approvals: [],
    userInputRequests: [],
    logs: [],
    session: {
      threadId,
      lines: [
        { type: "session", id: threadId },
        { type: "message", message: { role: "user", content: prompt } },
        { type: "message", message: { role: "tool_result", toolCallId: readTrace.toolCallId, toolName: "read" } },
        { type: "message", message: { role: "user", content: world.steeringContent } },
        {
          type: "message",
          message: { role: "tool_result", toolCallId: writeTrace.toolCallId, toolName: "apply_patch" },
        },
      ],
    },
    childSessions: [],
    workspace: {
      initial: {
        entries: [
          { path: world.targetPath, kind: "file", size: world.initialContent.length, sha256: world.initialHash },
        ],
      },
      final: {
        entries: [{ path: world.targetPath, kind: "file", size: world.expected.length, sha256: world.expectedHash }],
      },
    },
    runtimeState: { initial: [], final: [], diff: [] },
    verifier: {
      argv: ["steer-during-fix-verifier"],
      exitCode: 0,
      elapsedMs: 1,
      stdout: "",
      stderr: "",
      timedOut: false,
    },
    world,
  };
}

function expectedPatch(world: SteerDuringFixWorld): string {
  return `*** Begin Patch\n*** Update File: ${world.targetPath}\n@@\n-${world.baseValue}\n+${world.replacementValue}\n*** End Patch`;
}

function agentEvent(event: unknown) {
  return { method: "agent/event", params: { threadId: "thread-1", event } };
}

function providerCall(sequence: number, items: unknown[]) {
  return {
    sequence,
    model: { provider: "openai", modelId: "test-model" },
    systemPrompt: { totalCount: 0, includedCount: 0, omittedCount: 0, items: [] },
    messages: { totalCount: items.length, includedCount: items.length, omittedCount: 0, items },
    tools: { totalCount: 0, includedCount: 0, omittedCount: 0, items: [] },
    streamOptions: {},
    bounds: {
      maxSourceItems: 10,
      maxNestedItems: 10,
      maxObjectProperties: 10,
      maxStringChars: 10_000,
      maxDepth: 10,
      truncatedStrings: 0,
      omittedNestedItems: 0,
      omittedObjectProperties: 0,
    },
  } as RuntimeEvalExecution<unknown>["providerCalls"][number];
}

function cwdFromContext(context: StreamContext): string {
  const base = context.systemPrompt.find((section) => section.label === "base")?.content ?? "";
  const match = base.match(/^Current working directory: (.+)$/m);
  if (!match?.[1]) throw new Error("Missing runtime cwd in provider context.");
  return match[1];
}
