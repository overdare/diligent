// @summary Verifies the Studio instance RPC tools: wire conversion, save-after-write, validation and failure handling.
//
// Studio is stood in for by the provider's injected `callRpc` rather than a module
// mock, so the tools run against it regardless of which other test files have
// mocked ./rpc.ts, and nothing leaks into them. The transport itself is covered by
// rpc.test.ts.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { EOL, tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@diligent/core/tool-contract";
import { runWithSessionExecutionContext } from "@diligent/runtime";
import { createStudioRpcToolProvider } from "../../../src/tools/studiorpc";
import { checkResult } from "../../../src/tools/studiorpc/tools/instance-rpc/result";

interface RpcCall {
  method: string;
  params?: Record<string, unknown>;
  meta?: { sessionId: string };
}

type Responder = (method: string, params?: Record<string, unknown>) => unknown;

const rpcCalls: RpcCall[] = [];
let respond: Responder;

const WORKSPACE_GUID = "WS";
const FOLDER_A_GUID = "FA";
const FOLDER_B_GUID = "FB";
const PART_GUID = "P1";
const SCRIPT_GUID = "S1";
const SCRIPT_SOURCE = "print(1)\nprint(2)\n";

type WorldNode = Record<string, unknown> & { ActorGuid?: string; LuaChildren?: WorldNode[] };

function makeWorld(): WorldNode {
  return {
    InstanceType: "Workspace",
    ActorGuid: WORKSPACE_GUID,
    Name: "Workspace",
    LuaChildren: [
      { InstanceType: "Folder", ActorGuid: FOLDER_A_GUID, Name: "FolderA", LuaChildren: [] },
      { InstanceType: "Folder", ActorGuid: FOLDER_B_GUID, Name: "FolderB", LuaChildren: [] },
      { InstanceType: "Part", ActorGuid: PART_GUID, Name: "Part1" },
      { InstanceType: "Script", ActorGuid: SCRIPT_GUID, Name: "Greeter", Source: SCRIPT_SOURCE },
    ],
  };
}

function findWorldNode(node: WorldNode, guid: string): WorldNode | undefined {
  if (node.ActorGuid === guid) return node;
  for (const child of node.LuaChildren ?? []) {
    const found = findWorldNode(child, guid);
    if (found) return found;
  }
  return undefined;
}

let world: WorldNode;
let issuedGuids = 0;

/**
 * Stands in for Studio: lists the top-level instance for level.browse, serves
 * instance.read from `world`, and issues GUIDs for instance.create. Studio has
 * no handle for the level root, so an unknown ActorGuid resolves to nothing.
 */
function studioResponder(method: string, params?: Record<string, unknown>): unknown {
  if (method === "level.browse") {
    // Studio answers with the hierarchy only — guid, name, class and children.
    const lite = (node: WorldNode): WorldNode => ({
      ActorGuid: node.ActorGuid,
      Name: node.Name,
      InstanceType: node.InstanceType,
      ...(node.LuaChildren ? { LuaChildren: node.LuaChildren.map(lite) } : {}),
    });
    return { level: [lite(world)] };
  }
  if (method === "instance.read") {
    const actorGuid = params?.ActorGuid as string;
    const node = findWorldNode(world, actorGuid);
    if (!node) return { success: true };
    const instance = structuredClone(node);
    if (params?.Depth === 0) delete instance.LuaChildren;
    return { success: true, instance };
  }
  if (method === "instance.create") {
    const instances = (params?.Instances as unknown[]) ?? [];
    return { success: true, ActorGuids: instances.map(() => `NEW-${++issuedGuids}`) };
  }
  return { success: true };
}

const createdDirs: string[] = [];

function makeStudioProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), "studiorpc-instance-rpc-"));
  writeFileSync(join(cwd, "Test.umap"), "");
  writeFileSync(join(cwd, "Test.ovdrjm"), JSON.stringify({ Root: makeWorld() }, null, 2));
  createdDirs.push(cwd);
  return cwd;
}

/** The provider's transport: records each request as it would go on the wire and answers from `respond`. */
async function fakeStudio(
  method: string,
  params?: Record<string, unknown>,
  options?: { sessionId?: string },
): Promise<unknown> {
  rpcCalls.push({
    method,
    ...(params !== undefined && Object.keys(params).length > 0 && { params: structuredClone(params) }),
    ...(options?.sessionId && { meta: { sessionId: options.sessionId } }),
  });
  return structuredClone(respond(method, params));
}

