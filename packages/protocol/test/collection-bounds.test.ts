// @summary Oversized attachment collections are rejected before validating their elements.
import { describe, expect, test } from "bun:test";
import { TurnStartParamsSchema, TurnSteerParamsSchema } from "../src/client-requests";

describe("attachment collection bounds", () => {
  for (const [name, schema, params] of [
    ["turn/start", TurnStartParamsSchema, { message: "hello" }],
    ["turn/steer", TurnSteerParamsSchema, { content: "hello" }],
  ] as const) {
    test(`${name} rejects an oversized collection without walking invalid attachments`, () => {
      let reads = 0;
      const attachment = {
        get type() {
          reads += 1;
          return "invalid";
        },
      };

      const result = schema.safeParse({ ...params, attachments: Array(32).fill(attachment) });

      expect(result.success).toBe(false);
      if (result.success) throw new Error("Oversized attachments were accepted");
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0]).toMatchObject({ code: "too_big", path: ["attachments"] });
      expect(reads).toBe(0);
    });
  }
});
