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
    expect(items[0]?.constructor.name).toBe("MarkdownView");
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

    const lines = renderTranscript(store, 80);
    expect(lines.some((line) => line.includes("⚑ steering change approach"))).toBe(true);
  });

  test("orders live stack by priority (status -> steering -> markdown -> question)", () => {
    const store = new TranscriptStore({ requestRender: () => {} });
    store.handleEvent({ type: "message_start" });
    store.handleEvent({ type: "message_delta", delta: { type: "text_delta", delta: "streaming" } });
    store.handleEvent({ type: "tool_start", toolName: "plan", toolCallId: "plan_1", input: {} });
    store.setPendingSteers(["change approach"]);
    store.setActiveQuestion({
      render: () => ["question prompt"],
      handleInput: (_data: string) => {},
      invalidate: () => {},
    });

    const lines = renderTranscript(store, 100).map(stripAnsi);
    const statusIndex = lines.findIndex((line) => line.includes("Planning"));
    const steeringIndex = lines.findIndex((line) => line.includes("⚑ steering change approach"));
    const markdownIndex = lines.findIndex((line) => line.includes("⏺ streaming"));
    const questionIndex = lines.findIndex((line) => line.includes("question prompt"));

    expect(statusIndex).toBeGreaterThanOrEqual(0);
    expect(steeringIndex).toBeGreaterThan(statusIndex);
    expect(markdownIndex).toBeGreaterThan(steeringIndex);
    expect(questionIndex).toBeGreaterThan(markdownIndex);
  });
});