async function loadTools(cwd: string): Promise<Map<string, Tool>> {
  const provider = createStudioRpcToolProvider({ callRpc: fakeStudio });
  const tools = await provider.createTools({ cwd, host: { approve: async () => "once" } });
  return new Map(tools.map((tool) => [tool.name, tool]));
}

function toolContext(sessionId?: string) {
  return { toolCallId: "test", sessionId, signal: new AbortController().signal, abort: () => {} };
}

function methodsCalled(): string[] {
  return rpcCalls.map((entry) => entry.method);
}

function paramsOf(method: string): Record<string, unknown> | undefined {
  return rpcCalls.find((entry) => entry.method === method)?.params;
}

beforeEach(() => {
  rpcCalls.length = 0;
  issuedGuids = 0;
  world = makeWorld();
  respond = studioResponder;
});

afterEach(() => {
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Studio session attribution on the wire", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["studiorpc_script_add", { class: "Script", parentGuid: FOLDER_A_GUID, name: "NewScript", source: "print(1)" }],
    ["studiorpc_script_edit", { guid: SCRIPT_GUID, old_string: "print(1)", new_string: "print(9)" }],
    ["studiorpc_script_delete", { guid: SCRIPT_GUID }],
    ["studiorpc_execute_luau", { target: "Editor", code: "return 1" }],
    ["studiorpc_level_browse", {}],
    ["studiorpc_level_save_file", {}],
  ];
  test("all RPCs, including reads, saves and validation, carry the caller session", async () => {
    for (const [name, args] of cases) {
      rpcCalls.length = 0;
      const tools = await loadTools(makeStudioProject());
      const result = await tools.get(name)!.execute(args, toolContext("session-on-wire"));
      expect(result.metadata?.error).not.toBe(true);
      expect(rpcCalls.length).toBeGreaterThan(0);
      expect(rpcCalls.map((entry) => entry.meta?.sessionId)).toEqual(rpcCalls.map(() => "session-on-wire"));
    }
  });

  test("shared tools keep parent and child sessions separate across overlapping calls", async () => {
    const cwd = makeStudioProject();
    const provider = createStudioRpcToolProvider({ callRpc: fakeStudio });
    await provider.onUserPromptSubmit!({
      session_id: "parent",
      transcript_path: "",
      cwd,
      hook_event_name: "UserPromptSubmit",
      prompt: "inspect",
    });
    const tools = new Map((await provider.createTools({ cwd })).map((tool) => [tool.name, tool]));
    await Promise.all([
      tools
        .get("studiorpc_execute_luau")!
        .execute({ target: "Editor", code: "return 'parent'" }, toolContext("parent")),
      tools.get("studiorpc_execute_luau")!.execute({ target: "Editor", code: "return 'child'" }, toolContext("child")),
      tools.get("studiorpc_instance_read")!.execute({ guid: PART_GUID, recursive: false }, toolContext("parent")),
      tools.get("studiorpc_instance_read")!.execute({ guid: SCRIPT_GUID, recursive: false }, toolContext("child")),
    ]);
    expect(
      rpcCalls.filter((entry) => entry.params?.code === "return 'parent'").map((entry) => entry.meta?.sessionId),
    ).toEqual(["parent"]);
    expect(
      rpcCalls.filter((entry) => entry.params?.code === "return 'child'").map((entry) => entry.meta?.sessionId),
    ).toEqual(["child"]);
    expect(
      rpcCalls.filter((entry) => entry.params?.ActorGuid === PART_GUID).map((entry) => entry.meta?.sessionId),
    ).toEqual(["parent"]);
    expect(
      rpcCalls.filter((entry) => entry.params?.ActorGuid === SCRIPT_GUID).map((entry) => entry.meta?.sessionId),
    ).toEqual(["child"]);
  });

  test("calls outside an agent have a stable process identity and do not borrow the parent session", async () => {
    const tools = await loadTools(makeStudioProject());
    await tools.get("studiorpc_level_browse")!.execute({}, toolContext("parent"));
    await tools.get("studiorpc_level_browse")!.execute({}, toolContext());
    await tools.get("studiorpc_level_browse")!.execute({}, toolContext());
    const sessions = rpcCalls.map((entry) => entry.meta?.sessionId);
    expect(sessions[0]).toBe("parent");
    expect(sessions[1]).toBeTruthy();
    expect(sessions[1]).not.toBe("parent");
    expect(sessions[2]).toBe(sessions[1]);
  });
});

