// @summary Tests that the geometry-recipe tools register, validate input, create-and-bake, and reuse recipe files.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@diligent/core/tool-contract";
import { createStudioRpcToolProvider } from "../../../../src/tools/studiorpc";
import * as geometryApi from "../../../../src/tools/studiorpc/methods/geometry.api";
import * as geometryValidate from "../../../../src/tools/studiorpc/methods/geometry.validate";
import * as proceduralModelSet from "../../../../src/tools/studiorpc/methods/proceduralmodel.set";
import { mutatingMethods, savingMethods } from "../../../../src/tools/studiorpc/tool-registry";

type RpcCall = { method: string; params?: Record<string, unknown> };

const RECIPE = "def on_generate(model, size, attributes):\n    pass";

async function loadTools(respond: (call: RpcCall) => unknown, calls: RpcCall[] = []): Promise<Map<string, Tool>> {
  const provider = createStudioRpcToolProvider({
    callRpc: async (rpcMethod, rpcParams) => {
      calls.push({ method: rpcMethod, params: rpcParams });
      return respond({ method: rpcMethod, params: rpcParams });
    },
  });
  const tools = await provider.createTools({ cwd: "/tmp/project", host: { approve: async () => "once" } });
  return new Map(tools.map((tool) => [tool.name, tool]));
}

function toolContext() {
  return { toolCallId: "test", signal: new AbortController().signal, abort: () => {} };
}

/** A mock callRpc that records its calls and answers the RPCs the geometry tools issue. */
function recordingRpc(overrides: Partial<Record<string, unknown>> = {}) {
  const calls: RpcCall[] = [];
  const callRpc = async (method: string, params?: Record<string, unknown>) => {
    calls.push({ method, params });
    if (method in overrides) return overrides[method];
    if (method === "instance.create") return { ActorGuids: ["NEWGUID"] };
    if (method === "level.browse") return { level: [{ Name: "Workspace", ActorGuid: "WS-GUID" }] };
    return { success: true };
  };
  return { calls, callRpc };
}

function writeRecipeFile(body = RECIPE): string {
  const dir = mkdtempSync(join(tmpdir(), "ovdr-recipe-"));
  const path = join(dir, "recipe.py");
  writeFileSync(path, body, "utf-8");
  return path;
}

describe("geometry-recipe tool surface", () => {
  test("exposes the three authoring tools under stable names", async () => {
    const tools = await loadTools(() => ({}));
    expect(tools.has("studiorpc_geometry_api")).toBe(true);
    expect(tools.has("studiorpc_geometry_validate")).toBe(true);
    expect(tools.has("studiorpc_proceduralmodel_set")).toBe(true);
  });

  test("only the bake mutates: it takes the write lock, the reads do not", () => {
    expect(mutatingMethods.has(proceduralModelSet.method)).toBe(true);
    expect(mutatingMethods.has(geometryApi.method)).toBe(false);
    expect(mutatingMethods.has(geometryValidate.method)).toBe(false);
    // None of them persist the level on their own; a bake is committed by its own run, not a file save.
    expect(savingMethods.has(proceduralModelSet.method)).toBe(false);
  });
});

describe("geometry.api arguments", () => {
  test("takes no required argument and rejects unknown fields", () => {
    expect(geometryApi.params.parse({}).maxNoteBytes).toBeUndefined();
    expect(geometryApi.params.parse({ maxNoteBytes: 2000 }).maxNoteBytes).toBe(2000);
    expect(() => geometryApi.params.parse({ maxNoteBytes: 0 })).toThrow();
    expect(() => geometryApi.params.parse({ notes: true })).toThrow();
  });
});

