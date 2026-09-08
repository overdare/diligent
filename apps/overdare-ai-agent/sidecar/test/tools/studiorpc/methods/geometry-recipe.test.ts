// @summary Tests that the geometry-recipe tools register, validate input, create-and-bake, and reuse recipe files.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeTool, type Tool } from "@diligent/core/tool-contract";
import { createStudioRpcToolProvider } from "../../../../src/tools/studiorpc";
import * as proceduralModelApi from "../../../../src/tools/studiorpc/methods/proceduralmodel.api";
import * as proceduralModelSet from "../../../../src/tools/studiorpc/methods/proceduralmodel.set";
import * as proceduralModelValidate from "../../../../src/tools/studiorpc/methods/proceduralmodel.validate";
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
    expect(tools.has("studiorpc_proceduralmodel_api")).toBe(true);
    expect(tools.has("studiorpc_proceduralmodel_validate")).toBe(true);
    expect(tools.has("studiorpc_proceduralmodel_set")).toBe(true);
  });

  test("only the bake mutates: it takes the write lock, the reads do not", () => {
    expect(mutatingMethods.has(proceduralModelSet.method)).toBe(true);
    expect(mutatingMethods.has(proceduralModelApi.method)).toBe(false);
    expect(mutatingMethods.has(proceduralModelValidate.method)).toBe(false);
    // None of them persist the level on their own; a bake is committed by its own run, not a file save.
    expect(savingMethods.has(proceduralModelSet.method)).toBe(false);
  });
});

describe("proceduralmodel.api arguments", () => {
  test("takes no required argument and rejects unknown fields", () => {
    expect(proceduralModelApi.params.parse({})).toEqual({});
    // Query selects server-owned API content; it does not accept arbitrary output-limit flags.
    expect(() => proceduralModelApi.params.parse({ maxNoteBytes: 2000 })).toThrow();
    expect(() => proceduralModelApi.params.parse({ notes: true })).toThrow();
  });
});

