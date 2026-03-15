// @summary Tests for TurnStager staging message and compaction events

import { describe, expect, test } from "bun:test";
import type { CoreAgentEvent } from "@diligent/core/agent";
import type { Message } from "@diligent/core/types";
import { TurnStager } from "@diligent/runtime/session";

function makeUser(content: string): Message {
  return { role: "user", content, timestamp: Date.now() };
}

describe("TurnStager", () => {
  test("starts with the user message staged", () => {
    const stager = new TurnStager(null, [], makeUser("hello"));
    const snapshot = stager.getSnapshot();

    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]?.type).toBe("message");
    if (snapshot.entries[0]?.type === "message") {
      expect(snapshot.entries[0].message.role).toBe("user");
    }
  });

  test("stages turn_end assistant and tool_result messages in order", () => {
    const stager = new TurnStager(null, [], makeUser("hello"));
    const event: CoreAgentEvent = {
      type: "turn_end",
      turnId: "t1",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        model: "test-model",
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        stopReason: "tool_use",
        timestamp: Date.now(),
      },
      toolResults: [
        {
          role: "tool_result",
          toolCallId: "tc_1",
          toolName: "echo",
          output: "ok",
          isError: false,
          timestamp: Date.now(),
        },
      ],
    };

    stager.handleEvent(event, 20_000);
    const snapshot = stager.getSnapshot();

    expect(snapshot.entries).toHaveLength(3);
    expect(snapshot.entries.map((entry) => entry.type)).toEqual(["message", "message", "message"]);
    if (snapshot.entries[1]?.type === "message" && snapshot.entries[2]?.type === "message") {
      expect(snapshot.entries[1].message.role).toBe("assistant");
      expect(snapshot.entries[2].message.role).toBe("tool_result");
    }
  });

  test("stages compaction entry on compaction_end", () => {
    const stager = new TurnStager(null, [], makeUser("hello"));
    stager.handleEvent(
      {
        type: "compaction_end",
        turnId: "t1",
        summary: "summary",
        tokensBefore: 100,
        tokensAfter: 20,
      },
      20_000,
    );

    const snapshot = stager.getSnapshot();
    expect(snapshot.entries).toHaveLength(2);
    expect(snapshot.entries[1]?.type).toBe("compaction");
  });
});
