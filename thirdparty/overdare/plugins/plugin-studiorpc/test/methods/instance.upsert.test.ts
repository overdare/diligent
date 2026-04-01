// @summary Verifies batched instance upsert parsing and normalization.
import { describe, expect, test } from "bun:test";
import { collectUiDiagnostics, isUpdateItem, parseArgs } from "../../src/methods/instance.upsert.ts";

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

describe("collectUiDiagnostics", () => {
  test("ignores fullscreen overlays in higher ZIndex bands when checking reserved mobile HUD zones", () => {
    const root = {
      ActorGuid: "ROOT",
      Name: "Root",
      LuaChildren: [
        {
          ActorGuid: "SCREEN_GUI",
          InstanceType: "ScreenGui",
          Name: "RootGui",
          LuaChildren: [
            {
              ActorGuid: "LOADING_FRAME",
              InstanceType: "Frame",
              Name: "LoadingOverlay",
              ZIndex: 100,
              Position: {
                X: { Scale: 0, Offset: 0 },
                Y: { Scale: 0, Offset: 0 },
              },
              Size: {
                X: { Scale: 1, Offset: 0 },
                Y: { Scale: 1, Offset: 0 },
              },
              BackgroundTransparency: 0,
            },
          ],
        },
      ],
    };

    const diag = collectUiDiagnostics(root);

    expect(diag.warnings).toEqual([]);
    expect(diag.info).toEqual([]);
  });

  test("checks overlap only inside the same ZIndex band", () => {
    const root = {
      ActorGuid: "ROOT",
      Name: "Root",
      LuaChildren: [
        {
          ActorGuid: "SCREEN_GUI",
          InstanceType: "ScreenGui",
          Name: "RootGui",
          LuaChildren: [
            {
              ActorGuid: "BASE_BUTTON_A",
              InstanceType: "TextButton",
              Name: "ActionA",
              ZIndex: 10,
              Position: {
                X: { Scale: 0, Offset: 600 },
                Y: { Scale: 0, Offset: 200 },
              },
              Size: {
                X: { Scale: 0, Offset: 120 },
                Y: { Scale: 0, Offset: 120 },
              },
            },
            {
              ActorGuid: "BASE_BUTTON_B",
              InstanceType: "TextButton",
              Name: "ActionB",
              ZIndex: 90,
              Position: {
                X: { Scale: 0, Offset: 650 },
                Y: { Scale: 0, Offset: 220 },
              },
              Size: {
                X: { Scale: 0, Offset: 120 },
                Y: { Scale: 0, Offset: 120 },
              },
            },
            {
              ActorGuid: "OVERLAY_BUTTON",
              InstanceType: "TextButton",
              Name: "OverlayButton",
              ZIndex: 110,
              Position: {
                X: { Scale: 0, Offset: 650 },
                Y: { Scale: 0, Offset: 220 },
              },
              Size: {
                X: { Scale: 0, Offset: 120 },
                Y: { Scale: 0, Offset: 120 },
              },
            },
          ],
        },
      ],
    };

    const diag = collectUiDiagnostics(root);

    expect(diag.warnings).toHaveLength(1);
    expect(diag.warnings[0]).toContain("ActionA");
    expect(diag.warnings[0]).toContain("ActionB");
    expect(diag.warnings[0]).toContain("ZIndex band 0 (0-99)");
    expect(diag.warnings[0]).not.toContain("OverlayButton");
  });
});
