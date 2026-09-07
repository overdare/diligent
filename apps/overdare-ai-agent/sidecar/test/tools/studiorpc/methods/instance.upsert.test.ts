// @summary Verifies schema-independent JSON upserts while preserving structural safety.
import { describe, expect, test } from "bun:test";
import { params, parseArgs } from "../../../../src/tools/studiorpc/methods/instance.upsert";

describe("instance.upsert live schema properties", () => {
  test("accepts future classes and properties without rewriting Studio JSON", () => {
    const item = {
      class: "FutureWidget",
      parentGuid: "workspace",
      name: "Future",
      properties: { FutureValue: { ObjectType: "FutureType", Value: 42 }, Text: "server validates class membership" },
    };
    expect(parseArgs({ items: [item] })).toEqual({ items: [item] });
  });
  test("keeps patch values and does not inject defaults", () => {
    expect(parseArgs({ items: [{ guid: "widget", properties: { FutureValue: 0 } }] })).toEqual({
      items: [{ guid: "widget", properties: { FutureValue: 0 } }],
    });
  });
  test("rejects malformed envelopes and non-object properties", () => {
    for (const item of [
      { class: "", parentGuid: "p", name: "n" },
      { class: "Part", name: "n" },
      { guid: "", properties: {} },
      { guid: "p", properties: [] },
      { guid: "p", properties: null },
      { guid: "p", unknown: true },
    ]) {
      expect(() => parseArgs({ items: [item] })).toThrow();
    }
  });
  test("rejects identity and hierarchy keys inside properties", () => {
    for (const key of [
      "ActorGuid",
      "ObjectKey",
      "InstanceType",
      "LuaChildren",
      "Name",
      "Parent",
      "__proto__",
      "constructor",
      "prototype",
    ]) {
      const properties = JSON.parse(`{"${key}":"overwrite"}`);
      expect(() => parseArgs({ items: [{ guid: "p", properties }] })).toThrow();
    }
  });
  test("schema validation rejects reserved keys before record parsing can omit them", () => {
    for (const key of ["__proto__", "ActorGuid", "Name", "constructor", "prototype"]) {
      const properties = JSON.parse(`{"${key}":"overwrite"}`);
      for (const item of [
        { guid: "p", properties },
        { class: "FutureClass", parentGuid: "p", name: "n", properties },
      ]) {
        const result = params.safeParse({ items: [item] });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues.some((issue) => issue.path.join(".") === `items.0.properties.${key}`)).toBe(true);
        }
      }
    }
  });
  test("normalizes omitted properties through the same public schema", () => {
    const input = { items: [{ class: "FutureClass", parentGuid: "p", name: "n" }, { guid: "p" }] };
    const expected = { items: input.items.map((item) => ({ ...item, properties: {} })) };
    expect(params.parse(input)).toEqual(expected);
    expect(parseArgs(input)).toEqual(expected);
  });
  test("the public schema rejects singleton creation too", () => {
    expect(params.safeParse({ items: [{ class: "Workspace", parentGuid: "p", name: "n" }] }).success).toBe(false);
  });
  test("preserves singleton creation protection", () => {
    expect(() => parseArgs({ items: [{ class: "Workspace", parentGuid: "p", name: "n" }] })).toThrow(/Service/);
  });
});