describe("geometry.validate arguments and file reuse", () => {
  test("accepts code, id, or sourcePath and rejects unknown fields", () => {
    expect(geometryValidate.params.parse({ code: RECIPE }).code).toContain("on_generate");
    expect(geometryValidate.params.parse({ id: "crate" }).id).toBe("crate");
    expect(geometryValidate.params.parse({ sourcePath: "/x/recipe.py" }).sourcePath).toBe("/x/recipe.py");
    expect(() => geometryValidate.params.parse({ code: "" })).toThrow();
    expect(() => geometryValidate.params.parse({ source: "x" })).toThrow();
  });

  test("preCall reads sourcePath into code, and normalizeArgs drops sourcePath", async () => {
    const path = writeRecipeFile();
    const args: Record<string, unknown> = { sourcePath: path };
    await geometryValidate.preCall(args);
    expect(args.code).toContain("on_generate");
    expect(geometryValidate.normalizeArgs(args)).toEqual({ code: RECIPE });
  });

  test("preCall refuses sourcePath together with code or id", async () => {
    await expect(geometryValidate.preCall({ sourcePath: "/x.py", code: RECIPE })).rejects.toThrow(/exactly one/i);
    await expect(geometryValidate.preCall({ sourcePath: "/x.py", id: "crate" })).rejects.toThrow(/exactly one/i);
  });

  test("preCall surfaces a missing recipe file", async () => {
    await expect(geometryValidate.preCall({ sourcePath: "/no/such/recipe.py" })).rejects.toThrow(/Could not read/i);
  });
});

describe("proceduralmodel.set arguments", () => {
  test("guid is optional now and every field is validated", () => {
    // An empty object is a valid shape — preCall enforces guid-or-name at runtime, not the schema.
    expect(() => proceduralModelSet.params.parse({})).not.toThrow();
    const parsed = proceduralModelSet.params.parse({
      guid: "ABC",
      source: RECIPE,
      size: [90, 210, 30],
      attributes: { plank_count: 5, tint: [200, 90, 40], flag: true, note: "x", cleared: null },
      rebuild: true,
    });
    expect(parsed.guid).toBe("ABC");
    expect(parsed.size).toEqual([90, 210, 30]);
    expect(parsed.rebuild).toBe(true);
  });

  test("rejects a size that is not three numbers", () => {
    expect(() => proceduralModelSet.params.parse({ guid: "A", size: [1, 2] })).toThrow();
  });
});

describe("proceduralmodel.set preCall: create-and-bake and file reuse", () => {
  test("refuses when neither guid nor name is given", async () => {
    const { callRpc } = recordingRpc();
    await expect(proceduralModelSet.preCall({}, callRpc)).rejects.toThrow(/guid.*or.*name/i);
  });

  test("refuses source and sourcePath together", async () => {
    const { callRpc } = recordingRpc();
    await expect(
      proceduralModelSet.preCall({ guid: "A", source: RECIPE, sourcePath: "/x.py" }, callRpc),
    ).rejects.toThrow(/not both/i);
  });

  test("reads sourcePath into source for an existing model", async () => {
    const path = writeRecipeFile();
    const { calls, callRpc } = recordingRpc();
    const args: Record<string, unknown> = { guid: "A", sourcePath: path, rebuild: true };
    await proceduralModelSet.preCall(args, callRpc);
    expect(args.source).toContain("on_generate");
    // No creation happened for an existing guid.
    expect(calls.find((c) => c.method === "instance.create")).toBeUndefined();
  });

  test("creates the model when guid is omitted, using an explicit parentGuid", async () => {
    const { calls, callRpc } = recordingRpc();
    const args: Record<string, unknown> = { name: "crate", parentGuid: "PARENT", source: RECIPE, rebuild: true };
    await proceduralModelSet.preCall(args, callRpc);
    expect(args.guid).toBe("NEWGUID");
    const create = calls.find((c) => c.method === "instance.create");
    expect(create?.params).toMatchObject({
      ParentActorGuid: "PARENT",
      Instances: [{ InstanceType: "ProceduralModel", Name: "crate" }],
    });
    // Did not need to look up Workspace because a parent was given.
    expect(calls.find((c) => c.method === "level.browse")).toBeUndefined();
  });

  test("resolves Workspace as the default parent when none is given", async () => {
    const { calls, callRpc } = recordingRpc();
    const args: Record<string, unknown> = { name: "crate", source: RECIPE, rebuild: true };
    await proceduralModelSet.preCall(args, callRpc);
    expect(args.guid).toBe("NEWGUID");
    expect(calls.find((c) => c.method === "level.browse")).toBeDefined();
    const create = calls.find((c) => c.method === "instance.create");
    expect(create?.params).toMatchObject({ ParentActorGuid: "WS-GUID" });
  });
});