describe("proceduralmodel.api discovery (compact by default, query to expand)", () => {
  const API_RESULT = {
    class: "OvdrGeometry",
    success: true,
    template: "def on_generate(model, size, attributes):\n    pass",
    presets: ["Plank", "Glass", "ThickCarpet"],
    enums: { OvdrOriginMode: ["BASE", "CENTER"] },
    quickref: "G.new_mesh() ...",
    lookup: {
      "G.append_sphere": "append_sphere(mesh, ...)",
      "G.get_bounds": "get_bounds(mesh) -> (min, max)",
      "parts.rib": "rib(length, ...)",
    },
    signatures: { "G.append_sphere": "append_sphere(...)", "parts.rib": "rib(...)" },
    functions: [
      { name: "append_sphere", doc: "A UV sphere", params: [] },
      { name: "get_bounds", doc: "Bounding box" },
    ],
    notes: "long prose reference",
    caveats: "stuff",
    pythonModules: ["math"],
  };

  test("normalizeArgs forwards nothing — query is applied host-side", () => {
    expect(proceduralModelApi.normalizeArgs({ query: ["x"] })).toEqual({});
    expect(proceduralModelApi.normalizeArgs({})).toEqual({});
  });

  test("default reply is the compact kit — no verbose functions or notes", () => {
    const out = proceduralModelApi.postProcess(API_RESULT, {}) as Record<string, unknown>;
    expect(out.template).toBe(API_RESULT.template);
    expect(out.presets).toEqual(API_RESULT.presets);
    expect(out.availableFunctions).toEqual(Object.keys(API_RESULT.lookup));
    expect(out.lookup).toBeUndefined();
    expect(out.quickref).toBeUndefined();
    expect(out.functions).toBeUndefined();
    expect(out.notes).toBeUndefined();
    expect(String(out.hint)).toContain("query");
  });

  test("query returns matching calls without unrelated document sections", () => {
    const out = proceduralModelApi.postProcess(API_RESULT, { query: ["sphere", "bounds"] }) as Record<string, unknown>;
    expect(Object.keys(out.lookup as object)).toEqual(["G.append_sphere", "G.get_bounds"]);
    expect((out.functions as { name: string }[]).map((fn) => fn.name)).toEqual(["append_sphere", "get_bounds"]);
    expect(out.notes).toBeUndefined();
    expect(out.template).toBeUndefined();
    expect(out.quickref).toBeUndefined();
    expect(out.presets).toBeUndefined();
  });

  test("document names select only those sections and missing names are explicit", () => {
    const out = proceduralModelApi.postProcess(API_RESULT, { query: ["template", "model.part", "rib"] }) as Record<
      string,
      unknown
    >;
    expect(out.template).toBe(API_RESULT.template);
    expect(Object.keys(out.lookup as object)).toEqual(["parts.rib"]);
    expect(out.unmatchedQueries).toEqual(["model.part"]);
    expect(out.availableSections).toContain("quickref");
    expect(out.quickref).toBeUndefined();
    expect(out.notes).toBeUndefined();
    const notes = proceduralModelApi.postProcess(API_RESULT, { query: "notes" }) as Record<string, unknown>;
    expect(notes.notes).toBe(API_RESULT.notes);
    expect(notes.template).toBeUndefined();
    expect(notes.lookup).toBeUndefined();
  });

  test("large unrequested documentation cannot cause executor truncation or broken JSON", async () => {
    const large = {
      ...API_RESULT,
      quickref: "unrelated quick reference\n".repeat(4000),
      notes: "unrelated detailed notes\n".repeat(4000),
      lookup: {
        ...Object.fromEntries(
          Array.from({ length: 150 }, (_, i) => [`G.other_${i}`, `other_${i}() -- ${"details ".repeat(100)}`]),
        ),
        ...API_RESULT.lookup,
      },
    };
    const tools = await loadTools(() => large);
    for (const input of [{}, { query: ["template", "sphere", "bounds"] }]) {
      const result = await executeTool(
        tools,
        { type: "tool_call", id: "api", name: "studiorpc_proceduralmodel_api", input },
        toolContext(),
      );
      expect(result.metadata?.truncated).toBeUndefined();
      const output = JSON.parse(result.output);
      expect(output.template).toBe(large.template);
      expect(output.notes).toBeUndefined();
      expect(output.quickref).toBeUndefined();
      if ("query" in input) expect(Object.keys(output.lookup)).toEqual(["G.append_sphere", "G.get_bounds"]);
      else expect(output.availableFunctions).toEqual(Object.keys(large.lookup));
    }
  });

  test("an oversized UTF-8 selection returns a complete index instead of a JSON fragment", async () => {
    const tools = await loadTools(() => ({
      ...API_RESULT,
      lookup: { "G.huge": `huge() -- ${"\u754c".repeat(20_000)}` },
    }));
    const result = await executeTool(
      tools,
      { type: "tool_call", id: "api", name: "studiorpc_proceduralmodel_api", input: { query: "huge" } },
      toolContext(),
    );
    expect(result.metadata?.truncated).toBeUndefined();
    const output = JSON.parse(result.output);
    expect(output.needsNarrowerQuery).toBe(true);
    expect(output.availableFunctions).toEqual(["G.huge"]);
    expect(output.lookup).toBeUndefined();
    expect(output.notes).toBeUndefined();
  });

  test("a placeholder query ('x') is ignored and falls back to the compact kit", () => {
    const out = proceduralModelApi.postProcess(API_RESULT, { query: "x" }) as Record<string, unknown>;
    expect(out.functions).toBeUndefined();
    expect(out.hint).toBeDefined();
  });

  test("params accepts query and rejects unknown fields", () => {
    expect(proceduralModelApi.params.parse({ query: ["append_box"] }).query).toEqual(["append_box"]);
    expect(proceduralModelApi.params.parse({ query: "rib" }).query).toBe("rib");
    expect(() => proceduralModelApi.params.parse({ notes: true })).toThrow();
  });
});

