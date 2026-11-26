// @summary Tests for rendering JSON Schema object nodes into code mode TypeScript declarations
import { describe, expect, test } from "bun:test";
import { renderJsonSchemaType } from "../../../src/tools/code-mode/description";

describe("renderJsonSchemaType objects", () => {
  test("an object without properties renders its additionalProperties schema as the record value", () => {
    expect(renderJsonSchemaType({ type: "object", additionalProperties: { type: "number" } })).toBe(
      "Record<string, number>",
    );
    expect(renderJsonSchemaType({ type: "object", properties: {}, additionalProperties: { type: "string" } })).toBe(
      "Record<string, string>",
    );
  });

  test("an object without properties and without a schema-valued additionalProperties is an unknown record", () => {
    expect(renderJsonSchemaType({ type: "object" })).toBe("Record<string, unknown>");
    expect(renderJsonSchemaType({ type: "object", additionalProperties: true })).toBe("Record<string, unknown>");
    expect(renderJsonSchemaType({ type: "object", properties: null, additionalProperties: false })).toBe(
      "Record<string, unknown>",
    );
  });

  test("properties render with optional markers, quoted keys, and only non-empty string descriptions", () => {
    const rendered = renderJsonSchemaType({
      type: "object",
      required: ["a"],
      properties: {
        a: { type: "string", description: "  first\n  value */ " },
        "b-c": { type: "number", description: "" },
        d: { type: "boolean", description: 5 },
      },
    });
    expect(rendered).toBe('{\n  /** first value * / */\n  a: string;\n  "b-c"?: number;\n  d?: boolean;\n}');
  });
});
