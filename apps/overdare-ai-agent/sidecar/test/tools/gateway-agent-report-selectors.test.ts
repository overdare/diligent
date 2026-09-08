// @summary Tests the deterministic failure selectors behind the agent failure report hook.

import { describe, expect, test } from "bun:test";
import { COMPACTION_SUMMARY_PREFIX } from "@diligent/core/agent";
import type { Message, ToolCallBlock } from "@diligent/core/message-contract";
import { createFailureSelectors } from "../../src/tools/gateway/agent-report-selectors";

function call(name: string, input: Record<string, unknown> = {}, id = "tc-1"): ToolCallBlock {
  return { type: "tool_call", id, name, input };
}

function result(toolName: string, opts: { isError?: boolean; metadata?: Record<string, unknown> } = {}) {
  return {
    role: "tool_result" as const,
    toolCallId: "tc-1",
    toolName,
    output: "",
    isError: opts.isError ?? false,
    timestamp: 0,
    metadata: opts.metadata,
  };
}

const user = (content: string): Message => ({ role: "user", content, timestamp: 0 });
const assistant = (stopReason: "end_turn" | "tool_use" | "max_tokens" | "error" | "aborted"): Message => ({
  role: "assistant",
  content: [],
  model: { provider: "anthropic", modelId: "m" },
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  stopReason,
  timestamp: 0,
});
const toolResult = (): Message => result("x");

describe("selector A — discarded work", () => {
  test("rollback trips once per session", () => {
    const s = createFailureSelectors();
    expect(s.onToolResult(call("studiorpc_rollback"), result("studiorpc_rollback"))).toEqual({
      kind: "rollback",
      tool: "studiorpc_rollback",
      count: 1,
      fingerprint: "rollback:studiorpc_rollback",
    });
    expect(s.onToolResult(call("studiorpc_rollback"), result("studiorpc_rollback"))).toBeUndefined();
  });

  test("human_edits trips only when edits were detected", () => {
    const s = createFailureSelectors();
    const edits = call("studiorpc_human_edits");
    expect(
      s.onToolResult(edits, result("studiorpc_human_edits", { metadata: { humanEditsDetected: false } })),
    ).toBeUndefined();
    expect(
      s.onToolResult(edits, result("studiorpc_human_edits", { metadata: { humanEditsDetected: true } }))?.kind,
    ).toBe("human_edits");
  });

  test("afterTurn stopReason aborted trips", () => {
    const s = createFailureSelectors();
    expect(s.onAfterTurn("end_turn")).toBeUndefined();
    expect(s.onAfterTurn("aborted")?.kind).toBe("aborted");
  });
});

describe("selector A — abort detected by message shape at the next prompt", () => {
  test("clean end_turn before the new prompt → nothing", () => {
    const s = createFailureSelectors();
    expect(
      s.onPromptStart([user("a"), assistant("tool_use"), toolResult(), assistant("end_turn"), user("b")]),
    ).toBeUndefined();
  });

  test("assistant tool_use as the last message before the new prompt → aborted mid-tools", () => {
    const s = createFailureSelectors();
    expect(s.onPromptStart([user("a"), assistant("tool_use"), toolResult(), user("b")])?.kind).toBe("aborted");
  });

  test("user prompt directly followed by a new user prompt → aborted mid-stream", () => {
    const s = createFailureSelectors();
    expect(s.onPromptStart([user("a"), user("b")])?.kind).toBe("aborted");
  });

  test("compaction summary before the new prompt is not an abort", () => {
    const s = createFailureSelectors();
    expect(s.onPromptStart([user(`${COMPACTION_SUMMARY_PREFIX} summary`), user("b")])).toBeUndefined();
  });

  test("first prompt of a session → nothing", () => {
    const s = createFailureSelectors();
    expect(s.onPromptStart([user("a")])).toBeUndefined();
  });
});

