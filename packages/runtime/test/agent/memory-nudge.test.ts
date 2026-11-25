// @summary Memory nudge cadence, reset on update_memory, restore, and compaction behavior

import { describe, expect, test } from "bun:test";
import type { AgentLoopHook } from "@diligent/core/agent";
import type { ToolCallBlock, ToolResultMessage } from "@diligent/core/message-contract";
import { createMemoryNudge } from "../../src/agent/memory-nudge";
import { createReminderHook } from "../../src/agent/reminder-hook";

const toolCall: ToolCallBlock = { type: "tool_call", id: "tc", name: "update_memory", input: {} };
const memoryResult = (isError = false, toolName = "update_memory"): ToolResultMessage => ({
  role: "tool_result",
  toolCallId: "tc",
  toolName,
  output: isError ? "Error: content is required" : "created",
  isError,
  timestamp: Date.now(),
});

function before(hook: AgentLoopHook, turnId: string, compactedThisTurn = false) {
  return hook.beforeTurn?.({ messages: [], turnId, compactedThisTurn });
}

function after(hook: AgentLoopHook, turnId: string) {
  hook.afterTurn?.({ turnId, message: {} as never, toolResults: [] });
}

describe("memory nudge reminder", () => {
  test("reminds once every interval of turns and then waits a full interval again", () => {
    const hook = createReminderHook({ intervalTurns: 2, policy: createMemoryNudge() });
    hook.restore?.({ messages: [] });

    expect(before(hook, "t1")).toBeUndefined();
    after(hook, "t1");
    expect(before(hook, "t2")).toBeUndefined();
    after(hook, "t2");
    const injections = before(hook, "t3");
    expect(injections).toHaveLength(1);
    expect(injections?.[0]?.source).toBe("memory-nudge");
    expect(injections?.[0]?.content).toContain("<system-reminder>");
    expect(injections?.[0]?.content).toContain("update_memory");
    after(hook, "t3");
    expect(before(hook, "t4")).toBeUndefined();
  });

  test("a successful update_memory call restarts the count; a failed one does not", () => {
    const hook = createReminderHook({ intervalTurns: 2, policy: createMemoryNudge() });
    hook.restore?.({ messages: [] });
    after(hook, "t1");
    hook.onToolResult?.({ turnId: "t2", toolCall, result: memoryResult(true) });
    hook.onToolResult?.({ turnId: "t2", toolCall, result: memoryResult(false, "plan") });
    after(hook, "t2");
    expect(before(hook, "t3")).toHaveLength(1);

    after(hook, "t3");
    hook.onToolResult?.({ turnId: "t4", toolCall, result: memoryResult() });
    hook.onToolResult?.({ turnId: "t4", toolCall, result: memoryResult(true) });
    after(hook, "t4");
    expect(before(hook, "t5")).toBeUndefined();
  });

  test("compaction alone does not trigger a reminder", () => {
    const hook = createReminderHook({ intervalTurns: 3, policy: createMemoryNudge() });
    hook.restore?.({ messages: [] });
    after(hook, "t1");
    expect(before(hook, "t2", true)).toBeUndefined();
  });

  test("restore starts counting from zero", () => {
    const hook = createReminderHook({ intervalTurns: 1, policy: createMemoryNudge() });
    hook.restore?.({ messages: [] });
    after(hook, "t1");
    hook.restore?.({ messages: [] });
    expect(before(hook, "t2")).toBeUndefined();
  });
});
