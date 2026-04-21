import { describe, expect, test } from "bun:test";
import { ToolRenderPayloadSchema } from "../../../../../packages/protocol/src/data-model.ts";
import { buildSearchRender } from "../src/render.ts";

function expectProtocolRenderPayload(payload: unknown): void {
  const parsed = ToolRenderPayloadSchema.safeParse(payload);
  expect(parsed.success).toBe(true);
}

describe("buildSearchRender", () => {
  test("adds a file preview block for code results", () => {
    const payload = buildSearchRender({ source: "code", query: "remote event" }, [
      {
        text: "local snippet summary",
        originFileUrl: "https://storage.googleapis.com/lua-script-bucket/example.lua",
        script: "local RemoteEvent = {}\nreturn RemoteEvent",
      },
    ]);

    expectProtocolRenderPayload(payload);
    expect(payload.outputSummary).toBe("1 code match");

    expect(payload.blocks.some((block) => block.type === "table")).toBe(true);
    expect(payload.blocks).toContainEqual({
      type: "file",
      filePath: "https://storage.googleapis.com/lua-script-bucket/example.lua",
      content: "local RemoteEvent = {}\nreturn RemoteEvent",
    });
  });

  test("adds structured top asset details for asset results", () => {
    const payload = buildSearchRender({ source: "assets", query: "sword" }, [
      {
        text: "A fantasy sword asset",
        score: 0.91,
        title: "Silver Sword",
        keywords: ["weapon", "fantasy"],
        assetId: "ovdrassetid://123",
        assetType: "MODEL",
        categoryId: "Items",
        subCategoryId: "Weapons",
      },
    ] as never[]);

    expectProtocolRenderPayload(payload);
    expect(payload.outputSummary).toBe("1 asset");

    expect(payload.blocks.some((block) => block.type === "table")).toBe(true);
    expect(payload.blocks).toContainEqual({
      type: "key_value",
      title: "Top asset",
      items: [
        { key: "title", value: "Silver Sword" },
        { key: "assetId", value: "ovdrassetid://123" },
        { key: "assetType", value: "MODEL" },
        { key: "category", value: "Items" },
        { key: "subcategory", value: "Weapons" },
        { key: "score", value: "0.91" },
      ],
    });
    expect(payload.blocks).toContainEqual({
      type: "text",
      title: "Top asset details",
      text: "A fantasy sword asset",
    });
    expect(payload.blocks).toContainEqual({
      type: "text",
      title: "Top asset keywords",
      text: "weapon, fantasy",
    });
  });

  test("uses source-aware document summaries", () => {
    const payload = buildSearchRender({ source: "docs", query: "remote event" }, [
      {
        text: "RemoteEvent guide",
        originFileUrl: "https://storage.googleapis.com/ovdr-docs-bucket/remote-event.md",
      },
    ]);

    expectProtocolRenderPayload(payload);
    expect(payload.inputSummary).toBe("docs: remote event");
    expect(payload.outputSummary).toBe("1 document match");
  });
});
