// @summary Guards ChatGPT-compatible draft schemas while retaining native recipe ID validation.
import { describe, expect, test } from "bun:test";
import { toToolInputSchema } from "@diligent/core/tool-contract";
import { params } from "../../../../src/tools/studiorpc/methods/proceduralmodel.run";

describe("proceduralmodel.run schema compatibility", () => {
  test("the model-facing schema does not emit JavaScript Unicode property escapes without their flags", () => {
    const schema = toToolInputSchema({ parameters: params });
    expect(schema.type).toBe("object");
    expect(JSON.stringify(schema)).not.toContain("\\p{");
    const branches = schema.anyOf as Array<{ properties: { id: Record<string, unknown> } }>;
    expect(branches[0]?.properties.id).toMatchObject({ type: "string", minLength: 1, maxLength: 64 });
  });

  test.each([
    "draft-1",
    "_draft",
    "-draft",
    "draft.v2",
    "초안",
    "模型2",
    "ébauche",
  ])("local validation preserves the native ID character contract for %s", (id) => {
    expect(params.parse({ id })).toEqual({ id });
    expect(params.parse({ id, code: "print('draft')" })).toEqual({ id, code: "print('draft')" });
  });

  test.each([
    "",
    ".hidden",
    "../escape",
    "path/name",
    "path\\name",
    "name space",
    "x".repeat(65),
  ])("unsafe or invalid recipe ID %s remains rejected before execution", (id) => {
    expect(params.safeParse({ id }).success).toBe(false);
    expect(params.safeParse({ id, code: "print('draft')" }).success).toBe(false);
  });
});
