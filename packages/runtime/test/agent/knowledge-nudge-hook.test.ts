// @summary Knowledge nudge cadence, reset on update_knowledge, restore, and compaction behavior

import { describe, expect, test } from "bun:test";
import type { AgentLoopHook } from "@diligent/core/agent";
import type { ToolCallBlock, ToolResultMessage } from "@diligent/core/message-contract";
import { createKnowledgeNudgeHook } from "../../src/agent/knowledge-nudge-hook";

const toolCall: ToolCallBlock = { type: "tool_call", id: "tc", name: "update_knowledge", input: {} };
const knowledgeResult = (isError = false, toolName = "update_knowledge"): ToolResultMessage => ({
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

describe("createKnowledgeNudgeHook", () => {
  test("reminds once every interval of turns and then waits a full interval again", () => {
    const hook = createKnowledgeNudgeHook({ intervalTurns: 2 });
    hook.restore?.({ messages: [] });

    expect(before(hook, "t1")).toBeUndefined();
    after(hook, "t1");
    expect(before(hook, "t2")).toBeUndefined();
    after(hook, "t2");
    const injections = before(hook, "t3");
    expect(injections).toHaveLength(1);
    expect(injections?.[0]?.source).toBe("knowledge-nudge");
    expect(injections?.[0]?.content).toContain("<system-reminder>");
    expect(injections?.[0]?.content).toContain("update_knowledge");
    after(hook, "t3");
    expect(before(hook, "t4")).toBeUndefined();
  });

  test("a successful update_knowledge call restarts the count; a failed one does not", () => {
    const hook = createKnowledgeNudgeHook({ intervalTurns: 2 });
    hook.restore?.({ messages: [] });
    after(hook, "t1");
    hook.onToolResult?.({ turnId: "t2", toolCall, result: knowledgeResult(true) });
    hook.onToolResult?.({ turnId: "t2", toolCall, result: knowledgeResult(false, "plan") });
    after(hook, "t2");
    expect(before(hook, "t3")).toHaveLength(1);

    after(hook, "t3");
    hook.onToolResult?.({ turnId: "t4", toolCall, result: knowledgeResult() });
    after(hook, "t4");
    expect(before(hook, "t5")).toBeUndefined();
  });

  test("compaction alone does not trigger a reminder", () => {
    const hook = createKnowledgeNudgeHook({ intervalTurns: 3 });
    hook.restore?.({ messages: [] });
    after(hook, "t1");
    expect(before(hook, "t2", true)).toBeUndefined();
  });

  test("restore starts counting from zero", () => {
    const hook = createKnowledgeNudgeHook({ intervalTurns: 1 });
    hook.restore?.({ messages: [] });
    after(hook, "t1");
    hook.restore?.({ messages: [] });
    expect(before(hook, "t2")).toBeUndefined();
  });
});
