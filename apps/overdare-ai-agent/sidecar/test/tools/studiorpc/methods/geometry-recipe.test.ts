// @summary Tests that the geometry-recipe tools register, validate input, and forward to Studio.

import { describe, expect, test } from "bun:test";
import type { Tool } from "@diligent/core/tool-contract";
import { createStudioRpcToolProvider } from "../../../../src/tools/studiorpc";
import * as geometryApi from "../../../../src/tools/studiorpc/methods/geometry.api";
import * as geometryValidate from "../../../../src/tools/studiorpc/methods/geometry.validate";
import * as proceduralModelSet from "../../../../src/tools/studiorpc/methods/proceduralmodel.set";
import { mutatingMethods, savingMethods } from "../../../../src/tools/studiorpc/tool-registry";

type RpcCall = { method: string; params?: Record<string, unknown> };

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

describe("geometry.validate arguments", () => {
  test("accepts code or id and rejects unknown fields", () => {
    expect(
      geometryValidate.params.parse({ code: "def on_generate(model, size, attributes):\n    pass" }).code,
    ).toContain("on_generate");
    expect(geometryValidate.params.parse({ id: "crate" }).id).toBe("crate");
    expect(() => geometryValidate.params.parse({ code: "" })).toThrow();
    expect(() => geometryValidate.params.parse({ source: "x" })).toThrow();
  });
});

describe("proceduralmodel.set arguments", () => {
  test("requires a guid and accepts the authoring fields", () => {
    expect(() => proceduralModelSet.params.parse({})).toThrow();
    const parsed = proceduralModelSet.params.parse({
      guid: "ABC",
      source: "def on_generate(model, size, attributes):\n    pass",
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

describe("proceduralmodel.set forwarding", () => {
  test("bakes through Studio and returns the run report", async () => {
    const calls: RpcCall[] = [];
    const report = {
      success: true,
      previewStatus: "Baked 1 part(s) locally.",
      run: { success: true, parts: [{ name: "body" }] },
    };
    const tools = await loadTools((call) => (call.method === "proceduralmodel.set" ? report : {}), calls);
    const tool = tools.get("studiorpc_proceduralmodel_set");
    if (!tool) throw new Error("studiorpc_proceduralmodel_set is not advertised");

    const executed = await tool.execute(
      { guid: "ABC", source: "def on_generate(model, size, attributes):\n    pass", rebuild: true },
      toolContext(),
    );

    const bakeCall = calls.find((call) => call.method === "proceduralmodel.set");
    expect(bakeCall?.params).toMatchObject({ guid: "ABC", rebuild: true });
    expect(JSON.parse(executed.output)).toMatchObject({ success: true });
    expect(executed.metadata).toMatchObject({ method: "proceduralmodel.set" });
  });
});
