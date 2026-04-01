// @summary Verifies batched instance upsert parsing and normalization.
import { describe, expect, test } from "bun:test";
import { isUpdateItem, parseArgs } from "../../src/methods/instance.upsert.ts";

const folderDefaultProperties = {
  Anchored: true,
  CanCollide: true,
  CanQuery: true,
  CanTouch: true,
};

const modelDefaultProperties = {
  Active: true,
};

describe("instance.upsert args", () => {
  test("parses Outline and Fill class properties", () => {
    const parsed = parseArgs({
      items: [
        {
          class: "Outline",
          parentGuid: "ROOT",
          name: "EnemyOutline",
          properties: {
            Color: { R: 255, G: 0, B: 0 },
            Thickness: 2,
            Enabled: true,
          },
        },
        {
          class: "Fill",
          parentGuid: "ROOT",
          name: "EnemyFill",
          properties: {
            Color: { R: 255, G: 255, B: 0 },
            DepthMode: "AlwaysOnTop",
            Transparency: 0.4,
          },
        },
      ],
    });

    expect(parsed.items).toEqual([
      {
        class: "Outline",
        parentGuid: "ROOT",
        name: "EnemyOutline",
        properties: {
          Color: { R: 255, G: 0, B: 0 },
          Thickness: 2,
          Enabled: true,
        },
      },
      {
        class: "Fill",
        parentGuid: "ROOT",
        name: "EnemyFill",
        properties: {
          Color: { R: 255, G: 255, B: 0 },
          DepthMode: "AlwaysOnTop",
          Transparency: 0.4,
        },
      },
    ]);
  });

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

    expect(parsed.items).toEqual([
      {
        class: "Folder",
        parentGuid: "ROOT",
        name: "Enemies",
        properties: folderDefaultProperties,
      },
      {
        class: "Folder",
        parentGuid: "ROOT",
        name: "Props",
        properties: folderDefaultProperties,
      },
    ]);
  });

  test("parses update items without explicit mode", () => {
    const parsed = parseArgs({
      items: [
        {
          guid: "GUID_A",
          name: "UpdatedA",
          properties: {},
        },
        {
          guid: "GUID_B",
          properties: { Visible: false },
        },
      ],
    });

    expect(parsed.items).toEqual([
      {
        guid: "GUID_A",
        name: "UpdatedA",
        properties: folderDefaultProperties,
      },
      {
        guid: "GUID_B",
        properties: { ...modelDefaultProperties, Visible: false },
      },
    ]);
  });

  test("supports mixed add and update items in one batch", () => {
    const parsed = parseArgs({
      items: [
        {
          guid: "GUID_A",
          name: "UpdatedA",
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

    expect(isUpdateItem(parsed.items[0])).toBe(true);
    expect(isUpdateItem(parsed.items[1])).toBe(false);
    expect(parsed.items).toEqual([
      {
        guid: "GUID_A",
        name: "UpdatedA",
        properties: folderDefaultProperties,
      },
      {
        class: "Folder",
        parentGuid: "ROOT",
        name: "Props",
        properties: folderDefaultProperties,
      },
    ]);
  });

  test("infers item mode by guid presence", () => {
    const parsed = parseArgs({
      items: [
        {
          guid: "GUID_A",
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

    expect(parsed.items.map((item) => (isUpdateItem(item) ? "update" : "add"))).toEqual(["update", "add"]);
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