describe("checkResult", () => {
  test("rejects an explicit failure", () => {
    expect(() => checkResult("instance.update", { success: false, message: "no such GUID" })).toThrow(
      /instance\.update failed: no such GUID/,
    );
    expect(() => checkResult("instance.update", { success: false })).toThrow(/\(no message\)/);
  });

  test("treats any non-empty message on a successful result as a partial failure", () => {
    expect(() => checkResult("instance.delete", { success: true, message: "1 of 2 instances not found" })).toThrow(
      /instance\.delete partial failure: 1 of 2 instances not found/,
    );
  });

  test("accepts results that carry no failure signal", () => {
    for (const result of [{ success: true }, { success: true, message: "" }, { success: true, message: "  " }, {}]) {
      expect(() => checkResult("instance.update", result)).not.toThrow();
    }
    expect(() => checkResult("instance.update", undefined)).not.toThrow();
    expect(() => checkResult("instance.update", "ok")).not.toThrow();
  });
});

describe("argument conversion", () => {
  test("maps instance_read recursive onto Depth", async () => {
    const tools = await loadTools(makeStudioProject());
    const read = tools.get("studiorpc_instance_read")!;

    await read.execute({ guid: PART_GUID, recursive: true }, toolContext());
    expect(rpcCalls.at(-1)).toMatchObject({ method: "instance.read", params: { ActorGuid: PART_GUID, Depth: -1 } });

    await read.execute({ guid: PART_GUID, recursive: false }, toolContext());
    expect(rpcCalls.at(-1)).toMatchObject({ method: "instance.read", params: { ActorGuid: PART_GUID, Depth: 0 } });
  });

  test("answers an unknown instance_read GUID with a structured readback status", async () => {
    const tools = await loadTools(makeStudioProject());

    const result = await tools
      .get("studiorpc_instance_read")!
      .execute({ guid: "missing-target", recursive: false }, toolContext());

    const status = {
      kind: "missing_guid",
      code: "missing_target_guid",
      operation: "instance.read",
      guid: "missing-target",
      role: "target",
      requiresReadback: true,
      suggestedTool: "studiorpc_level_browse",
    };
    expect(result.metadata).toMatchObject({ error: true, method: "instance.read", status });
    const statusJson = /^<studio_instance_status>\n(?<json>[\s\S]*?)\n<\/studio_instance_status>\n/.exec(result.output)
      ?.groups?.json;
    expect(JSON.parse(statusJson!)).toMatchObject(status);
    expect(result.render).toMatchObject({ outputSummary: "missing_target_guid" });
  });
});

describe("level.save.file", () => {
  const writes: Array<[string, Record<string, unknown>]> = [
    ["studiorpc_script_add", { class: "Script", parentGuid: FOLDER_A_GUID, name: "S", source: "print(1)" }],
    ["studiorpc_script_edit", { guid: SCRIPT_GUID, old_string: "print(1)", new_string: "print(9)" }],
    ["studiorpc_script_delete", { guid: SCRIPT_GUID }],
  ];

  for (const [name, args] of writes) {
    test(`${name} attributes every RPC to the executing child`, async () => {
      const tools = await loadTools(makeStudioProject());
      const result = await runWithSessionExecutionContext(
        {
          sessionId: "child-A",
          rootSessionId: "A",
          resumed: false,
          rootRequest: { sessionId: "A", requestId: "request-A" },
        },
        () => tools.get(name)!.execute(args, toolContext()),
      );
      expect(result.metadata?.error).toBeUndefined();
      expect(rpcCalls.length).toBeGreaterThan(0);
      for (const request of rpcCalls) expect(request.meta).toEqual({ sessionId: "child-A" });
    });

    const savesAfterWrite = name !== "studiorpc_script_edit";
    const behavior = savesAfterWrite
      ? "saves the level after the write succeeds"
      : "edits without automatically saving the level";
    test(`${name} ${behavior}`, async () => {
      const tools = await loadTools(makeStudioProject());
      const result = await tools.get(name)!.execute(args, toolContext());
      expect(result.metadata?.error).toBeUndefined();
      const methods = methodsCalled();
      const writeIndex = methods.findLastIndex((method) =>
        ["instance.create", "instance.update", "instance.delete"].includes(method),
      );
      expect(writeIndex).toBeGreaterThanOrEqual(0);
      expect(methods.filter((method) => method === "level.save.file")).toHaveLength(savesAfterWrite ? 1 : 0);
      if (savesAfterWrite) {
        // Read-only validation may follow the save; the write must precede it.
        expect(methods.indexOf("level.save.file")).toBeGreaterThan(writeIndex);
      }
    });
  }

  const reads: Array<[string, Record<string, unknown>]> = [
    ["studiorpc_instance_read", { guid: PART_GUID, recursive: false }],
    ["studiorpc_script_read", { guid: SCRIPT_GUID }],
    ["studiorpc_script_grep", { pattern: "print" }],
  ];

  for (const [name, args] of reads) {
    test(`${name} does not save the level`, async () => {
      const tools = await loadTools(makeStudioProject());
      const result = await tools.get(name)!.execute(args, toolContext());
      expect(result.metadata?.error).toBeUndefined();
      expect(methodsCalled()).not.toContain("level.save.file");
    });
  }
});