describe("proceduralmodel.set normalizeArgs and postProcess", () => {
  test("normalizeArgs forwards only Studio keys, dropping name/parentGuid/sourcePath", () => {
    const out = proceduralModelSet.normalizeArgs({
      guid: "G",
      name: "crate",
      parentGuid: "P",
      sourcePath: "/x.py",
      source: RECIPE,
      size: [1, 2, 3],
      attributes: { a: 1 },
      autoRebuild: true,
      rebuild: true,
    });
    expect(out).toEqual({
      guid: "G",
      source: RECIPE,
      size: [1, 2, 3],
      attributes: { a: 1 },
      autoRebuild: true,
      rebuild: true,
    });
  });

  test("postProcess surfaces the guid and whether it was created", () => {
    const created = proceduralModelSet.postProcess({ success: true }, { guid: "G", __createdModel: true });
    expect(created).toMatchObject({ success: true, guid: "G", created: true });
    const reused = proceduralModelSet.postProcess({ success: true }, { guid: "G" });
    expect(reused).toMatchObject({ guid: "G", created: false });
  });
});

describe("proceduralmodel.set forwarding through the tool wrapper", () => {
  test("bakes an existing model and returns the run report", async () => {
    const calls: RpcCall[] = [];
    const report = { success: true, run: { success: true, parts: [{ name: "body" }] } };
    const tools = await loadTools((call) => (call.method === "proceduralmodel.set" ? report : {}), calls);
    const tool = tools.get("studiorpc_proceduralmodel_set");
    if (!tool) throw new Error("studiorpc_proceduralmodel_set is not advertised");

    const executed = await tool.execute({ guid: "ABC", source: RECIPE, rebuild: true }, toolContext());

    const bakeCall = calls.find((call) => call.method === "proceduralmodel.set");
    expect(bakeCall?.params).toMatchObject({ guid: "ABC", rebuild: true });
    expect(JSON.parse(executed.output)).toMatchObject({ success: true, guid: "ABC", created: false });
    expect(executed.metadata).toMatchObject({ method: "proceduralmodel.set" });
  });

  test("creates the model then bakes it in one call, returning the new guid", async () => {
    const calls: RpcCall[] = [];
    const respond = (call: RpcCall) => {
      if (call.method === "instance.create") return { ActorGuids: ["MADEGUID"] };
      if (call.method === "level.browse") return { level: [{ Name: "Workspace", ActorGuid: "WS-GUID" }] };
      if (call.method === "proceduralmodel.set") return { success: true, run: { success: true } };
      return {};
    };
    const tools = await loadTools(respond, calls);
    const tool = tools.get("studiorpc_proceduralmodel_set");
    if (!tool) throw new Error("studiorpc_proceduralmodel_set is not advertised");

    const executed = await tool.execute({ name: "crate", source: RECIPE, rebuild: true }, toolContext());

    const order = calls.map((c) => c.method);
    expect(order.indexOf("instance.create")).toBeLessThan(order.indexOf("proceduralmodel.set"));
    const bake = calls.find((c) => c.method === "proceduralmodel.set");
    // The tool-only creation fields never reach Studio's bake RPC.
    expect(bake?.params).toMatchObject({ guid: "MADEGUID", rebuild: true });
    expect(bake?.params).not.toHaveProperty("name");
    expect(bake?.params).not.toHaveProperty("parentGuid");
    expect(JSON.parse(executed.output)).toMatchObject({ success: true, guid: "MADEGUID", created: true });
  });
});
