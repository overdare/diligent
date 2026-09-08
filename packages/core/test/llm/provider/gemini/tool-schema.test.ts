// @summary Tests Gemini-specific normalization of complex function schemas.
import { describe, expect, test } from "bun:test";
import { normalizeGeminiToolSchema } from "../../../../src/llm/provider/gemini/tool-schema";

describe("normalizeGeminiToolSchema", () => {
  test("leaves a schema unchanged while it is within the complexity budget", () => {
    const schema = { type: "object", properties: { value: { type: "string" } } };

    expect(normalizeGeminiToolSchema(schema)).toBe(schema);
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
