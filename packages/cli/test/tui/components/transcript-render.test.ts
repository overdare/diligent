// @summary Tests transcript rendering of thinking and tool_result items in committed and sectioned output
import { describe, expect, test } from "bun:test";
import { ThreadStore } from "../../../src/tui/components/thread-store";
import {
  renderCommittedTranscriptItems,
  renderTranscriptSections,
} from "../../../src/tui/components/transcript-render";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

describe("renderCommittedTranscriptItems", () => {
  test("thinking item renders header alone without body and indented body otherwise", () => {
    const lines = renderCommittedTranscriptItems(
      [
        { kind: "thinking", header: "H1", bodyLines: [] },
        { kind: "plain", lines: ["sep"] },
        { kind: "thinking", header: "H2", bodyLines: ["a", "b"] },
      ],
      80,
    ).map(stripAnsi);
    expect(lines.filter((line) => line !== "")).toEqual(["H1", "sep", "H2", "  a", "  b"]);
  });

  test("tool_result hint reflects expanded state", () => {
    const item = { kind: "tool_result" as const, header: "TOOL", details: ["d1"] };
    const collapsed = renderCommittedTranscriptItems([item], 80, { toolResultsExpanded: false }).map(stripAnsi);
    const expanded = renderCommittedTranscriptItems([item], 80, { toolResultsExpanded: true }).map(stripAnsi);
    expect(collapsed[0]).toBe("TOOL (ctrl+o to expand)");
    expect(expanded[0]).toBe("TOOL (ctrl+o to collapse)");
    expect(expanded).toContain("d1");
  });
});

describe("renderTranscriptSections", () => {
  test("tool_result hint follows store expansion toggle", () => {
    const store = new ThreadStore({ requestRender: () => {} });
    store.addStructuredItem({ kind: "tool_result", header: "TOOL", details: ["d1"] });

    const collapsed = renderTranscriptSections(store, 80).historyLines.map(stripAnsi);
    expect(collapsed).toContain("TOOL (ctrl+o to expand)");
    expect(collapsed).not.toContain("d1");

    store.toggleToolResultsCollapsed();
    const expanded = renderTranscriptSections(store, 80).historyLines.map(stripAnsi);
    expect(expanded).toContain("TOOL (ctrl+o to collapse)");
    expect(expanded).toContain("d1");
  });
});
