// @summary Covers authored UI layout diagnostics without requiring a Studio connection.
import { describe, expect, test } from "bun:test";
import { inspectUiLayout, type UiLayoutScreen } from "../../../../src/tools/studiorpc/tools/ui-layout-diagnostics";

function udim2(x: number, y: number, width: number, height: number) {
  return {
    Position: { X: { Scale: 0, Offset: x }, Y: { Scale: 0, Offset: y } },
    Size: { X: { Scale: 0, Offset: width }, Y: { Scale: 0, Offset: height } },
  };
}

function node(
  InstanceType: string,
  Name: string,
  ActorGuid: string,
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Record<string, unknown> = {},
) {
  return { InstanceType, Name, ActorGuid, ...udim2(x, y, width, height), ...extra };
}

function screen(children: unknown[]): UiLayoutScreen {
  return {
    path: "StarterGui.Hud",
    root: { InstanceType: "ScreenGui", Name: "Hud", ActorGuid: "screen", LuaChildren: children },
  };
}

describe("inspectUiLayout", () => {
  test("reports reserved controls and removes a confirmed hidden jump button", () => {
    const input = screen([
      node("ImageButton", "JumpAction", "jump", 1100, 400, 100, 100),
      node("ImageButton", "MoveAction", "move", 100, 400, 100, 100),
    ]);

    const defaultReport = inspectUiLayout([input]);
    expect(defaultReport.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "reserved_overlap", zone: expect.objectContaining({ id: "JumpButton" }) }),
      ]),
    );

    const hiddenReport = inspectUiLayout([input], { hiddenCoreGui: ["JumpButton"] });
    expect(hiddenReport.findings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "reserved_overlap", zone: expect.objectContaining({ id: "JumpButton" }) }),
      ]),
    );
    expect(hiddenReport.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "reserved_overlap", zone: expect.objectContaining({ id: "Joystick" }) }),
      ]),
    );
  });

  test("reports intersecting unrelated buttons but not an ancestor and its child", () => {
    const parent = node("ImageButton", "Parent", "parent", 500, 100, 250, 180, {
      LuaChildren: [node("TextButton", "Nested", "nested", 10, 10, 100, 50)],
    });
    const peer = node("TextButton", "Peer", "peer", 620, 120, 130, 80);
    const report = inspectUiLayout([screen([parent, peer])]);

    const overlaps = report.findings.filter((finding) => finding.kind === "button_overlap");
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toEqual(
      expect.objectContaining({
        elements: expect.arrayContaining([
          expect.objectContaining({ guid: "parent" }),
          expect.objectContaining({ guid: "peer" }),
        ]),
      }),
    );
  });

  test("reports elements outside the viewport using normalized geometry", () => {
    const report = inspectUiLayout([screen([node("TextLabel", "Offscreen", "off", -20, 600, 80, 80)])]);
    const finding = report.findings.find((candidate) => candidate.kind === "outside_viewport");
    expect(finding).toEqual(
      expect.objectContaining({
        element: expect.objectContaining({
          guid: "off",
          rect: expect.objectContaining({ left: expect.any(Number), bottom: 1.0625 }),
        }),
      }),
    );
  });

  test("resolves nested UDim2 and AnchorPoint relative to its parent", () => {
    const panel = node("Frame", "Panel", "panel", 400, 100, 400, 300, {
      LuaChildren: [
        {
          ...node("TextButton", "Centered", "centered", 0, 0, 100, 50),
          Position: { X: { Scale: 0.5, Offset: 0 }, Y: { Scale: 0.5, Offset: 0 } },
          AnchorPoint: { X: 0.5, Y: 0.5 },
        },
      ],
    });
    const report = inspectUiLayout([screen([panel])]);
    const centered = report.findings.find(
      (finding) => finding.kind === "reserved_overlap" && finding.element.guid === "centered",
    );
    expect(centered).toBeUndefined();
    expect(report.checkedElements).toBe(2);
  });

  test("ignores hidden trees and intentional high-Z overlays", () => {
    const report = inspectUiLayout([
      screen([
        node("TextButton", "Hidden", "hidden", 1100, 400, 100, 100, { Visible: false }),
        node("TextButton", "Overlay", "overlay", 1100, 400, 100, 100, { ZIndex: 100 }),
      ]),
    ]);
    expect(report.findings.filter((finding) => finding.kind === "reserved_overlap")).toHaveLength(0);
  });

  test("keeps high-Z overlay descendants out of reserved and normal button checks", () => {
    const report = inspectUiLayout([
      screen([
        node("Frame", "Modal", "modal", 0, 0, 1386, 640, {
          ZIndex: 100,
          LuaChildren: [node("TextButton", "OverlayAction", "overlay-action", 1100, 400, 100, 100)],
        }),
        node("TextButton", "HudAction", "hud-action", 1100, 400, 100, 100),
      ]),
    ]);

    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "reserved_overlap", element: expect.objectContaining({ guid: "hud-action" }) }),
      ]),
    );
    expect(JSON.stringify(report.findings)).not.toContain("overlay-action");
  });

  test("keeps transparent buttons but excludes transparent inactive Frame containers", () => {
    const report = inspectUiLayout([
      screen([
        node("Frame", "Container", "frame", 1100, 400, 100, 100, { BackgroundTransparency: 1 }),
        node("TextButton", "InvisibleButton", "button", 1100, 400, 100, 100, { BackgroundTransparency: 1 }),
      ]),
    ]);
    const reserved = report.findings.filter((finding) => finding.kind === "reserved_overlap");
    expect(reserved).toHaveLength(1);
    expect(reserved[0]).toEqual(expect.objectContaining({ element: expect.objectContaining({ guid: "button" }) }));
  });

  test("includes ProgressBar and future UDim2 GUI classes", () => {
    const report = inspectUiLayout([
      screen([
        node("ProgressBar", "Progress", "progress", 1100, 400, 100, 100),
        node("CustomGauge", "Gauge", "gauge", 1100, 400, 100, 100),
      ]),
    ]);
    expect(report.checkedElements).toBe(2);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "reserved_overlap", element: expect.objectContaining({ guid: "progress" }) }),
        expect.objectContaining({ kind: "reserved_overlap", element: expect.objectContaining({ guid: "gauge" }) }),
      ]),
    );
  });

  test("excludes fully transparent passive text and image labels but keeps buttons", () => {
    const report = inspectUiLayout([
      screen([
        node("TextLabel", "InvisibleText", "text", 1100, 400, 100, 100, {
          BackgroundTransparency: 1,
          Text: "Hidden",
          TextTransparency: 1,
        }),
        node("ImageLabel", "InvisibleImage", "image", 1100, 400, 100, 100, {
          BackgroundTransparency: 1,
          Image: "ovdrassetid://1",
          ImageTransparency: 1,
        }),
        node("ImageButton", "Interactive", "interactive", 1100, 400, 100, 100, { BackgroundTransparency: 1 }),
      ]),
    ]);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "reserved_overlap",
          element: expect.objectContaining({ guid: "interactive" }),
        }),
      ]),
    );
    expect(JSON.stringify(report.findings)).not.toContain('"text"');
    expect(JSON.stringify(report.findings)).not.toContain('"image"');
  });

  test("reports unsupported geometry as partial rather than clean", () => {
    const report = inspectUiLayout([
      screen([
        node("Frame", "Rotated", "rotated", 100, 100, 200, 100, {
          Rotation: 15,
          LuaChildren: [node("TextButton", "Child", "child", 0, 0, 100, 50)],
        }),
        node("Frame", "List", "list", 300, 100, 200, 200, {
          LuaChildren: [
            { InstanceType: "UIListLayout", Name: "Layout", ActorGuid: "layout" },
            node("TextButton", "Managed", "managed", 0, 0, 100, 50),
          ],
        }),
      ]),
    ]);
    expect(report.skippedElements.length).toBeGreaterThan(0);
    expect(report.skippedElements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expect.stringContaining("Rotated"),
          reason: expect.stringContaining("Rotation"),
        }),
        expect.objectContaining({
          path: expect.stringContaining("Managed"),
          reason: expect.stringContaining("layout-managed"),
        }),
      ]),
    );
  });

  test("bounds findings and marks the report truncated", () => {
    const report = inspectUiLayout(
      [
        screen([
          node("TextButton", "First", "first", 1100, 400, 100, 100),
          node("TextButton", "Second", "second", 1100, 400, 100, 100),
        ]),
      ],
      { maxFindings: 1 },
    );
    expect(report.findings).toHaveLength(1);
    expect(report.truncated).toBe(true);
  });
});
