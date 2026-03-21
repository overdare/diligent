// @summary Verifies batched instance upsert parsing and normalization.
import { describe, expect, test } from "bun:test";
import { isUpdateItem, normalizeArgsToOperations, parseArgs } from "../../src/methods/instance.upsert.ts";

describe("instance.upsert args", () => {
  test("parses add items without explicit mode", () => {
    const parsed = parseArgs({
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

    expect(normalizeArgsToOperations(parsed)).toEqual([
      {
        mode: "add",
        item: {
          class: "Folder",
          parentGuid: "ROOT",
          name: "Enemies",
          properties: {},
        },
      },
      {
        mode: "add",
        item: {
          class: "Folder",
          parentGuid: "ROOT",
          name: "Props",
          properties: {},
        },
      },
    ]);
  });

  test("parses update items without explicit mode", () => {
    const parsed = parseArgs({
      items: [
        {
          guid: "GUID_A",
          name: "UpdatedA",
          properties: { Name: "UpdatedA" },
        },
        {
          guid: "GUID_B",
          properties: { Visible: false },
        },
      ],
    });

    expect(normalizeArgsToOperations(parsed)).toEqual([
      {
        mode: "update",
        item: {
          guid: "GUID_A",
          name: "UpdatedA",
          properties: { Name: "UpdatedA" },
        },
      },
      {
        mode: "update",
        item: {
          guid: "GUID_B",
          properties: { Visible: false },
        },
      },
    ]);
  });

  test("supports mixed add and update items in one batch", () => {
    const parsed = parseArgs({
      items: [
        {
          guid: "GUID_A",
          name: "UpdatedA",
          properties: { Name: "UpdatedA" },
        },
        {
          class: "Folder",
          parentGuid: "ROOT",
          name: "Props",
          properties: {},
        },
      ],
    });

    expect(isUpdateItem(parsed.items[0])).toBe(true);
    expect(isUpdateItem(parsed.items[1])).toBe(false);
    expect(normalizeArgsToOperations(parsed)).toEqual([
      {
        mode: "update",
        item: {
          guid: "GUID_A",
          name: "UpdatedA",
          properties: { Name: "UpdatedA" },
        },
      },
      {
        mode: "add",
        item: {
          class: "Folder",
          parentGuid: "ROOT",
          name: "Props",
          properties: {},
        },
      },
    ]);
  });

  test("rejects legacy mode wrapper", () => {
    expect(() =>
      parseArgs({
        mode: "add",
        items: [
          {
            class: "Folder",
            parentGuid: "ROOT",
            name: "Enemies",
            properties: {},
          },
        ],
      }),
    ).toThrow();
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
