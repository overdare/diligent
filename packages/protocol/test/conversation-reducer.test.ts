// @summary Tests for the shared applyAgentEvents conversation-state reducer
import { describe, expect, test } from "bun:test";
import { applyAgentEvents } from "../src/conversation-reducer";
import { createInitialConversationLiveState } from "../src/conversation-state";
import type { AgentEvent } from "../src/data-model";

function initial() {
  return createInitialConversationLiveState();
}

function apply(events: AgentEvent[]) {
  return applyAgentEvents(initial(), events);
}

describe("applyAgentEvents / status_change", () => {
  test("sets threadStatus to busy and overlayStatus to 'Working…'", () => {
    const next = apply([{ type: "status_change", status: "busy" }]);
    expect(next.threadStatus).toBe("busy");
    expect(next.overlayStatus).toBe("Working…");
  });

  test("clears overlayStatus when transitioning to idle", () => {
    const withBusy = apply([{ type: "status_change", status: "busy" }]);
    const next = applyAgentEvents(withBusy, [{ type: "status_change", status: "idle" }]);
    expect(next.threadStatus).toBe("idle");
    expect(next.overlayStatus).toBeNull();
  });

  test("preserves existing overlayStatus when going idle", () => {
    const state = { ...initial(), overlayStatus: "Working…" };
    const next = applyAgentEvents(state, [{ type: "status_change", status: "idle" }]);
    expect(next.overlayStatus).toBeNull();
  });
});

describe("applyAgentEvents / turn_start", () => {
  test("sets overlayStatus to 'Thinking…'", () => {
    const next = apply([{ type: "turn_start", turnId: "t1" }]);
    expect(next.overlayStatus).toBe("Thinking…");
  });

  test("child turn_start also sets overlayStatus", () => {
    const next = apply([{ type: "turn_start", turnId: "t1", childThreadId: "child-1" }]);
    expect(next.overlayStatus).toBe("Thinking…");
  });
});

describe("applyAgentEvents / message_start", () => {
  test("resets liveText, liveThinking and sets overlayStatus", () => {
    const state = { ...initial(), liveText: "stale", liveThinking: "thinking" };
    const next = applyAgentEvents(state, [
      {
        type: "message_start",
        itemId: "m1",
        message: {
          role: "assistant",
          content: [],
          model: "x",
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          stopReason: "end_turn",
          timestamp: 1,
        },
      },
    ]);
    expect(next.liveText).toBe("");
    expect(next.liveThinking).toBe("");
    expect(next.overlayStatus).toBe("Thinking…");
  });
});

describe("applyAgentEvents / message_delta", () => {
  const baseMessage = {
    role: "assistant" as const,
    content: [],
    model: "x",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    stopReason: "end_turn" as const,
    timestamp: 1,
  };

  test("appends text_delta to liveText and clears overlayStatus", () => {
    const state = { ...initial(), liveText: "hello" };
    const next = applyAgentEvents(state, [
      {
        type: "message_delta",
        itemId: "m1",
        message: baseMessage,
        delta: { type: "text_delta", delta: " world" },
      },
    ]);
    expect(next.liveText).toBe("hello world");
    expect(next.overlayStatus).toBeNull();
  });

  test("appends thinking_delta to liveThinking and keeps overlayStatus 'Thinking…'", () => {
    const next = apply([
      {
        type: "message_delta",
        itemId: "m1",
        message: baseMessage,
        delta: { type: "thinking_delta", delta: "hmm" },
      },
    ]);
    expect(next.liveThinking).toBe("hmm");
    expect(next.overlayStatus).toBe("Thinking…");
  });

  test("accumulates multiple text_delta events", () => {
    const events: AgentEvent[] = [
      { type: "message_delta", itemId: "m1", message: baseMessage, delta: { type: "text_delta", delta: "a" } },
      { type: "message_delta", itemId: "m1", message: baseMessage, delta: { type: "text_delta", delta: "b" } },
      { type: "message_delta", itemId: "m1", message: baseMessage, delta: { type: "text_delta", delta: "c" } },
    ];
    expect(apply(events).liveText).toBe("abc");
  });
});

describe("applyAgentEvents / message_end", () => {
  test("clears liveText and liveThinking", () => {
    const state = { ...initial(), liveText: "hi", liveThinking: "hmm" };
    const next = applyAgentEvents(state, [
      {
        type: "message_end",
        itemId: "m1",
        message: {
          role: "assistant",
          content: [],
          model: "x",
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          stopReason: "end_turn",
          timestamp: 2,
        },
      },
    ]);
    expect(next.liveText).toBe("");
    expect(next.liveThinking).toBe("");
  });

  test("clears overlayStatus when no live tool is active", () => {
    const state = { ...initial(), overlayStatus: "Thinking…", liveToolName: null };
    const next = applyAgentEvents(state, [
      {
        type: "message_end",
        itemId: "m1",
        message: {
          role: "assistant",
          content: [],
          model: "x",
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          stopReason: "end_turn",
          timestamp: 2,
        },
      },
    ]);
    expect(next.overlayStatus).toBeNull();
  });

  test("preserves overlayStatus when a live tool is active", () => {
    const state = { ...initial(), overlayStatus: "bash…", liveToolName: "bash" };
    const next = applyAgentEvents(state, [
      {
        type: "message_end",
        itemId: "m1",
        message: {
          role: "assistant",
          content: [],
          model: "x",
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          stopReason: "end_turn",
          timestamp: 2,
        },
      },
    ]);
    expect(next.overlayStatus).toBe("bash…");
  });
});

