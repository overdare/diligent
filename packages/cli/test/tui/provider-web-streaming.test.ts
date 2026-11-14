// @summary Tests live TUI rendering for provider-native web content block deltas
import { describe, expect, test } from "bun:test";
import type { AgentEvent, AssistantMessage } from "@diligent/protocol";
import { ThreadStore } from "../../src/tui/components/thread-store";

function makeAssistantMessage(): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    model: "test-model",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    stopReason: "end_turn",
    timestamp: 1,
  };
}

describe("ThreadStore provider-native web live streaming", () => {
  test("renders provider-native web block lines on message_delta before message_end", () => {
    const store = new ThreadStore({ requestRender: () => {} });
    const message = makeAssistantMessage();

    store.handleEvent({ type: "message_start", itemId: "msg-1", message });
    store.handleEvent({
      type: "message_delta",
      itemId: "msg-1",
      message,
      delta: {
        type: "content_block_delta",
        block: {
          type: "provider_tool_use",
          id: "ws_1",
          provider: "openai",
          name: "web_search",
          input: { type: "search", query: "diligent" },
        },
      },
    } satisfies AgentEvent);

    const toolItems = store.getItems().filter((item) => item.kind === "tool_result");
    expect(toolItems).toHaveLength(1);
    const toolItem = toolItems[0];
    expect(toolItem && toolItem.kind === "tool_result" ? toolItem.header : "").toContain("Web Action");
    expect(toolItem && toolItem.kind === "tool_result" ? toolItem.summaryLine : "").toContain("Searched diligent");
  });
});
