// @summary Tests Anthropic root-composition projection without generated schema descriptions
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { convertTools } from "../../../../src/llm/provider/anthropic";
import { type ObjectJsonSchema, toToolInputSchema } from "../../../../src/tool/input-schema";

describe("convertTools function schemas", () => {
  function schemaOf(inputSchema: ObjectJsonSchema): Record<string, unknown> {
    const tools = convertTools([{ kind: "function", name: "t", description: "d", inputSchema }]);
    return (tools?.[0] as { input_schema: Record<string, unknown> }).input_schema;
  }

  test.each([
    "anyOf",
    "oneOf",
    "allOf",
  ])("projects root %s arguments without appending schema internals to descriptions", (keyword) => {
    const branches = [
      { type: "object", properties: { a: { type: "string", description: "Text to write." } }, required: ["a"] },
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
    expect(schema.description).toBe(input.description);
    expect(schema.properties).toEqual({
      a: { type: "string", description: "Text to write." },
      b: { type: "number" },
      requestId: { type: "string" },
    });
    expect(new Set(schema.required as string[])).toEqual(
      new Set(keyword === "allOf" ? ["a", "b", "requestId"] : ["requestId"]),
    );
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
    expect(schema.description).toBeUndefined();
  });

  test("removes simultaneous root compositions without generating a description", () => {
    const anyOf = [{ required: ["a"] }, { required: ["b"] }];
    const oneOf = [{ required: ["x"] }, { required: ["y"] }];
    const allOf = [{ required: ["id"] }];
    const properties = Object.fromEntries(["a", "b", "x", "y", "id"].map((name) => [name, { type: "string" }]));
    const schema = schemaOf({ type: "object", properties, anyOf, oneOf, allOf });

    for (const keyword of ["anyOf", "oneOf", "allOf"]) expect(schema).not.toHaveProperty(keyword);
    expect(schema.description).toBeUndefined();
    expect(schema.properties).toEqual(properties);
    expect(schema.required).toEqual(["id"]);
  });

  test("keeps Zod union arguments and authored descriptions while resolving moved references", () => {
    const name = z.string().min(1).describe("Entry name.");
    const parameters = z.discriminatedUnion("operation", [
      z.object({ operation: z.literal("read"), name }).strict(),
      z.object({ operation: z.literal("write"), name, content: z.string() }).strict(),
    ]);
    const canonical = toToolInputSchema({ parameters });
    const original = JSON.stringify(canonical);
    const schema = schemaOf(Object.freeze(canonical));

    expect(schema).not.toHaveProperty("anyOf");
    expect(schema.description).toBeUndefined();
    expect(schema.properties).toEqual({
      operation: {
        anyOf: [
          { type: "string", const: "read" },
          { type: "string", const: "write" },
        ],
      },
      name: { type: "string", minLength: 1, description: "Entry name." },
      content: { type: "string" },
    });
    expect(schema.required).toEqual(["operation", "name"]);
    expect(schema.additionalProperties).toBe(false);
    expect(JSON.stringify(canonical)).toBe(original);
  });

  test("projects object alternatives when the root object type already excludes nullable branches", () => {
    const schema = schemaOf({
      type: "object",
      anyOf: [{ type: "object", properties: { path: { type: "string" } }, required: ["path"] }, { type: "null" }],
    });
    expect(schema).not.toHaveProperty("anyOf");
    expect(schema.properties).toEqual({ path: { type: "string" } });
    expect(schema.required).toEqual(["path"]);
    expect(schema.description).toBeUndefined();
  });
});
