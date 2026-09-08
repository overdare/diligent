// @summary Regressions for expanded tool output fallbacks and input deduplication
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantMessage } from "../../../../src/web/client/components/AssistantMessage";
import { ToolBlock } from "../../../../src/web/client/components/ToolBlock";
import type { RenderItem } from "../../../../src/web/client/lib/thread-store";

const tool: Extract<RenderItem, { kind: "tool" }> = {
  id: "rpc",
  kind: "tool",
  toolName: "studiorpc",
  inputText: '{\n  "query": ["template"]\n}',
  outputText: "RPC diagnostic details",
  isError: true,
  status: "done",
  timestamp: 1,
  toolCallId: "rpc",
  startedAt: 1,
};

test("expanded tool preserves raw error output when only a start render remains", () => {
  const html = renderToStaticMarkup(
    <ToolBlock initialOpen item={{ ...tool, render: { inputSummary: "query", blocks: [] } }} />,
  );
  expect(html).toContain("RPC diagnostic details");
});

test("expanded RPC renders equivalent JSON input only once", () => {
  const html = renderToStaticMarkup(
    <ToolBlock
      initialOpen
      item={{
        ...tool,
        render: {
          blocks: [
            { type: "text", title: "Input", text: '{"query":["template"]}' },
            { type: "text", title: "Output", text: tool.outputText },
          ],
        },
      }}
    />,
  );
  expect((html.match(/>Input</g) ?? []).length).toBe(1);
  expect(html).toContain("RPC diagnostic details");
});

test("different input remains visible beside structured output", () => {
  const html = renderToStaticMarkup(
    <ToolBlock
      initialOpen
      item={{ ...tool, render: { blocks: [{ type: "text", title: "Output", text: tool.outputText }] } }}
    />,
  );
  expect(html).toContain("template");
  expect(html).toContain("RPC diagnostic details");
});

test("thinking-only messages do not reserve a following response or report gap", () => {
  const html = renderToStaticMarkup(
    <AssistantMessage
      onReport={() => {}}
      item={{
        id: "thinking",
        kind: "assistant",
        messageId: "thinking",
        text: "",
        thinking: "Inspecting output",
        contentBlocks: [],
        thinkingDone: true,
        isStreaming: false,
        timestamp: 1,
      }}
    />,
  );
  expect(html).toContain("Inspecting output");
  expect(html).not.toMatch(/class="pb-\d+"/);
  expect(html).not.toContain("Report response");
});

test("empty render preserves the available input summary and raw output", () => {
  const html = renderToStaticMarkup(
    <ToolBlock
      initialOpen
      item={{ ...tool, inputText: "", render: { inputSummary: "Inspect template", blocks: [] } }}
    />,
  );
  expect(html).toContain("Inspect template");
  expect(html).toContain("RPC diagnostic details");
});

for (const render of [undefined, { blocks: [{ type: "text" as const, text: "Loaded image pixel.png" }] }]) {
  test(`tool image preview appears with ${render ? "structured" : "fallback"} output`, () => {
    const html = renderToStaticMarkup(
      <ToolBlock
        item={{
          ...tool,
          toolName: "read_image",
          isError: false,
          outputText: "Loaded image pixel.png",
          render,
          outputImages: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } }],
        }}
      />,
    );
    expect(html).toContain("<img");
    expect(html).toContain('src="data:image/png;base64,aGVsbG8="');
    expect(html).toContain("Loaded image pixel.png");
  });
}
