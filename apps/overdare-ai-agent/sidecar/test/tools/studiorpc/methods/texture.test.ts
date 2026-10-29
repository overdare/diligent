// @summary Checks the public texture plan and apply boundaries before invoking Studio.
import { expect, test } from "bun:test";
import { params as applyParams } from "../../../../src/tools/studiorpc/methods/texture.apply";
import { params as prepareParams } from "../../../../src/tools/studiorpc/methods/texture.prepare";
import { methodModules, mutatingMethods, savingMethods } from "../../../../src/tools/studiorpc/tool-registry";

const plan = {
  version: 1,
  base: { kind: "fill", color: [32, 64, 128] },
  surfaces: {
    Front: [
      { id: "sun", kind: "shape", shape: "sun", rect: [0.1, 0.1, 0.3, 0.4], color: [255, 220, 0] },
      { id: "art", kind: "image", source: { imageKey: "mascot" }, rect: [0.5, 0.1, 0.4, 0.8], fit: "contain" },
    ],
  },
};

test("prepare accepts mixed layers without generator configuration", () => {
  expect(prepareParams.parse({ targetGuid: "wall", plan }).plan).toEqual(plan);
  expect(prepareParams.safeParse({ targetGuid: "wall", plan: { ...plan, prompt: "draw" } }).success).toBe(false);
});

test("plans reject malformed colors, rectangles, duplicate ids and ambiguous image sources", () => {
  const layer = plan.surfaces.Front[0];
  for (const bad of [
    { ...layer, color: [256, 0, 0] },
    { ...layer, rect: [0.9, 0, 0.5, 1] },
    { ...layer, rect: [0, 0, 0, 1] },
    { ...layer, kind: "image", source: { imageKey: "x", assetId: "ovdrassetid://123" } },
  ])
    expect(prepareParams.safeParse({ targetGuid: "wall", plan: { ...plan, surfaces: { Front: [bad] } } }).success).toBe(
      false,
    );
  expect(
    prepareParams.safeParse({ targetGuid: "wall", plan: { ...plan, surfaces: { Front: [layer, layer] } } }).success,
  ).toBe(false);
});

test("pure painting apply needs no image and recovery keeps the same request identity", () => {
  const input = { targetGuid: "wall", prepareId: "P", targetRevision: "R", requestId: "request-1" };
  expect(applyParams.parse(input)).toEqual(input);
  expect(
    applyParams.safeParse({ ...input, images: { x: { filePath: "C:/art/x.png", assetId: "ovdrassetid://123" } } })
      .success,
  ).toBe(false);
  expect(applyParams.safeParse({ ...input, images: { x: { assetId: "/tmp/local.png" } } }).success).toBe(false);
});

test("prepare is read only and apply uses the existing mutation lock with native saving", () => {
  const prepare = methodModules.find((m) => m.method === "texture.prepare");
  expect(prepare?.readOnly).toBe(true);
  expect(mutatingMethods.has("texture.prepare")).toBe(false);
  expect(mutatingMethods.has("texture.apply")).toBe(true);
  // Native apply owns save failure recovery; a second sidecar save would obscure its result.
  expect(savingMethods.has("texture.apply")).toBe(false);
});
