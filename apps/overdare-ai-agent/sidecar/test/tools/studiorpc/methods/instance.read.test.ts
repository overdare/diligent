// @summary Tests that instance.read accepts the GUID field name the other tools report.
import { describe, expect, test } from "bun:test";
import { normalizeArgs, params } from "../../../../src/tools/studiorpc/methods/instance.read";
import { toReadableNode } from "../../../../src/tools/studiorpc/tools/instance-read-tool";

describe("instance.read arguments", () => {
  test("accepts instanceGuid, the name every tool that reports a GUID uses", () => {
    const parsed = params.parse(normalizeArgs({ instanceGuid: "5014F114A64A34D0695EB0D7CEDD7F17" }));

    expect(parsed.guid).toBe("5014F114A64A34D0695EB0D7CEDD7F17");
  });

  test("leaves guid alone when it is already given", () => {
    const parsed = params.parse(normalizeArgs({ guid: "AAA", instanceGuid: "BBB" }));

    expect(parsed.guid).toBe("AAA");
  });

  test("lets a call with no instance through the schema, to be refused in words", () => {
    // Three testers called this with no arguments expecting the live tool's listing.
    // The validator's "guid: Required" named a field they thought they had left out on
    // purpose; the tool itself now answers with which tool they actually wanted, so the
    // schema deliberately stops rejecting it first.
    expect(() => params.parse(normalizeArgs({ recursive: true }))).not.toThrow();
    expect(params.parse(normalizeArgs({ recursive: true })).guid).toBeUndefined();
  });
  test("preserves tagged and future properties through recursive reads while separating identities", () => {
    const color = { ObjectType: "Color3", R: 1, G: 2, B: 3 };
    const cframe = { ObjectType: "CFrame", Position: { ObjectType: "Vector3", X: 1, Y: 2, Z: 3 } };
    expect(
      toReadableNode(
        {
          InstanceType: "Part",
          ActorGuid: "P",
          ObjectKey: 123,
          Name: "Part",
          Color: color,
          Future: { Opaque: true },
          LuaChildren: [{ InstanceType: "FutureClass", ActorGuid: "C", Name: "Child", CFrame: cframe }],
        },
        true,
      ),
    ).toEqual({
      guid: "P",
      name: "Part",
      class: "Part",
      properties: { Color: color, Future: { Opaque: true } },
      children: [{ guid: "C", name: "Child", class: "FutureClass", properties: { CFrame: cframe } }],
    });
  });
});
