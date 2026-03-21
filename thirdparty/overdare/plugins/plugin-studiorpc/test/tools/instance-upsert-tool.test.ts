// @summary Tests batched instance upsert tool behavior against temp ovdrjm fixtures.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "../../src/tool-types.ts";

const levelApplyMock = mock(async () => ({ ok: true }));

mock.module("../../src/rpc.ts", () => ({
  call: (method: string, params?: Record<string, unknown>) => {
    if (method !== "level.apply") {
      throw new Error(`Unexpected RPC method in test: ${method}`);
    }
    return levelApplyMock(method, params);
  },
}));

const { createInstanceUpsertTool } = await import("../../src/tools/instance-upsert-tool.ts");

function createToolContext(): ToolContext {
  return {
    toolCallId: "tool-call-1",
    signal: new AbortController().signal,
    approve: async () => "always",
  };
}

function createWorldDocument() {
  return {
    MapObjectKeyIndex: 7,
    Root: {
      ActorGuid: "ROOT_GUID",
      Name: "Root",
      LuaChildren: [
        {
          ActorGuid: "PARENT_GUID",
          Name: "ParentFolder",
          LuaChildren: [
            {
              ActorGuid: "CHILD_GUID",
              Name: "OldName",
              Visible: true,
            },
          ],
        },
      ],
    },
  };
}