describe("failure reporting", () => {
  test("does not report success when Studio returns a partial failure", async () => {
    const tools = await loadTools(makeStudioProject());
    respond = (method, params) => {
      if (method === "instance.delete") return { success: true, message: "1 instance could not be deleted" };
      return studioResponder(method, params);
    };

    const result = await tools.get("studiorpc_script_delete")!.execute({ guid: SCRIPT_GUID }, toolContext());

    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("partial failure");
    expect(methodsCalled()).not.toContain("level.save.file");
  });

  test("does not save the level when Studio reports success:false", async () => {
    const tools = await loadTools(makeStudioProject());
    respond = (method, params) => {
      if (method === "instance.delete") return { success: false, message: "target is locked" };
      return studioResponder(method, params);
    };

    const result = await tools.get("studiorpc_script_delete")!.execute({ guid: SCRIPT_GUID }, toolContext());

    expect(result.metadata?.error).toBe(true);
    expect(result.output).toMatch(/instance\.delete failed: target is locked/);
    expect(methodsCalled()).not.toContain("level.save.file");
  });

  test("does not report success when script_add gets a partial failure", async () => {
    const tools = await loadTools(makeStudioProject());
    respond = (method, params) => {
      if (method === "instance.create") return { success: true, ActorGuids: [], message: "parent is read-only" };
      return studioResponder(method, params);
    };

    const result = await tools
      .get("studiorpc_script_add")!
      .execute({ class: "Script", parentGuid: FOLDER_A_GUID, name: "S", source: "print(1)" }, toolContext());

    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("partial failure");
    expect(methodsCalled()).not.toContain("level.save.file");
  });
});

describe("validation", () => {
  test("refuses to delete a non-script instance through script_delete", async () => {
    const tools = await loadTools(makeStudioProject());

    const result = await tools.get("studiorpc_script_delete")!.execute({ guid: PART_GUID }, toolContext());

    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("not a script");
    expect(methodsCalled()).toEqual(["instance.read"]);
  });

  test("refuses instances without Source through script_edit", async () => {
    const tools = await loadTools(makeStudioProject());

    const result = await tools
      .get("studiorpc_script_edit")!
      .execute({ guid: PART_GUID, old_string: "a", new_string: "b" }, toolContext());

    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("no Source");
    expect(methodsCalled()).toEqual(["instance.read"]);
  });

  test("focused Source edits preserve non-Lua indentation for future classes", async () => {
    const recipe = {
      InstanceType: "FutureSourceContainer",
      ActorGuid: "RECIPE",
      Source: "def on_generate():\n    pass",
    };
    world.LuaChildren!.push(recipe);
    const tools = await loadTools(makeStudioProject());
    const read = await tools.get("studiorpc_script_read")!.execute({ guid: "RECIPE" }, toolContext());
    const edit = await tools
      .get("studiorpc_script_edit")!
      .execute({ guid: "RECIPE", old_string: "pass", new_string: "return" }, toolContext());
    expect(read.output).toContain("    pass");
    expect(edit.metadata).toMatchObject({ method: "script.edit", count: 1 });
    const expectedSource = ["def on_generate():", "    return"].join(EOL);
    expect(paramsOf("instance.update")).toEqual({
      Instances: [{ ActorGuid: "RECIPE", Source: expectedSource }],
    });
    expect(methodsCalled()).toEqual(["instance.read", "instance.read", "instance.update"]);
  });
});