describe("applyAgentEvents / tool_start", () => {
  test("sets liveToolName, liveToolInput and overlayStatus from inputSummary", () => {
    const next = apply([
      {
        type: "tool_start",
        itemId: "t1",
        toolCallId: "tc1",
        toolName: "bash",
        input: { command: "ls" },
        render: { inputSummary: "ls -la" },
      },
    ]);
    expect(next.liveToolName).toBe("bash");
    expect(next.liveToolInput).toBe("ls -la");
    expect(next.liveToolOutput).toBe("");
    expect(next.overlayStatus).toBe("ls -la…");
  });

  test("falls back to toolName in overlayStatus when no inputSummary", () => {
    const next = apply([
      {
        type: "tool_start",
        itemId: "t1",
        toolCallId: "tc1",
        toolName: "read",
        input: { file_path: "/tmp/a.ts" },
      },
    ]);
    expect(next.liveToolName).toBe("read");
    expect(next.overlayStatus).toBe("read…");
  });

  test("uses JSON-stringified input when input is an object and no render", () => {
    const next = apply([
      {
        type: "tool_start",
        itemId: "t1",
        toolCallId: "tc1",
        toolName: "bash",
        input: { command: "echo hi" },
      },
    ]);
    expect(next.liveToolInput).toBe(JSON.stringify({ command: "echo hi" }, null, 2));
  });
});

describe("applyAgentEvents / tool_update", () => {
  test("appends partialResult to liveToolOutput", () => {
    const state = { ...initial(), liveToolOutput: "line1\n", liveToolName: "bash", liveToolInput: "ls" };
    const next = applyAgentEvents(state, [
      { type: "tool_update", itemId: "t1", toolCallId: "tc1", toolName: "bash", partialResult: "line2\n" },
    ]);
    expect(next.liveToolOutput).toBe("line1\nline2\n");
    expect(next.overlayStatus).toBe("ls…");
  });

  test("updates overlayStatus to liveToolInput when input is present", () => {
    const state = { ...initial(), liveToolInput: "find /" };
    const next = applyAgentEvents(state, [
      { type: "tool_update", itemId: "t1", toolCallId: "tc1", toolName: "bash", partialResult: "x" },
    ]);
    expect(next.overlayStatus).toBe("find /…");
  });
});

describe("applyAgentEvents / tool_end", () => {
  test("clears live tool fields and overlayStatus", () => {
    const state = {
      ...initial(),
      liveToolName: "bash",
      liveToolInput: "ls",
      liveToolOutput: "file.ts\n",
      overlayStatus: "ls…",
    };
    const next = applyAgentEvents(state, [
      {
        type: "tool_end",
        itemId: "t1",
        toolCallId: "tc1",
        toolName: "bash",
        output: "file.ts\n",
        isError: false,
      },
    ]);
    expect(next.liveToolName).toBeNull();
    expect(next.liveToolInput).toBeNull();
    expect(next.liveToolOutput).toBe("");
    expect(next.overlayStatus).toBeNull();
  });
});

describe("applyAgentEvents / compaction", () => {
  test("compaction_start sets overlayStatus to 'Compacting…'", () => {
    const next = apply([{ type: "compaction_start", estimatedTokens: 1000 }]);
    expect(next.overlayStatus).toBe("Compacting…");
  });

  test("compaction_end clears overlayStatus", () => {
    const state = { ...initial(), overlayStatus: "Compacting…" };
    const next = applyAgentEvents(state, [
      { type: "compaction_end", tokensBefore: 2000, tokensAfter: 800, summary: "Compacted." },
    ]);
    expect(next.overlayStatus).toBeNull();
  });
});

describe("applyAgentEvents / error", () => {
  test("clears all live streaming fields", () => {
    const state = {
      ...initial(),
      liveText: "partial",
      liveThinking: "hmm",
      liveToolName: "bash",
      liveToolInput: "ls",
      liveToolOutput: "output",
      overlayStatus: "Running…",
    };
    const next = applyAgentEvents(state, [{ type: "error", error: { message: "Oops", name: "Error" }, fatal: false }]);
    expect(next.liveText).toBe("");
    expect(next.liveThinking).toBe("");
    expect(next.liveToolName).toBeNull();
    expect(next.liveToolInput).toBeNull();
    expect(next.liveToolOutput).toBe("");
    expect(next.overlayStatus).toBeNull();
  });
});

describe("applyAgentEvents / generic type preservation", () => {
  test("preserves concrete subtype fields through all events", () => {
    interface ExtendedState extends ReturnType<typeof createInitialConversationLiveState> {
      myExtra: string;
    }
    const extended: ExtendedState = { ...initial(), myExtra: "preserved" };
    const next = applyAgentEvents(extended, [{ type: "status_change", status: "busy" }]);
    expect(next.myExtra).toBe("preserved");
    expect(next.threadStatus).toBe("busy");
  });
});

describe("applyAgentEvents / multi-event batch", () => {
  test("processes events in order within a single batch", () => {
    const baseMessage = {
      role: "assistant" as const,
      content: [],
      model: "x",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      stopReason: "end_turn" as const,
      timestamp: 1,
    };
    const events: AgentEvent[] = [
      { type: "turn_start", turnId: "t1" },
      { type: "message_start", itemId: "m1", message: baseMessage },
      { type: "message_delta", itemId: "m1", message: baseMessage, delta: { type: "text_delta", delta: "hi" } },
    ];
    const next = apply(events);
    expect(next.overlayStatus).toBeNull();
    expect(next.liveText).toBe("hi");
  });

  test("empty event array returns equivalent state", () => {
    const state = { ...initial(), liveText: "existing" };
    const next = applyAgentEvents(state, []);
    expect(next.liveText).toBe("existing");
  });
});