async function readWorld(tempDir: string) {
  const raw = await readFile(join(tempDir, "world.ovdrjm"), "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("instance-upsert-tool", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "instance-upsert-tool-"));
    await writeFile(join(tempDir, "world.umap"), "placeholder", "utf-8");
    await writeFile(join(tempDir, "world.ovdrjm"), `${JSON.stringify(createWorldDocument(), null, 2)}\n`, "utf-8");
    levelApplyMock.mockClear();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("updates nodes by guid", async () => {
    const tool = createInstanceUpsertTool(tempDir);

    const result = await tool.execute(
      {
        items: [
          {
            guid: "CHILD_GUID",
            properties: {
              Visible: false,
            },
            name: "UpdatedName",
          },
        ],
      },
      createToolContext(),
    );

    const world = createWorldDocument();
    const saved = await readWorld(tempDir);
    const savedRoot = saved.Root as { LuaChildren: Array<{ LuaChildren: Array<Record<string, unknown>> }> };
    const child = savedRoot.LuaChildren[0].LuaChildren[0];

    expect(child.Name).toBe("UpdatedName");
    expect(child.Visible).toBe(false);
    expect(levelApplyMock).toHaveBeenCalledTimes(1);
    expect(result.metadata?.targetGuids).toEqual(["CHILD_GUID"]);
    expect(result.metadata?.updateCount).toBe(1);
    expect(result.metadata?.addCount).toBe(0);
    expect(world.Root.LuaChildren[0].LuaChildren[0].Name).toBe("OldName");
  });

  test("normalizes Enum.* property values to their final segment on update", async () => {
    const tool = createInstanceUpsertTool(tempDir);

    await tool.execute(
      {
        items: [
          {
            guid: "CHILD_GUID",
            properties: {
              TextXAlignment: "Enum.TextXAlignment.Left",
              TextYAlignment: "Enum.TextYAlignment.Top",
            },
          },
        ],
      },
      createToolContext(),
    );

    const saved = await readWorld(tempDir);
    const savedRoot = saved.Root as { LuaChildren: Array<{ LuaChildren: Array<Record<string, unknown>> }> };
    const child = savedRoot.LuaChildren[0].LuaChildren[0];

    expect(child.TextXAlignment).toBe("Left");
    expect(child.TextYAlignment).toBe("Top");
    expect(child.Visible).toBe(true);
  });

  test("adds nodes under parentGuid", async () => {
    const tool = createInstanceUpsertTool(tempDir);

    const result = await tool.execute(
      {
        items: [
          {
            class: "Folder",
            parentGuid: "PARENT_GUID",
            name: "SpawnedFolder",
            properties: {},
          },
        ],
      },
      createToolContext(),
    );

    const saved = await readWorld(tempDir);
    const savedRoot = saved.Root as { LuaChildren: Array<{ LuaChildren: Array<Record<string, unknown>> }> };
    const children = savedRoot.LuaChildren[0].LuaChildren;
    const added = children.find((node) => node.Name === "SpawnedFolder");

    expect(added).toBeDefined();
    expect(added?.InstanceType).toBe("Folder");
    expect(typeof added?.ActorGuid).toBe("string");
    expect((added?.ActorGuid as string).length).toBe(32);
    expect(saved.MapObjectKeyIndex).toBe(8);
    expect(levelApplyMock).toHaveBeenCalledTimes(1);
    expect(result.metadata?.targetGuids).toEqual([added?.ActorGuid]);
    expect(result.metadata?.addCount).toBe(1);
    expect(result.metadata?.updateCount).toBe(0);
  });

  test("normalizes Enum.* property values to their final segment on add", async () => {
    const tool = createInstanceUpsertTool(tempDir);

    await tool.execute(
      {
        items: [
          {
            class: "UIListLayout",
            parentGuid: "PARENT_GUID",
            name: "LayoutNode",
            properties: {
              FillDirection: "Enum.FillDirection.Vertical",
              SortOrder: "Enum.SortOrder.LayoutOrder",
            },
          },
        ],
      },
      createToolContext(),
    );

    const saved = await readWorld(tempDir);
    const savedRoot = saved.Root as { LuaChildren: Array<{ LuaChildren: Array<Record<string, unknown>> }> };
    const children = savedRoot.LuaChildren[0].LuaChildren;
    const added = children.find((node) => node.Name === "LayoutNode");

    expect(added?.FillDirection).toBe("Vertical");
    expect(added?.SortOrder).toBe("LayoutOrder");
  });

  test("supports mixed update and add items", async () => {
    const tool = createInstanceUpsertTool(tempDir);

    const result = await tool.execute(
      {
        items: [
          {
            guid: "CHILD_GUID",
            name: "UpdatedName",
            properties: {},
          },
          {
            class: "Folder",
            parentGuid: "PARENT_GUID",
            name: "SpawnedFolder",
            properties: {},
          },
        ],
      },
      createToolContext(),
    );

    const saved = await readWorld(tempDir);
    const savedRoot = saved.Root as { LuaChildren: Array<{ LuaChildren: Array<Record<string, unknown>> }> };
    const children = savedRoot.LuaChildren[0].LuaChildren;
    const updated = children.find((node) => node.ActorGuid === "CHILD_GUID");
    const added = children.find((node) => node.Name === "SpawnedFolder");

    expect(updated?.Name).toBe("UpdatedName");
    expect(added?.InstanceType).toBe("Folder");
    expect(result.metadata?.targetGuids).toHaveLength(2);
    expect(result.metadata?.updateCount).toBe(1);
    expect(result.metadata?.addCount).toBe(1);
  });

  test("throws when update guid is missing", async () => {
    const tool = createInstanceUpsertTool(tempDir);

    await expect(
      tool.execute(
        {
          items: [
            {
              guid: "MISSING_GUID",
              name: "Nope",
              properties: {},
            },
          ],
        },
        createToolContext(),
      ),
    ).rejects.toThrow("ActorGuid not found in .ovdrjm: MISSING_GUID");

    expect(levelApplyMock).not.toHaveBeenCalled();
  });

  test("throws when add parentGuid is missing", async () => {
    const tool = createInstanceUpsertTool(tempDir);

    await expect(
      tool.execute(
        {
          items: [
            {
              class: "Folder",
              parentGuid: "MISSING_PARENT_GUID",
              name: "SpawnedFolder",
              properties: {},
            },
          ],
        },
        createToolContext(),
      ),
    ).rejects.toThrow("Parent ActorGuid not found in .ovdrjm: MISSING_PARENT_GUID");

    expect(levelApplyMock).not.toHaveBeenCalled();
  });
});
