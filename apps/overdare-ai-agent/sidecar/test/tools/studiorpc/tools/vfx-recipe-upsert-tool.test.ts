// @summary Exercises the VFXRecipe upsert input checks that run before approval or any Studio call.
import { expect, test } from "bun:test";
import { createVfxRecipeUpsertTool } from "../../../../src/tools/studiorpc/tools/vfx-recipe-upsert-tool";
import { createWriteLock } from "../../../../src/tools/studiorpc/write-lock";

test("rejects wrong-layer sources, arbitrary classes and mixed operations before approval", async () => {
  const tool = createVfxRecipeUpsertTool(createWriteLock());
  const approvals: string[] = [];
  const ctx = {
    approve: async (request: { toolName: string }) => {
      approvals.push(request.toolName);
      return "once";
    },
  };
  for (const items of [
    [{ parentGuid: "W", name: "Bad", properties: { DetailLayer: [{ Name: "Bad", NiagaraSystem: "FireRise_A" }] } }],
    [{ parentGuid: "W", class: "Part", name: "Bad", properties: {} }],
    [
      { parentGuid: "W", name: "New", properties: {} },
      { guid: "R", properties: {} },
    ],
  ])
    await expect(tool.execute({ items } as never, ctx as never)).rejects.toThrow();
  expect(approvals).toEqual([]);
});
