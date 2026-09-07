// @summary Verifies schema-independent JSON upserts while preserving structural safety.
import { describe, expect, test } from "bun:test";
import { parseArgs } from "../../../../src/tools/studiorpc/methods/instance.upsert";

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
  test("preserves singleton creation protection", () => {
    expect(() => parseArgs({ items: [{ class: "Workspace", parentGuid: "p", name: "n" }] })).toThrow(/Service/);
  });
});
