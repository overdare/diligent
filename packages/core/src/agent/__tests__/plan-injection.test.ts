// @summary Tests for plan state injection into LLM message context
import { describe, expect, test } from "bun:test";
import type { Message, ToolResultMessage, UserMessage } from "../../types";
import { extractLatestPlanState, withPlanStateInjected } from "../loop";

function userMsg(content: string, ts = 1000): UserMessage {
  return { role: "user", content, timestamp: ts };
}

function planToolResult(steps: Array<{ text: string; done: boolean }>, title = "Plan", ts = 2000): ToolResultMessage {
  return {
    role: "tool_result",
    toolCallId: "tc-1",
    toolName: "plan",
    output: JSON.stringify({ title, steps }),
    isError: false,
    timestamp: ts,
  };
}

function otherToolResult(name = "bash", output = "ok", ts = 2000): ToolResultMessage {
  return {
    role: "tool_result",
    toolCallId: "tc-2",
    toolName: name,
    output,
    isError: false,
    timestamp: ts,
  };
}

describe("extractLatestPlanState", () => {
  test("returns null for empty messages", () => {
    expect(extractLatestPlanState([])).toBeNull();
  });

  test("returns null when no plan tool_result exists", () => {
    const messages: Message[] = [userMsg("hello"), otherToolResult()];
    expect(extractLatestPlanState(messages)).toBeNull();
  });

  test("returns only remaining (not-done) steps", () => {
    const messages: Message[] = [
      userMsg("make a plan"),
      planToolResult([
        { text: "Step 1", done: true },
        { text: "Step 2", done: false },
        { text: "Step 3", done: false },
      ]),
    ];
    const result = extractLatestPlanState(messages);
    expect(result).toBe("[Plan (2 remaining)]\n- Step 2\n- Step 3");
  });

  test("returns null when all steps are done", () => {
    const messages: Message[] = [
      userMsg("plan"),
      planToolResult([
        { text: "Step 1", done: true },
        { text: "Step 2", done: true },
      ]),
    ];
    expect(extractLatestPlanState(messages)).toBeNull();
  });

  test("extracts the LATEST plan when multiple exist", () => {
    const messages: Message[] = [
      userMsg("plan"),
      planToolResult([{ text: "Old step", done: false }], "Old Plan", 1000),
      userMsg("update plan"),
      planToolResult(
        [
          { text: "Old step", done: true },
          { text: "New step", done: false },
        ],
        "Updated Plan",
        3000,
      ),
    ];
    const result = extractLatestPlanState(messages);
    expect(result).toBe("[Plan (1 remaining)]\n- New step");
  });

  test("uses custom title", () => {
    const messages: Message[] = [planToolResult([{ text: "Do thing", done: false }], "My Custom Plan")];
    const result = extractLatestPlanState(messages);
    expect(result).toBe("[Plan (1 remaining)]\n- Do thing");
  });

  test("returns null for invalid JSON in plan output", () => {
    const messages: Message[] = [
      {
        role: "tool_result",
        toolCallId: "tc-1",
        toolName: "plan",
        output: "not json",
        isError: false,
        timestamp: 1000,
      },
    ];
    expect(extractLatestPlanState(messages)).toBeNull();
  });
});

describe("withPlanStateInjected", () => {
  test("returns same array for empty messages", () => {
    const messages: Message[] = [];
    expect(withPlanStateInjected(messages)).toBe(messages);
  });

  test("returns same array when no plan exists", () => {
    const messages: Message[] = [userMsg("hello")];
    const result = withPlanStateInjected(messages);
    expect(result).toBe(messages);
  });

  test("returns same array when all steps are done (no remaining)", () => {
    const messages: Message[] = [
      userMsg("plan"),
      planToolResult([
        { text: "Done A", done: true },
        { text: "Done B", done: true },
      ]),
      userMsg("what now?"),
    ];
    const result = withPlanStateInjected(messages);
    expect(result).toBe(messages);
  });

  test("injects only remaining steps before last message", () => {
    const messages: Message[] = [
      userMsg("make a plan"),
      planToolResult([
        { text: "Step A", done: true },
        { text: "Step B", done: false },
        { text: "Step C", done: false },
      ]),
      userMsg("next step please"),
    ];
    const result = withPlanStateInjected(messages);

    // Should have one more message than original
    expect(result.length).toBe(messages.length + 1);

    // Plan state should be second-to-last
    const planMsg = result[result.length - 2];
    expect(planMsg.role).toBe("user");
    const content = (planMsg as UserMessage).content as string;
    expect(content).toBe("[Plan (2 remaining)]\n- Step B\n- Step C");

    // Last message should be the original user message
    const lastMsg = result[result.length - 1];
    expect(lastMsg.role).toBe("user");
    expect((lastMsg as UserMessage).content).toBe("next step please");
  });

  test("does NOT inject when last message is tool_result", () => {
    const messages: Message[] = [
      userMsg("plan"),
      planToolResult([{ text: "Step 1", done: false }]),
      otherToolResult("bash", "done"),
    ];
    const result = withPlanStateInjected(messages);
    expect(result).toBe(messages);
  });

  test("does not mutate original messages array", () => {
    const messages: Message[] = [
      userMsg("plan"),
      planToolResult([{ text: "Step 1", done: false }]),
      userMsg("continue"),
    ];
    const originalLength = messages.length;
    withPlanStateInjected(messages);
    expect(messages.length).toBe(originalLength);
  });
});
