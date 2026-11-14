// @summary Tests Anthropic root-composition compatibility without losing model-visible constraints
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { convertTools } from "../../../../src/llm/provider/anthropic";
import { type ObjectJsonSchema, toToolInputSchema } from "../../../../src/tool/input-schema";

describe("convertTools function schemas", () => {
  function schemaOf(inputSchema: ObjectJsonSchema): Record<string, unknown> {
    const tools = convertTools([{ kind: "function", name: "t", description: "d", inputSchema }]);
    return (tools?.[0] as { input_schema: Record<string, unknown> }).input_schema;
  }

  test.each(["anyOf", "oneOf", "allOf"])("moves root %s constraints into the schema description", (keyword) => {
    const branches = [
      { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
      { type: "object", properties: { b: { type: "number" } }, required: ["b"] },
    ];
    const input = Object.freeze({
      type: "object" as const,
      description: "Choose the appropriate arguments.",
      properties: { requestId: { type: "string" } },
      required: ["requestId"],
      [keyword]: branches,
    });
    const schema = schemaOf(input);

    expect(schema.type).toBe("object");
    expect(schema).not.toHaveProperty(keyword);
    expect(schema.description).toContain(input.description);
    expect(schema.description).toContain(`${keyword}: ${JSON.stringify(branches)}`);
    expect(schema.properties).toEqual(input.properties);
    expect(schema.required).toEqual(["requestId"]);
    // Branch-only arguments must remain possible; do not turn this into a closed empty object.
    expect(schema.additionalProperties).not.toBe(false);
    expect(input[keyword]).toEqual(branches);
    expect(input.description).toBe("Choose the appropriate arguments.");
  });

  test("retains nested compositions and properties named after composition keywords", () => {
    const nested = {
      type: "object",
      properties: {
        anyOf: { anyOf: [{ type: "string" }, { type: "number" }] },
        oneOf: { oneOf: [{ type: "string" }, { type: "boolean" }] },
        allOf: { allOf: [{ type: "number" }, { minimum: 1 }] },
      },
      required: ["anyOf"],
      additionalProperties: false,
    };
    const schema = schemaOf({
      type: "object",
      properties: { nested },
      anyOf: [{ required: ["nested"] }],
    });

    expect(schema).not.toHaveProperty("anyOf");
    expect(schema.properties).toEqual({ nested });
  });

  test("spills every root composition when multiple keywords coexist without a description", () => {
    const anyOf = [{ required: ["a"] }, { required: ["b"] }];
    const oneOf = [{ required: ["x"] }, { required: ["y"] }];
    const allOf = [{ required: ["id"] }];
    const schema = schemaOf({ type: "object", anyOf, oneOf, allOf });

    for (const [keyword, branches] of Object.entries({ anyOf, oneOf, allOf })) {
      expect(schema).not.toHaveProperty(keyword);
      expect(schema.description).toContain(`${keyword}: ${JSON.stringify(branches)}`);
    }
  });

  test("preserves Zod union branches and their references as guidance without mutating the canonical schema", () => {
    const name = z.string().min(1);
    const parameters = z.discriminatedUnion("operation", [
      z.object({ operation: z.literal("read"), name }).strict(),
      z.object({ operation: z.literal("write"), name, content: z.string() }).strict(),
    ]);
    const canonical = toToolInputSchema({ parameters });
    const original = JSON.stringify(canonical);
    const schema = schemaOf(Object.freeze(canonical));

    expect(schema).not.toHaveProperty("anyOf");
    expect(schema.description).toContain(JSON.stringify(canonical.anyOf));
    expect(JSON.stringify(canonical)).toBe(original);
    expect(schema.additionalProperties).not.toBe(false);
  });
});
