// @summary Screenshot exclusions and instance diagnostics use the same reserved control geometry.
import { expect, test } from "bun:test";
import { collectUiDiagnostics, parseArgs } from "../../../src/tools/studiorpc/methods/instance.upsert";

test("upsert parsing retains local hidden-control hints", () => {
  const parsed = parseArgs({ items: [{ guid: "button", properties: {} }], hiddenCoreGui: ["JumpButton"] });
  expect(parsed.hiddenCoreGui).toEqual(["JumpButton"]);
});

test("a hidden jump control removes its reserved warning while keeping joystick warnings", () => {
  const button = (name: string, x: number, y: number) => ({
    InstanceType: "ImageButton",
    Name: name,
    ActorGuid: name,
    Position: { X: { Scale: 0, Offset: x }, Y: { Scale: 0, Offset: y } },
    Size: { X: { Scale: 0, Offset: 100 }, Y: { Scale: 0, Offset: 100 } },
  });
  const root = { InstanceType: "ScreenGui", LuaChildren: [button("jump", 1100, 400), button("move", 100, 400)] };
  expect(collectUiDiagnostics(root).warnings.join("\n")).toContain("mobile jump button");
  const diagnostics = collectUiDiagnostics(root, { hiddenCoreGui: ["JumpButton"] });
  expect(diagnostics.warnings.join("\n")).not.toContain("mobile jump button");
  expect(diagnostics.warnings.join("\n")).toContain("mobile joystick");
});
