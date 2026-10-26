// @summary Tests Responses schema compatibility shared by OpenAI and ChatGPT
import { describe, expect, test } from "bun:test";
import { buildTools } from "../../../../src/llm/provider/openai/responses";
import type { ObjectJsonSchema } from "../../../../src/tool/input-schema";

describe("Responses tool schemas", () => {
  function schemaOf(inputSchema: ObjectJsonSchema, strict?: boolean): Record<string, unknown> {
    const tool = buildTools([{ kind: "function", name: "example", description: "Example", inputSchema }], strict)[0];
    if (!tool || tool.type !== "function") throw new Error("Expected a function tool");
    return tool.parameters;
  }

  test.each([false, undefined])("rewrites schema oneOf without rewriting literal data (strict=%s)", (strict) => {
    const literal = { oneOf: [{ type: "object" }] };
    const source: ObjectJsonSchema = {
      type: "object",
      properties: {
        oneOf: { type: "array", items: { oneOf: [{ type: "string" }, { type: "number" }] } },
        data: { const: literal, default: literal, examples: [literal], enum: [literal] },
      },
    };
    const before = JSON.stringify(source);
    const schema = schemaOf(source, strict);
    expect(schema.properties).toEqual({
      oneOf: { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }] } },
      data: { const: literal, default: literal, examples: [literal], enum: [literal] },
    });
    expect(JSON.stringify(source)).toBe(before);
  });

  test("adds properties to object and nullable-object nodes without closing open maps", () => {
    const schema = schemaOf({
      type: "object",
      additionalProperties: {
        type: ["object", "null"],
        additionalProperties: { type: "string" },
      },
      $defs: { empty: { type: "object" } },
    });
    expect(schema).toEqual({
      type: "object",
      properties: {},
      additionalProperties: {
        type: ["object", "null"],
        properties: {},
        additionalProperties: { type: "string" },
      },
      $defs: { empty: { type: "object", properties: {} } },
    });
  });

  test("retains alternatives and retargets local references when oneOf moves next to an existing anyOf", () => {
    const schema = schemaOf({
      type: "object",
      properties: {
        "a/b": {
          anyOf: [{ type: "boolean" }],
          oneOf: [{ type: "array", items: { oneOf: [{ type: "string" }, { type: "number" }] } }],
        },
        copy: { $ref: "#/properties/a~1b/oneOf/0/items/oneOf/1" },
        named: { $ref: "#/$defs/oneOf" },
      },
      $defs: { oneOf: { type: "string" } },
    });
    expect(schema.properties).toEqual({
      "a/b": {
        anyOf: [{ type: "boolean" }, { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }] } }],
      },
      copy: { $ref: "#/properties/a~1b/anyOf/1/items/anyOf/1" },
      named: { $ref: "#/$defs/oneOf" },
    });
  });
});
