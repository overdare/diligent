// @summary Tests conversion of protocol history items into transcript store items
import { describe, expect, test } from "bun:test";
import { appendHistoryItems } from "../../../src/tui/components/history-items";
import { ThreadStore } from "../../../src/tui/components/thread-store";
import { renderCommittedTranscriptItems } from "../../../src/tui/components/transcript-render";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

describe("appendHistoryItems userMessage", () => {
  test("uses string content and joins only text blocks from array content, skipping blank text", () => {
    const store = new ThreadStore({ requestRender: () => {} });
    appendHistoryItems(store, [
      { type: "userMessage", message: { role: "user", content: "plain string" } },
      {
        type: "userMessage",
        message: {
          role: "user",
          content: [
            { type: "text", text: "part1" },
            { type: "image", source: { type: "base64", mediaType: "image/png", data: "AA==" } },
            { type: "text", text: "part2" },
          ],
        },
      },
      { type: "userMessage", message: { role: "user", content: [{ type: "text", text: "   " }] } },
      { type: "userMessage", message: { role: "user", content: [] } },
    ] as never);

    expect(store.getItems()).toHaveLength(2);
    const text = renderCommittedTranscriptItems(store.getItems(), 80).map(stripAnsi).join("\n");
    expect(text).toContain("plain string");
    expect(text).toContain("part1part2");
  });
});
