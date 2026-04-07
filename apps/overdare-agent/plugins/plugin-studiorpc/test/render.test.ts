// @summary Tests Studio RPC render builders and custom tool render payloads.
import { describe, expect, test } from "bun:test";
import { ToolRenderPayloadSchema } from "../../../../../packages/protocol/src/data-model.ts";
import {
  buildDeleteRender,
  buildInstanceDeleteRender,
  buildInstanceMoveRender,
  buildInstanceReadRender,
  buildInstanceUpsertRender,
} from "../src/render.ts";

describe("plugin-studiorpc render builders", () => {
  test("instance read render matches protocol schema", () => {
    const payload = buildInstanceReadRender({ guid: "ABC", recursive: true }, '{"guid":"ABC"}');
    const parsed = ToolRenderPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    expect(payload.blocks[0]).toMatchObject({ type: "key_value", title: "Studio instance read" });
  });

  test("instance upsert render matches protocol schema", () => {
    const payload = buildInstanceUpsertRender(
      {
        items: [
          { class: "Folder", parentGuid: "PARENT", name: "Added" },
          { guid: "GUID1", name: "Updated", properties: {} },
        ],
      },
      "OK",
    );
    const parsed = ToolRenderPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    expect(payload.inputSummary).toContain("add");
    expect(payload.inputSummary).toContain("update");
  });

  test("instance move render matches protocol schema", () => {
    const payload = buildInstanceMoveRender(
      {
        items: [
          { guid: "A", parentGuid: "P1" },
          { guid: "B", parentGuid: "P2" },
        ],
      },
      "Moved successfully.",
    );
    const parsed = ToolRenderPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    expect(payload.blocks[0]).toMatchObject({ type: "key_value", title: "Studio instance move" });
    expect(payload.outputSummary).toBe("Moved successfully.");
  });

  test("delete render matches protocol schema", () => {
    const payload = buildDeleteRender("Studio instance delete", '["A","B"]', "Deleted.");
    const parsed = ToolRenderPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    expect(payload.blocks[1]).toMatchObject({ type: "summary", tone: "warning" });
  });

  test("falls back to friendly summary when output is JSON", () => {
    const payload = buildDeleteRender("Studio instance delete", '["A"]', '{\n  "ok": true\n}');
    expect(payload.outputSummary).toBe("Deleted.");
    expect(payload.blocks[1]).toMatchObject({ type: "summary", text: "Deleted." });
  });

  test("falls back to friendly summary when output starts with custom tags", () => {
    const payload = buildInstanceUpsertRender(
      { items: [{ class: "Folder", parentGuid: "PARENT", name: "Added" }] },
      '<added-instances>\n<instance name="Added" class="Folder" guid="GUID" />\n</added-instances>',
    );
    expect(payload.outputSummary).toBe("Instances upserted.");
    expect(payload.blocks[1]).toMatchObject({ type: "summary", text: "Instances upserted." });
  });

  test("instance delete input summary shows target guids instead of raw guid JSON", () => {
    const payload = buildInstanceDeleteRender(
      { items: [{ targetGuid: "A" }, { targetGuid: "B" }] },
      '{\n  "ok": true\n}',
    );
    expect(payload.inputSummary).toBe("delete A, B");
    expect(payload.blocks[0]).toMatchObject({
      type: "key_value",
      title: "Studio instance delete",
      items: [
        { key: "deletes", value: "2" },
        { key: "target1", value: "A" },
        { key: "target2", value: "B" },
      ],
    });
  });

  test("instance delete input summary truncates long target lists", () => {
    const payload = buildInstanceDeleteRender(
      { items: [{ targetGuid: "A" }, { targetGuid: "B" }, { targetGuid: "C" }] },
      "Deleted.",
    );
    expect(payload.inputSummary).toBe("delete A, B +1");
  });
});