describe("proceduralmodel.validate arguments and file reuse", () => {
  test("accepts code or sourcePath and rejects unknown fields", () => {
    expect(proceduralModelValidate.params.parse({ code: RECIPE }).code).toContain("on_generate");
    expect(proceduralModelValidate.params.parse({ sourcePath: "/x/recipe.py" }).sourcePath).toBe("/x/recipe.py");
    expect(() => proceduralModelValidate.params.parse({ code: "" })).toThrow();
    expect(() => proceduralModelValidate.params.parse({ source: "x" })).toThrow();
    expect(() => proceduralModelValidate.params.parse({ id: "crate" })).toThrow(); // id was removed from the tool
  });

  test("preCall reads sourcePath into code, and normalizeArgs drops sourcePath", async () => {
    const path = writeRecipeFile();
    const args: Record<string, unknown> = { sourcePath: path };
    await proceduralModelValidate.preCall(args);
    expect(args.code).toContain("on_generate");
    expect(proceduralModelValidate.normalizeArgs(args)).toEqual({ code: RECIPE });
  });

  test("a strict provider fills both fields with placeholders; the one real input still wins", async () => {
    // gpt-5.6-terra sends both code and sourcePath, padding the unused one. Resolve, do not reject.
    const args: Record<string, unknown> = { code: RECIPE, sourcePath: "x" };
    await proceduralModelValidate.preCall(args);
    expect(args.code).toBe(RECIPE);
    expect(args.sourcePath).toBeUndefined();
    expect(proceduralModelValidate.normalizeArgs(args)).toEqual({ code: RECIPE });
  });

  test("a real sourcePath wins over inline code when both are supplied", async () => {
    const path = writeRecipeFile("def on_generate(model, size, attributes):\n    model.part('from_file')");
    const args: Record<string, unknown> = { sourcePath: path, code: RECIPE };
    await proceduralModelValidate.preCall(args);
    expect(args.code).toContain("from_file"); // read from the file, not the inline code
  });

  test("throws a clear error when every field is blank or a placeholder", async () => {
    await expect(proceduralModelValidate.preCall({ code: "x", sourcePath: "x" })).rejects.toThrow(/no recipe/i);
    await expect(proceduralModelValidate.preCall({ code: " ", sourcePath: " " })).rejects.toThrow(/no recipe/i);
  });

  test("preCall surfaces a missing recipe file", async () => {
    await expect(proceduralModelValidate.preCall({ sourcePath: "/no/such/recipe.py" })).rejects.toThrow(
      /Could not read/i,
    );
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

  test("ignores a placeholder sourcePath and keeps the inline source", async () => {
    // A strict provider pads sourcePath with "x"; it must not shadow the real inline recipe.
    const { calls, callRpc } = recordingRpc();
    const args: Record<string, unknown> = { guid: "A", source: RECIPE, sourcePath: "x", rebuild: true };
    await proceduralModelSet.preCall(args, callRpc);
    expect(args.source).toBe(RECIPE);
    expect(args.sourcePath).toBeUndefined();
    expect(calls.find((c) => c.method === "instance.create")).toBeUndefined();
  });

  test("a real sourcePath wins over inline source when both are supplied", async () => {
    const path = writeRecipeFile("def on_generate(model, size, attributes):\n    model.part('from_file')");
    const { callRpc } = recordingRpc();
    const args: Record<string, unknown> = { guid: "A", source: RECIPE, sourcePath: path, rebuild: true };
    await proceduralModelSet.preCall(args, callRpc);
    expect(String(args.source)).toContain("from_file"); // read from the file, not the inline source
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

test("geometry recipes coexist with Editor Luau without advertising the retired builder", async () => {
  const tools = await loadTools(() => ({ success: true }));
  for (const name of [
    "studiorpc_proceduralmodel_api",
    "studiorpc_proceduralmodel_validate",
    "studiorpc_proceduralmodel_set",
    "studiorpc_execute_luau",
    "studiorpc_instance_schema_search",
  ])
    expect(tools.has(name)).toBe(true);
  expect(tools.has("studiorpc_procedural_run")).toBe(false);
  const skill = readFileSync(join(import.meta.dir, "../../../../../bootstrap/skills/geometry-recipe/SKILL.md"), "utf8");
  const agent = readFileSync(join(import.meta.dir, "../../../../../bootstrap/agents/geometry-recipe/AGENT.md"), "utf8");
  for (const content of [skill, agent, proceduralModelApi.description]) {
    expect(/procedural[-_]builder|studiorpc_procedural_run/.test(content)).toBe(false);
    expect(content).toContain("studiorpc_execute_luau");
  }
});
