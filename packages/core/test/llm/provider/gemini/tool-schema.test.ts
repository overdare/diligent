// @summary Tests Gemini-specific normalization of complex function schemas.
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { normalizeGeminiToolSchema } from "../../../../src/llm/provider/gemini/tool-schema";
import { toToolInputSchema } from "../../../../src/tool/input-schema";

describe("normalizeGeminiToolSchema", () => {
  test.each(["anyOf", "oneOf", "allOf"])("folds root %s without dropping sibling properties or requirements", (key) => {
    const schema = normalizeGeminiToolSchema({
      type: "object",
      properties: { requestId: { type: "string" } },
      required: ["requestId"],
      [key]: [
        { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
        { type: "object", properties: { count: { type: "number" } }, required: ["count"] },
      ],
    });

    expect(schema).not.toHaveProperty(key);
    expect(schema.properties).toEqual({
      name: { type: "string" },
      count: { type: "number" },
      requestId: { type: "string" },
    });
    expect(new Set(schema.required as string[])).toEqual(
      new Set(key === "allOf" ? ["name", "count", "requestId"] : ["requestId"]),
    );
  });

  test("dereferences shared Zod fields before relocating root union branches, even below the size budget", () => {
    const name = z.string().min(1);
    const canonical = toToolInputSchema({
      parameters: z.union([z.object({ name, content: z.string() }).strict(), z.object({ name }).strict()]),
    });
    const original = JSON.stringify(canonical);
    const schema = normalizeGeminiToolSchema(canonical);

    expect(schema.properties).toEqual({
      name: { type: "string", minLength: 1 },
      content: { type: "string" },
    });
    expect(schema.required).toEqual(["name"]);
    expect(JSON.stringify(schema)).not.toContain("$ref");
    expect(JSON.stringify(canonical)).toBe(original);
  });

  test("resolves ordinary local references without interpreting property names or literal payloads as schemas", () => {
    const literal = { $ref: "#/$defs/value", anyOf: [{ type: "object" }] };
    const schema = normalizeGeminiToolSchema({
      type: "object",
      $defs: { value: { type: "string", minLength: 2 } },
      properties: {
        definitions: { $ref: "#/$defs/value" },
        $defs: { $ref: "#/$defs/value", description: "A property, not definitions." },
        payload: { const: literal, default: literal },
      },
    });

    expect(schema.properties).toEqual({
      definitions: { type: "string", minLength: 2 },
      $defs: { type: "string", minLength: 2, description: "A property, not definitions." },
      payload: { const: literal, default: literal },
    });
  });

  test("dereferences and flattens oversized object unions while retaining property variants", () => {
    const schema = {
      type: "object",
      properties: {
        sharedShape: {
          type: "object",
          properties: { X: { type: "number", description: "Horizontal component." } },
        },
        items: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "object",
                description: "Create variant.",
                properties: {
                  kind: { type: "string", enum: ["create"] },
                  value: { $ref: "#/properties/sharedShape" },
                },
                required: ["kind", "value"],
                additionalProperties: false,
              },
              {
                type: "object",
                description: "Update variant.",
                properties: {
                  kind: { type: "string", enum: ["update"] },
                  value: { type: "string", description: "Replacement value." },
                  force: { type: "boolean" },
                },
                required: ["kind", "value"],
                additionalProperties: false,
              },
            ],
          },
        },
      },
    };

    const normalized = normalizeGeminiToolSchema(schema, 0) as {
      properties: {
        items: {
          items: {
            type: string;
            properties: Record<string, Record<string, unknown>>;
            required: string[];
          };
        };
      };
    };
    const itemSchema = normalized.properties.items.items;

    expect(itemSchema.type).toBe("object");
    expect(itemSchema.required).toEqual(["kind", "value"]);
    expect(itemSchema.properties.force).toEqual({ type: "boolean" });
    expect(itemSchema.properties.kind.anyOf).toEqual(expect.any(Array));
    expect(itemSchema.properties.value.anyOf).toEqual(expect.any(Array));
    expect(JSON.stringify(normalized)).not.toContain("$ref");
  });

  test("caps sibling properties until an oversized schema fits the budget", () => {
    const schema = {
      type: "object",
      properties: Object.fromEntries(
        Array.from({ length: 600 }, (_, index) => [
          `property${index}`,
          { type: "string", description: "d".repeat(120) },
        ]),
      ),
      required: ["property0", "property599"],
    };
    expect(JSON.stringify(schema).length).toBeGreaterThan(32_000);

    const normalized = normalizeGeminiToolSchema(schema) as {
      properties: Record<string, unknown>;
      required: string[];
    };

    expect(JSON.stringify(normalized).length).toBeLessThanOrEqual(32_000);
    expect(Object.keys(normalized.properties)).toContain("property0");
    expect(Object.keys(normalized.properties)).not.toContain("property599");
    expect(normalized.required).toEqual(["property0"]);
  });
});
