// @summary Exercises recipe-only edits, class preflight, Mobility policy and apply recovery on the file backend.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVfxRecipeUpsertTool } from "../../../../src/tools/studiorpc/tools/vfx-recipe-upsert-tool";
import { createWriteLock } from "../../../../src/tools/studiorpc/write-lock";

const directories: string[] = [];
const previousVersion = process.env.STUDIO_API_VERSION;
afterEach(() => {
  if (previousVersion === undefined) delete process.env.STUDIO_API_VERSION;
  else process.env.STUDIO_API_VERSION = previousVersion;
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function setup(apply?: (path: string) => Promise<void>) {
  process.env.STUDIO_API_VERSION = "v1";
  const cwd = mkdtempSync(join(tmpdir(), "vfx-recipe-"));
  directories.push(cwd);
  const path = join(cwd, "Test.ovdrjm");
  writeFileSync(join(cwd, "Test.umap"), "");
  writeFileSync(
    path,
    JSON.stringify({
      Root: {
        InstanceType: "Workspace",
        ActorGuid: "W",
        LuaChildren: [
          { InstanceType: "Part", ActorGuid: "P", Name: "Part" },
          {
            InstanceType: "VFXRecipe",
            ActorGuid: "R",
            Name: "Recipe",
            AutoActivate: false,
            InfiniteLoop: false,
            LoopCount: 4,
            DetailLayer: [{ Name: "Existing" }],
          },
        ],
      },
    }),
  );
  let saves = 0;
  const approvals: string[] = [];
  const tool = createVfxRecipeUpsertTool(cwd, createWriteLock(), async () => {
    saves++;
    await apply?.(path);
  });
  const ctx = {
    approve: async (request: { toolName: string }) => {
      approvals.push(request.toolName);
      return "once";
    },
  };
  const run = (args: unknown) => tool.execute(args as never, ctx as never);
  return {
    path,
    run,
    tool,
    approvals,
    saves: () => saves,
    nodes: () => JSON.parse(readFileSync(path, "utf8")).Root.LuaChildren,
  };
}
test("creates a recipe with normalized assets, tags and bare Alpha keypoints", async () => {
  const ctx = setup();
  const result = await ctx.run({
    items: [
      {
        parentGuid: "W",
        name: "New",
        properties: {
          BaseLayer: [
            {
              Name: "Body",
              NiagaraSystem: "NeutralBurst_A",
              Position: { X: 1, Y: 2, Z: 3 },
              Alpha: [{ Time: 0, Value: 1 }],
              SpawnCount: 3,
            },
          ],
        },
      },
    ],
  });
  const node = ctx.nodes().find((node: { Name: string }) => node.Name === "New");
  expect(node.InstanceType).toBe("VFXRecipe");
  expect(node.BaseLayer[0].NiagaraSystem).toContain("/0_Base/NeutralBurst_A/");
  expect(node.BaseLayer[0].Position.ObjectType).toBe("Vector3");
  expect(node.BaseLayer[0].Alpha).toEqual([{ Time: 0, Value: 1 }]);
  expect(result.metadata?.addCount).toBe(1);
  expect(ctx.saves()).toBe(1);
  expect(ctx.approvals).toEqual(["studiorpc_vfx_recipe_upsert"]);
});
test("patches only supplied recipe properties and clears an explicit layer", async () => {
  const ctx = setup();
  await ctx.run({ items: [{ guid: "R", properties: { DetailLayer: [], LoopCount: 2 } }] });
  expect(ctx.nodes().find((node: { ActorGuid: string }) => node.ActorGuid === "R")).toMatchObject({
    AutoActivate: false,
    InfiniteLoop: false,
    LoopCount: 2,
    DetailLayer: [],
  });
});
test("rejects a non-recipe target before changing any batch item or saving", async () => {
  const ctx = setup();
  const before = readFileSync(ctx.path, "utf8");
  await expect(
    ctx.run({
      items: [
        { guid: "R", properties: { LoopCount: 2 } },
        { guid: "P", properties: {} },
      ],
    }),
  ).rejects.toThrow("VFXRecipe");
  expect(readFileSync(ctx.path, "utf8")).toBe(before);
  expect(ctx.saves()).toBe(0);
});
test("rejects wrong-layer sources, arbitrary classes and mixed operations before approval", async () => {
  const ctx = setup();
  for (const items of [
    [{ parentGuid: "W", name: "Bad", properties: { DetailLayer: [{ Name: "Bad", NiagaraSystem: "FireRise_A" }] } }],
    [{ parentGuid: "W", class: "Part", name: "Bad", properties: {} }],
    [
      { parentGuid: "W", name: "New", properties: {} },
      { guid: "R", properties: {} },
    ],
  ])
    await expect(ctx.run({ items })).rejects.toThrow();
  expect(ctx.approvals).toEqual([]);
  expect(ctx.saves()).toBe(0);
});
test("ignores Mobility below a top-level object and reports it", async () => {
  const ctx = setup();
  const result = await ctx.run({ items: [{ parentGuid: "P", name: "Nested", properties: { Mobility: "Static" } }] });
  expect(result.metadata?.info).toEqual([
    expect.stringMatching(/^Ignored Mobility for .+: Mobility can only be changed on a direct child of Workspace\.$/),
  ]);
  const part = ctx.nodes().find((node: { ActorGuid: string }) => node.ActorGuid === "P");
  expect(part.LuaChildren[0].Mobility).toBeUndefined();
});
test("restores the pre-write bytes when apply fails and keeps the original error", async () => {
  const failure = new Error("Studio rejected level apply");
  const ctx = setup(async () => {
    throw failure;
  });
  const before = readFileSync(ctx.path);
  const caught = await ctx.run({ items: [{ guid: "R", properties: { LoopCount: 2 } }] }).catch((error) => error);
  expect((caught as Error).cause).toBe(failure);
  expect((caught as Error).message).toContain("file restored");
  expect((caught as Error).message).toContain("Studio state is unconfirmed");
  expect(readFileSync(ctx.path)).toEqual(before);
});
test("preserves a later external write when apply fails", async () => {
  const newer = Buffer.from('{"external":"saved during apply"}');
  const ctx = setup(async (path) => {
    writeFileSync(path, newer);
    throw new Error("connection lost");
  });
  await expect(ctx.run({ items: [{ guid: "R", properties: { LoopCount: 2 } }] })).rejects.toThrow(
    "file changed after upsert; not restored",
  );
  expect(readFileSync(ctx.path)).toEqual(newer);
});
