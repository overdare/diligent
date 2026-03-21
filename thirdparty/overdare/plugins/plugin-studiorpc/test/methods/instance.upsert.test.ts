// @summary Verifies batched instance upsert parsing and normalization.
import { describe, expect, test } from "bun:test";
import { isBatchArgs, normalizeArgsToBatch, parseArgs } from "../../src/methods/instance.upsert.ts";

describe("instance.upsert args", () => {
  test("parses batch add input", () => {
    const parsed = parseArgs({
      mode: "add",
      items: [
        {
          class: "Folder",
          parentGuid: "ROOT",
          name: "Enemies",
          properties: {},
        },
        {
          class: "Folder",
          parentGuid: "ROOT",
          name: "Props",
          properties: {},
        },
      ],
    });

    expect(isBatchArgs(parsed)).toBe(true);
    expect(normalizeArgsToBatch(parsed)).toEqual({
      mode: "add",
      items: [
        {
          class: "Folder",
          parentGuid: "ROOT",
          name: "Enemies",
          properties: {},
        },
        {
          class: "Folder",
          parentGuid: "ROOT",
          name: "Props",
          properties: {},
        },
      ],
    });
  });

  test("parses batch update input", () => {
    const parsed = parseArgs({
      mode: "update",
      items: [
        {
          guid: "GUID_A",
          properties: { Name: "UpdatedA" },
        },
        {
          guid: "GUID_B",
          properties: { Visible: false },
        },
      ],
    });

    expect(isBatchArgs(parsed)).toBe(true);
    expect(normalizeArgsToBatch(parsed)).toEqual({
      mode: "update",
      items: [
        {
          guid: "GUID_A",
          properties: { Name: "UpdatedA" },
        },
        {
          guid: "GUID_B",
          properties: { Visible: false },
        },
      ],
    });
  });

  test("rejects legacy single-item input", () => {
    expect(() =>
      parseArgs({
        class: "Folder",
        parentGuid: "ROOT",
        name: "Enemies",
        properties: {},
      }),
    ).toThrow();
  });
});
