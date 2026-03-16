// @summary Tests for transcript store state reduction and rendering-adjacent behavior
import { describe, expect, test } from "bun:test";
import { renderTranscript } from "../src/tui/components/transcript-render";
import { TranscriptStore } from "../src/tui/components/transcript-store";

function stripAnsi(input: string): string {
  let out = "";
  let i = 0;

  while (i < input.length) {
    if (input.charCodeAt(i) === 27 && input[i + 1] === "[") {
      i += 2;
      while (i < input.length) {
        const ch = input[i];
        if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z")) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += input[i];
    i++;
  }

  return out;
}

describe("TranscriptStore", () => {
  test("captures streamed assistant text into transcript items", () => {
    const store = new TranscriptStore({ requestRender: () => {} });

    store.handleEvent({ type: "agent_start" });
    store.handleEvent({ type: "message_start" });
    store.handleEvent({ type: "message_delta", delta: { type: "text_delta", delta: "hello" } });
    store.handleEvent({ type: "message_end" });

    const items = store.getItems();
    expect(items.length).toBe(1);
    expect(items[0]).toMatchObject({ kind: "assistant_chunk", text: "hello", continued: false });
  });

  test("tracks active question independently from transcript items", () => {
    const store = new TranscriptStore({ requestRender: () => {} });
    const question = {
      render: () => ["question"],
      handleInput: (_data: string) => {},
      invalidate: () => {},
    };

    store.setActiveQuestion(question);
    expect(store.hasActiveQuestion()).toBe(true);
    expect(store.getActiveQuestion()).toBe(question);

    store.setActiveQuestion(null);
    expect(store.hasActiveQuestion()).toBe(false);
  });

  test("renders pending steering messages in transcript active stack", () => {
    const store = new TranscriptStore({ requestRender: () => {} });
    store.setPendingSteers(["change approach"]);

    const lines = renderTranscript(store, 80).map(stripAnsi);
    expect(lines.some((line) => line.includes("⚑ change approach"))).toBe(true);
  });

  test("orders live stack so status is below streaming markdown", () => {
    const store = new TranscriptStore({ requestRender: () => {} });
    store.handleEvent({ type: "message_start" });
    store.handleEvent({ type: "message_delta", delta: { type: "text_delta", delta: `${"s".repeat(1100)} streaming` } });
    store.handleEvent({ type: "tool_start", toolName: "plan", toolCallId: "plan_1", input: {} });
    store.setPendingSteers(["change approach"]);
    store.setActiveQuestion({
      render: () => ["question prompt"],
      handleInput: (_data: string) => {},
      invalidate: () => {},
    });

    const lines = renderTranscript(store, 100).map(stripAnsi);
    const statusIndex = lines.findIndex((line) => line.includes("Planning"));
    const steeringIndex = lines.findIndex((line) => line.includes("⚑ change approach"));
    const questionIndex = lines.findIndex((line) => line.includes("question prompt"));

    expect(statusIndex).toBeGreaterThanOrEqual(0);
    expect(steeringIndex).toBeGreaterThan(statusIndex);
    expect(questionIndex).toBeGreaterThan(steeringIndex);
  });

  test("triggers low-frequency periodic re-renders while active status is shown", async () => {
    let renderCount = 0;
    const store = new TranscriptStore({
      requestRender: () => {
        renderCount++;
      },
    });

    store.handleEvent({ type: "agent_start" });
    const afterStart = renderCount;

    await new Promise((resolve) => setTimeout(resolve, 1300));

    expect(afterStart).toBeGreaterThan(0);
    expect(renderCount).toBeGreaterThan(afterStart);
  });

  test("turn_end clears lingering Working status even if pin flag drifted", () => {
    const store = new TranscriptStore({ requestRender: () => {} });

    store.handleEvent({ type: "status_change", status: "busy" });
    store.handleEvent({ type: "status_change", status: "idle" });

    const before = renderTranscript(store, 80).map(stripAnsi);
    expect(before.some((line) => line.includes("Working…"))).toBe(true);

    store.handleEvent({
      type: "turn_end",
      threadId: "t1",
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      cost: 0,
      toolResults: [],
    });

    const after = renderTranscript(store, 80).map(stripAnsi);
    expect(after.some((line) => line.includes("Working…"))).toBe(false);
  });

  test("finishTurn clears lingering Working status without turn_end event", () => {
    const store = new TranscriptStore({ requestRender: () => {} });

    store.handleEvent({ type: "status_change", status: "busy" });
    const before = renderTranscript(store, 80).map(stripAnsi);
    expect(before.some((line) => line.includes("Working…"))).toBe(true);

    store.finishTurn();

    const after = renderTranscript(store, 80).map(stripAnsi);
    expect(after.some((line) => line.includes("Working…"))).toBe(false);
  });

  test("tool_end restores Working status while thread remains busy", () => {
    const store = new TranscriptStore({ requestRender: () => {} });

    store.handleEvent({ type: "status_change", status: "busy" });
    store.handleEvent({ type: "tool_start", toolName: "bash", toolCallId: "t1", input: { command: "echo hi" } });
    store.handleEvent({ type: "tool_end", toolCallId: "t1", toolName: "bash", output: "hi", isError: false });

    const lines = renderTranscript(store, 80).map(stripAnsi);
    const workingIndex = lines.findIndex((line) => line.includes("Working…"));
    expect(workingIndex).toBeGreaterThanOrEqual(0);
    expect(lines[workingIndex + 1]).toBe("");
  });

  test("Complete status omits elapsed time and keeps blank line below", () => {
    const store = new TranscriptStore({ requestRender: () => {} });

    store.handleEvent({ type: "tool_start", toolName: "wait", toolCallId: "t1", input: { ids: ["a1"] } });
    store.handleEvent({ type: "tool_update", toolName: "wait", toolCallId: "t1", partialResult: "Complete" });

    const lines = renderTranscript(store, 80).map(stripAnsi);
    const completeIndex = lines.findIndex((line) => line.includes("Complete"));
    expect(completeIndex).toBeGreaterThanOrEqual(0);
    expect(lines[completeIndex]).not.toMatch(/\([0-9]+(?:\.[0-9]+)?s\)/);
    expect(lines[completeIndex + 1]).toBe("");
  });

  test("idle status after tool_end keeps Working status cleared", () => {
    const store = new TranscriptStore({ requestRender: () => {} });

    store.handleEvent({ type: "status_change", status: "busy" });
    store.handleEvent({ type: "status_change", status: "idle" });
    store.handleEvent({ type: "tool_start", toolName: "bash", toolCallId: "t1", input: { command: "echo hi" } });
    store.handleEvent({ type: "tool_end", toolCallId: "t1", toolName: "bash", output: "hi", isError: false });

    const lines = renderTranscript(store, 80).map(stripAnsi);
    expect(lines.some((line) => line.includes("Working…"))).toBe(false);
  });

  test("read tool result header is renderpayload-first and cwd-relative", () => {
    const store = new TranscriptStore({ requestRender: () => {}, cwd: "/Users/devbv-mini4/git/diligent" });

    store.handleEvent({
      type: "tool_start",
      toolCallId: "read_1",
      toolName: "read",
      input: { file_path: "/Users/devbv-mini4/git/diligent/packages/runtime/src/tools/render-payload.ts" },
    });
    store.handleEvent({
      type: "tool_end",
      toolCallId: "read_1",
      toolName: "read",
      output: "  1\tline one\n  2\tline two",
      isError: false,
    });

    const toolItem = store.getItems().find((item) => item.kind === "tool_result");
    expect(toolItem).toBeDefined();
    if (!toolItem || toolItem.kind !== "tool_result") throw new Error("Expected tool_result item");

    const readHeader = stripAnsi(toolItem.header);
    expect(readHeader).toContain("File — packages/runtime/src/tools/render-payload.ts");
    expect(readHeader).not.toContain("Read — ");
  });
});