describe("dedicated VFXRecipe authoring", () => {
  test("creates and patches normalized recipe JSON through the registered tool", async () => {
    const tools = await loadTools(makeStudioProject());
    const tool = tools.get("studiorpc_vfx_recipe_upsert")!;
    expect(tool).toBeDefined();
    const result = await tool.execute(
      {
        items: [
          {
            parentGuid: WORKSPACE_GUID,
            name: "Recipe",
            properties: {
              AutoActivate: false,
              InfiniteLoop: false,
              LoopCount: 3,
              BaseLayer: [
                {
                  Name: "Body",
                  NiagaraSystem: "NeutralBurst_A",
                  Position: { X: 1, Y: 2, Z: 3 },
                  SpawnCount: 3,
                  Alpha: [{ Time: 0, Value: 1 }],
                },
              ],
            },
          },
        ],
      },
      toolContext(),
    );
    expect(result.metadata?.error).not.toBe(true);
    const create = paramsOf("instance.create") as { Instances: Array<Record<string, unknown>> };
    expect(create.Instances[0]).toMatchObject({ InstanceType: "VFXRecipe", AutoActivate: false });
    expect((create.Instances[0].BaseLayer as Array<Record<string, unknown>>)[0]).toMatchObject({
      NiagaraSystem:
        "/CommonContent/VFX/Layer/0_Base/NeutralBurst_A/VFX_UGC_Base_NeutralBurst_A.VFX_UGC_Base_NeutralBurst_A",
      Position: { ObjectType: "Vector3" },
      Alpha: [{ Time: 0, Value: 1 }],
    });
    expect(result.metadata?.addCount).toBe(1);
    const added = result.metadata?.added as Array<{ guid: string }>;
    // The transport fixture issues GUIDs but does not persist create calls.
    world.LuaChildren!.push({ ...create.Instances[0], ActorGuid: added[0].guid });
    rpcCalls.length = 0;
    const patched = await tool.execute(
      { items: [{ guid: added[0].guid, properties: { BaseLayer: [], LoopCount: 2 } }] },
      toolContext(),
    );
    expect(patched.metadata?.error).not.toBe(true);
    expect(paramsOf("instance.update")).toEqual({
      Instances: [{ ActorGuid: added[0].guid, BaseLayer: [], LoopCount: 2 }],
    });
    expect(rpcCalls.filter((call) => call.method === "level.save.file")).toHaveLength(1);
  });
  test("rejects a non-recipe GUID anywhere in the batch before sending an update or save", async () => {
    world.LuaChildren!.push({ InstanceType: "VFXRecipe", ActorGuid: "R", Name: "Recipe", LoopCount: 4 });
    const tools = await loadTools(makeStudioProject());
    await expect(
      tools.get("studiorpc_vfx_recipe_upsert")!.execute(
        {
          items: [
            { guid: "R", properties: { LoopCount: 2 } },
            { guid: PART_GUID, properties: {} },
          ],
        },
        toolContext(),
      ),
    ).rejects.toThrow("VFXRecipe");
    expect(rpcCalls.some((call) => call.method === "instance.update" || call.method === "level.save.file")).toBe(false);
  });

  test("ignores Mobility below a top-level object and reports it", async () => {
    const tools = await loadTools(makeStudioProject());
    const result = await tools
      .get("studiorpc_vfx_recipe_upsert")!
      .execute(
        { items: [{ parentGuid: PART_GUID, name: "Nested", properties: { Mobility: "Static" } }] },
        toolContext(),
      );

    expect(result.metadata?.info).toEqual([
      expect.stringMatching(/^Ignored Mobility for .+: Mobility can only be changed on a direct child of Workspace\.$/),
    ]);
    const create = paramsOf("instance.create") as { Instances: Array<Record<string, unknown>> };
    expect(create.Instances[0]).not.toHaveProperty("Mobility");
  });
});