describe("selector B — repeated identical call (core doom loop)", () => {
  test("three identical calls trip repeated_call", () => {
    const s = createFailureSelectors();
    const c = call("instance_upsert", { id: "x", props: { a: 1 } });
    expect(s.onToolResult(c, result("instance_upsert"))).toBeUndefined();
    expect(s.onToolResult(c, result("instance_upsert"))).toBeUndefined();
    const sig = s.onToolResult(c, result("instance_upsert"));
    expect(sig?.kind).toBe("repeated_call");
    expect(sig?.tool).toBe("instance_upsert");
    expect(sig?.fingerprint).toBe("repeated_call:instance_upsert");
  });

  test("different args do not trip", () => {
    const s = createFailureSelectors();
    for (let i = 0; i < 3; i++) {
      expect(s.onToolResult(call("instance_upsert", { i }), result("instance_upsert"))).toBeUndefined();
    }
  });
});

describe("selector C — consecutive same-tool errors", () => {
  test("trips at N, not N-1, and resets on success", () => {
    const s = createFailureSelectors({ errorStreak: 3 });
    const c = (i: number) => call("instance_upsert", { i });
    expect(s.onToolResult(c(1), result("instance_upsert", { isError: true }))).toBeUndefined();
    expect(s.onToolResult(c(2), result("instance_upsert", { isError: true }))).toBeUndefined();
    expect(s.onToolResult(c(3), result("instance_upsert"))).toBeUndefined(); // success resets
    expect(s.onToolResult(c(4), result("instance_upsert", { isError: true }))).toBeUndefined();
    expect(s.onToolResult(c(5), result("instance_upsert", { isError: true }))).toBeUndefined();
    const sig = s.onToolResult(c(6), result("instance_upsert", { isError: true }));
    expect(sig).toEqual({
      kind: "repeated_error",
      tool: "instance_upsert",
      count: 3,
      fingerprint: "repeated_error:instance_upsert",
    });
  });

  test("streak is per tool", () => {
    const s = createFailureSelectors({ errorStreak: 2 });
    expect(s.onToolResult(call("a", { i: 1 }), result("a", { isError: true }))).toBeUndefined();
    expect(s.onToolResult(call("b", { i: 2 }), result("b", { isError: true }))).toBeUndefined();
    expect(s.onToolResult(call("a", { i: 3 }), result("a", { isError: true }))?.kind).toBe("repeated_error");
  });

  test("a success that arms repeated_call still resets the streak", () => {
    const s = createFailureSelectors({ errorStreak: 3 });
    expect(s.onToolResult(call("a", { i: 1 }), result("a", { isError: true }))).toBeUndefined();
    expect(s.onToolResult(call("a", { i: 2 }), result("a", { isError: true }))).toBeUndefined();
    // Three identical successes: the third arms repeated_call and returns early, but every one
    // of them must still reset the error streak.
    expect(s.onToolResult(call("a", { same: true }), result("a"))).toBeUndefined();
    expect(s.onToolResult(call("a", { same: true }), result("a"))).toBeUndefined();
    expect(s.onToolResult(call("a", { same: true }), result("a"))?.kind).toBe("repeated_call");
    expect(s.onToolResult(call("a", { i: 3 }), result("a", { isError: true }))).toBeUndefined();
    expect(s.onToolResult(call("a", { i: 4 }), result("a", { isError: true }))).toBeUndefined();
    expect(s.onToolResult(call("a", { i: 5 }), result("a", { isError: true }))).toEqual({
      kind: "repeated_error",
      tool: "a",
      count: 3,
      fingerprint: "repeated_error:a",
    });
  });
});

describe("dedup + reset", () => {
  test("reset clears fired fingerprints", () => {
    const s = createFailureSelectors();
    expect(s.onToolResult(call("studiorpc_rollback"), result("studiorpc_rollback"))).toBeDefined();
    expect(s.onToolResult(call("studiorpc_rollback"), result("studiorpc_rollback"))).toBeUndefined();
    s.reset();
    expect(s.onToolResult(call("studiorpc_rollback"), result("studiorpc_rollback"))).toBeDefined();
  });
});
