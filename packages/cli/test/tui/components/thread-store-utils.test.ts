// @summary Tests rendering helpers for provider-native assistant web blocks in TUI
import { describe, expect, test } from "bun:test";
import { UserMessageView } from "../../../src/tui/components/thread-store-primitives";
import {
  buildChildDetailLines,
  buildThinkingItem,
  buildToolEndItem,
  dedupeTextCitations,
  deriveToolStartState,
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

describe("citation dedupe across fragmented text blocks", () => {
  test("joins fragmented cited text and dedupes repeated sources", () => {
    const rendered = renderAssistantMessageBlocks({
      content: [
        { type: "text", text: "Competing with Acme" },
        {
          type: "text",
          text: ", the flywheel is key",
          citations: [{ type: "web_search_result_location", url: "https://a.example", title: "A", citedText: "x" }],
        },
        {
          type: "text",
          text: ".",
          citations: [
            { type: "web_search_result_location", url: "https://a.example", title: "A", citedText: "y" },
            { type: "web_search_result_location", url: "https://b.example", title: "B" },
          ],
        },
      ],
    } as never);

    expect(rendered.text).toBe("Competing with Acme, the flywheel is key.");
    const sourceLines = rendered.extras.filter((line) => line.includes("[source]"));
    expect(sourceLines).toHaveLength(2);
    expect(sourceLines[0]).toContain("A");
    expect(sourceLines[1]).toContain("B");
  });

  test("renderAssistantStructuredItems emits one deduped citation item per message", () => {
    const items = renderAssistantStructuredItems({
      content: [
        {
          type: "text",
          text: "claim one",
          citations: [{ type: "web_search_result_location", url: "https://a.example", title: "A" }],
        },
        {
          type: "text",
          text: "claim two",
          citations: [{ type: "web_search_result_location", url: "https://a.example", title: "A" }],
        },
      ],
    } as never);

    const plainItems = items.filter((item) => item.kind === "plain");
    expect(plainItems).toHaveLength(1);
    const lines = plainItems[0]?.kind === "plain" ? plainItems[0].lines : [];
    expect(lines.filter((line) => line.includes("[source]"))).toHaveLength(1);
  });
});

function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

describe("buildChildDetailLines", () => {
  test("labels tool calls error, running, or done by isError and output presence", () => {
    const lines = buildChildDetailLines({
      items: [
        { type: "toolCall", toolName: "errTool", isError: true, output: "boom" },
        { type: "toolCall", toolName: "runTool", isError: false },
        { type: "toolCall", toolName: "emptyTool", isError: false, output: "" },
      ],
    } as never).map(strip);
    expect(lines).toContain("    tool: errTool (error)");
    expect(lines).toContain("    tool: runTool (running)");
    expect(lines).toContain("    tool: emptyTool (done)");
    expect(lines).toContain("    assistant=0, tools=3");
  });
});

describe("dedupeTextCitations", () => {
  test("dedupes web citations by url and document citations by index and range", () => {
    const web1 = { type: "web_search_result_location", url: "https://a", title: "A", citedText: "x" };
    const web2 = { type: "web_search_result_location", url: "https://a", title: "Other", citedText: "y" };
    const web3 = { type: "web_search_result_location", url: "https://b", title: "B", citedText: "z" };
    const doc1 = { type: "char_location", documentIndex: 0, startCharIndex: 1, endCharIndex: 5, citedText: "q" };
    const doc2 = { type: "char_location", documentIndex: 0, startCharIndex: 1, endCharIndex: 5, citedText: "r" };
    const doc3 = { type: "char_location", documentIndex: 0, startCharIndex: 1, endCharIndex: 6, citedText: "s" };
    const doc4 = { type: "char_location", documentIndex: 1, startCharIndex: 1, endCharIndex: 5, citedText: "t" };
    const result = dedupeTextCitations([web1, web2, web3, doc1, doc2, doc3, doc4] as never);
    expect(result).toEqual([web1, web3, doc1, doc3, doc4] as never);
  });
});

describe("buildThinkingItem", () => {
  test("header includes elapsed time only when elapsedMs is defined, including 0", () => {
    const withTime = buildThinkingItem("a\nb", 2500);
    const zero = buildThinkingItem("a", 0);
    const without = buildThinkingItem("a");
    if (withTime.kind !== "thinking" || zero.kind !== "thinking" || without.kind !== "thinking") {
      throw new Error("expected thinking");
    }
    expect(strip(withTime.header)).toMatch(/^⏺ Thought for \S+$/);
    expect(strip(zero.header)).toMatch(/^⏺ Thought for \S+$/);
    expect(strip(without.header)).toBe("⏺ Thought");
    expect(withTime.bodyLines).toEqual(["a", "b"]);
  });
});

describe("deriveToolStartState spawn_agent", () => {
  const opts = { planCallCount: 0, collabAgentNamesByThreadId: {} };
  const spawn = (input: unknown) =>
    deriveToolStartState({ type: "tool_start", toolCallId: "c", toolName: "spawn_agent", input } as never, opts);

  test("prefers description over prompt summary", () => {
    const state = spawn({ agent_type: "explore", description: "find it", message: "do things" });
    expect(state.overlayMessage).toBe("Spawning [explore] find it…");
    expect(state.collabState?.prompt).toBe("do things");
  });

  test("uses first prompt line truncated to 72 chars with ellipsis when long", () => {
    const long = `${"x".repeat(80)}\nsecond`;
    const state = spawn({ message: long });
    expect(state.overlayMessage).toBe(`Spawning [general] ${"x".repeat(72)}…`);
    expect(state.collabState?.prompt).toBe(long);
  });

  test("short prompt has no ellipsis", () => {
    expect(spawn({ message: "  hi there  " }).overlayMessage).toBe("Spawning [general] hi there");
  });

  test("falls back to bare label with no description or prompt", () => {
    const state = spawn({ description: "", message: "" });
    expect(state.overlayMessage).toBe("Spawning [general]…");
    expect(state.collabState?.prompt).toBeUndefined();
  });
});

describe("buildToolEndItem", () => {
  const base = { planCallCount: 0, collabAgentNamesByThreadId: {}, nowMs: 0 };

  test("plan steps render done, in_progress, and pending checks", () => {
    const output = JSON.stringify({
      title: "My Plan",
      steps: [
        { text: "one", status: "done" },
        { text: "two", status: "in_progress" },
        { text: "three", status: "pending" },
        { text: "four", done: true },
        { text: "five" },
      ],
    });
    const { item, planCallCount } = buildToolEndItem({
      ...base,
      event: { type: "tool_end", toolCallId: "p", toolName: "plan", output, isError: false } as never,
    });
    if (item instanceof UserMessageView || item.kind !== "plain") throw new Error("expected plain");
    expect(item.lines.map(strip)).toEqual(["⏺ My Plan", "  ☑ one", "  ▶ two", "  ☐ three", "  ☑ four", "  ☐ five"]);
    expect(planCallCount).toBe(1);
  });

  test("background (inactive parent) plain item prefixes only the first line", () => {
    const output = JSON.stringify({ steps: [{ text: "one", status: "pending" }] });
    const { item } = buildToolEndItem({
      ...base,
      parentActive: false,
      event: {
        type: "tool_end",
        toolCallId: "p",
        toolName: "plan",
        output,
        isError: false,
        parentToolCallId: "exec1",
      } as never,
    });
    if (item instanceof UserMessageView || item.kind !== "plain") throw new Error("expected plain");
    expect(item.lines.map(strip)).toEqual(["↳ script · ⏺ Plan", "  ☐ one"]);
  });

  test("background tool_result item prefixes header", () => {
    const { item } = buildToolEndItem({
      ...base,
      event: {
        type: "tool_end",
        toolCallId: "b",
        toolName: "bash",
        output: "ok",
        isError: false,
        parentToolCallId: "exec1",
      } as never,
    });
    if (item instanceof UserMessageView || item.kind !== "tool_result") throw new Error("expected tool_result");
    expect(strip(item.header).startsWith("↳ script · ")).toBe(true);
  });

  test("nested (active parent) plain item gutters every line", () => {
    const output = JSON.stringify({ steps: [{ text: "one", status: "pending" }] });
    const { item } = buildToolEndItem({
      ...base,
      parentActive: true,
      event: {
        type: "tool_end",
        toolCallId: "p",
        toolName: "plan",
        output,
        isError: false,
        parentToolCallId: "exec1",
      } as never,
    });
    if (item instanceof UserMessageView || item.kind !== "plain") throw new Error("expected plain");
    expect(item.lines.map(strip)).toEqual(["  │ ⏺ Plan", "  │   ☐ one"]);
  });
});
