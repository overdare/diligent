// @summary Tests rendering helpers for provider-native assistant web blocks in TUI
import { describe, expect, test } from "bun:test";
import {
  renderAssistantMessageBlocks,
  renderAssistantStructuredItems,
} from "../../../src/tui/components/thread-store-utils";

describe("renderAssistantMessageBlocks", () => {
  test("renders provider-native web blocks and citations into plain transcript lines", () => {
    const rendered = renderAssistantMessageBlocks({
      content: [
        {
          type: "provider_tool_use",
          id: "ws_1",
          provider: "openai",
          name: "web_search",
          input: { type: "search", query: "diligent" },
        },
        {
          type: "web_search_result",
          toolUseId: "ws_1",
          provider: "openai",
          results: [{ url: "https://example.com", title: "Example" }],
        },
        {
          type: "text",
          text: "Found it.",
          citations: [
            { type: "web_search_result_location", url: "https://example.com", title: "Example", citedText: "Found" },
          ],
        },
      ],
    } as never);

    expect(rendered.text).toBe("Found it.");
    expect(rendered.extras).toEqual(expect.arrayContaining([expect.stringContaining("[source] Example")]));
  });

  test("renders provider-native web blocks into tool_result items", () => {
    const items = renderAssistantStructuredItems({
      content: [
        {
          type: "provider_tool_use",
          id: "ws_1",
          provider: "openai",
          name: "web_search",
          input: { type: "search", query: "diligent" },
        },
        {
          type: "web_search_result",
          toolUseId: "ws_1",
          provider: "openai",
          results: [{ url: "https://example.com", title: "Example" }],
        },
      ],
    } as never);

    const toolItems = items.filter((item) => item.kind === "tool_result");
    expect(toolItems).toHaveLength(2);
    expect(toolItems[0] && toolItems[0].kind === "tool_result" ? toolItems[0].summaryLine : "").toContain(
      "Searched diligent",
    );
    expect(toolItems[1] && toolItems[1].kind === "tool_result" ? toolItems[1].details.join("\n") : "").toContain(
      "Found 1 result",
    );
  });
});
