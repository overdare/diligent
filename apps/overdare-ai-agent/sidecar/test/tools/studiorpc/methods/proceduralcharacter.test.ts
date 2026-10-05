// @summary Verifies generic custom character tools are discoverable and cannot accept ODA costume requests.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioRpcTools } from "../../../../src/tools/studiorpc";
import * as character from "../../../../src/tools/studiorpc/methods/proceduralcharacter";
import { methodModules, mutatingMethods, savingMethods } from "../../../../src/tools/studiorpc/tool-registry";

describe("non-ODA character authoring", () => {
  test("keeps external interchange on the existing FBX export contract", () => {
    const request = {
      buildId: "A".repeat(32),
      expectedRevision: {
        sourceRevision: "B".repeat(40),
        geometryHash: "C".repeat(40),
        rigRevision: "D".repeat(40),
        animationRevision: "E".repeat(40),
      },
    };
    expect(character.exportAsset.params.parse(request)).toEqual(request);
    expect(character.exportAsset.params.safeParse({ ...request, format: "native_parts" }).success).toBe(false);
  });
  test("forwards inspected static geometry and direct authored rig and motion through the existing build tool", async () => {
    const request = {
      requestId: "imported-panel-rig",
      source: { kind: "static_model", guid: "B".repeat(32), geometryRevision: "A".repeat(40) },
      target: { kind: "new_custom_character", name: "ImportedPanel" },
      rigProfile: "authored_v1",
      rig: { space: "mesh_component_ue_z_up_cm", bones: [], regions: {} },
      motion: { preset: "authored_v1", speedCmPerSec: 20, document: { fps: 30, poses: [] } },
      commit: false,
    };
    const calls: Array<{ method: string; params: unknown }> = [];
    const tools = await createStudioRpcTools({
      cwd: tmpdir(),
      callRpc: async (method, params) => {
        calls.push({ method, params });
        return { state: "preview_ready" };
      },
    });
    const tool = tools.find((entry) => entry.name === "studiorpc_proceduralcharacter_build")!;
    await tool.execute(request, { toolCallId: "static-build", signal: new AbortController().signal, abort: () => {} });
    expect(calls).toEqual([{ method: character.build.method, params: request }]);
    expect(character.build.params.safeParse({ ...request, rig: undefined }).success).toBe(false);
    expect(
      character.build.params.safeParse({ ...request, motion: { preset: "authored_v1", speedCmPerSec: 20 } }).success,
    ).toBe(false);
    expect(
      character.build.params.safeParse({ ...request, source: { ...request.source, geometryRevision: "stale" } })
        .success,
    ).toBe(false);
    expect(character.build.params.safeParse({ ...request, overrides: { size: 2 } }).success).toBe(false);
    expect(
      character.build.params.safeParse({ ...request, source: { kind: "procedural_model", guid: "B".repeat(32) } })
        .success,
    ).toBe(false);
    expect(savingMethods.has(character.build.method)).toBe(false);
  });
  test("build forwards a procedural model GUID and preserves native ownership of its frozen inputs", async () => {
    const request = {
      requestId: "model-source-draft",
      source: { kind: "procedural_model", guid: "ABCDEF0123456789ABCDEF0123456789" },
      target: { kind: "new_custom_character", name: "ModelSourceCharacter" },
      rigProfile: "authored_v1",
      motion: { preset: "authored_v1", speedCmPerSec: 20 },
      overrides: { jointWidth: 4 },
      commit: false,
    };
    expect(character.build.params.parse(request)).toEqual(request);
    const calls: Array<{ method: string; params: unknown }> = [];
    const tools = await createStudioRpcTools({
      cwd: tmpdir(),
      callRpc: async (method, params) => {
        calls.push({ method, params });
        return { buildId: "A".repeat(32), state: "preview_ready" };
      },
    });
    const tool = tools.find((entry) => entry.name === "studiorpc_proceduralcharacter_build")!;
    await tool.execute(request, { toolCallId: "model-build", signal: new AbortController().signal, abort: () => {} });
    expect(calls).toEqual([{ method: character.build.method, params: request }]);
    expect(
      character.build.params.safeParse({ ...request, source: { ...request.source, guid: "unknown" } }).success,
    ).toBe(false);
    expect(
      character.build.params.safeParse({ ...request, source: { ...request.source, recipeSource: "ignored" } }).success,
    ).toBe(false);
    expect(character.build.params.safeParse({ ...request, commit: true }).success).toBe(false);
    expect(savingMethods.has(character.build.method)).toBe(false);
  });
  test("exports the reviewed authored data without installing an alternate runtime in the map", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "nonoda-tools-"));
    const calls: string[] = [];
    let fail = false;
    try {
      const tools = await createStudioRpcTools({
        cwd,
        callRpc: async (method) => {
          calls.push(method);
          if (fail && method === character.exportAsset.method) throw new Error("Revision conflict");
          return { success: true };
        },
      });
      const exportTool = tools.find((tool) => tool.name === "studiorpc_proceduralcharacter_export")!;
      expect(exportTool).toBeDefined();
      const context = { toolCallId: "export", signal: new AbortController().signal, abort: () => {} };
      const args = {
        buildId: "C01720384F323DA56E74F6B61AF0A57A",
        expectedRevision: {
          sourceRevision: "A".repeat(40),
          geometryHash: "B".repeat(40),
          rigRevision: "C".repeat(40),
          animationRevision: "D".repeat(40),
        },
      };
      await exportTool.execute(args, context);
      expect(calls).toEqual([character.exportAsset.method]);
      fail = true;
      calls.length = 0;
      await expect(exportTool.execute(args, context)).rejects.toThrow("Revision conflict");
      expect(calls).toEqual([character.exportAsset.method]);
      expect(tools.find((tool) => tool.name === "studiorpc_asset_manager_import")).toBeDefined();
      expect(tools.find((tool) => tool.name === "studiorpc_asset_drawer_import")).toBeDefined();
      expect(tools.find((tool) => tool.name === "studiorpc_proceduralcharacter_install")).toBeUndefined();
      expect(tools.find((tool) => tool.name === "studiorpc_proceduralcharacter_cook")).toBeUndefined();
      expect(tools.filter((tool) => tool.name.startsWith("studiorpc_proceduralcharacter_"))).toHaveLength(4);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
  test("registers authoring, export and actual Lua runtime inspection together", () => {
    for (const tool of Object.values(character)) {
      if (typeof tool !== "object" || !("method" in tool)) continue;
      expect(methodModules.find((entry) => entry.method === tool.method)).toBe(tool);
    }
    expect(mutatingMethods.has(character.exportAsset.method)).toBe(false);
    expect(savingMethods.has(character.exportAsset.method)).toBe(false);
    expect(mutatingMethods.has(character.build.method)).toBe(false);
  });
  test("routes all inspection modes through one read-only tool without saving the map", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const tools = await createStudioRpcTools({
      cwd: tmpdir(),
      callRpc: async (method, params) => {
        calls.push({ method, params });
        return { inspected: true };
      },
    });
    const tool = tools.find((entry) => entry.name === "studiorpc_proceduralcharacter_inspect")!;
    const context = { toolCallId: "inspect", signal: new AbortController().signal, abort: () => {} };
    const requests = [
      { mode: "build", buildId: "A".repeat(32) },
      { mode: "source", guid: "B".repeat(32) },
      { mode: "source", guid: "B".repeat(32), region: "C".repeat(32), vertexOffset: 7, vertexCount: 128 },
      { mode: "runtime", modelName: "Creature", world: "authority" },
      {
        mode: "observation",
        buildId: "A".repeat(32),
        scenario: "rest_views",
        expectedRevision: {
          sourceRevision: "A".repeat(40),
          geometryHash: "B".repeat(40),
          rigRevision: "C".repeat(40),
          animationRevision: "D".repeat(40),
        },
      },
    ];
    for (const request of requests) await tool.execute(request, context);
    expect(calls).toEqual(requests.map((params) => ({ method: "proceduralcharacter.inspect", params })));
    expect(mutatingMethods.has(character.inspect.method)).toBe(false);
    expect(savingMethods.has(character.inspect.method)).toBe(false);
    expect(character.inspect.params.safeParse({ mode: "source", guid: "unknown" }).success).toBe(false);
    expect(character.inspect.params.safeParse({ mode: "source", guid: "B".repeat(32), vertexOffset: -1 }).success).toBe(
      false,
    );
    expect(
      character.inspect.params.safeParse({ mode: "source", guid: "B".repeat(32), vertexCount: 2048 }).success,
    ).toBe(false);
  });
  test("accepts authored geometry, arbitrary rig and motion and rejects ODA body profiles", () => {
    const request = {
      requestId: "custom-creature",
      source: {
        kind: "procedural_recipe",
        recipeId: "my-creature",
        recipeSource: "def on_generate(model, size, attributes): pass",
        recipeRevision: "A".repeat(40),
      },
      target: { kind: "new_custom_character", name: "Creature" },
      rigProfile: "authored_v1",
      motion: { preset: "authored_v1", speedCmPerSec: 20 },
      commit: false,
    };
    expect(character.build.params.parse(request)).toEqual(request);
    expect(
      character.build.params.safeParse({ ...request, target: { ...request.target, name: "A".repeat(64) } }).success,
    ).toBe(true);
    expect(
      character.build.params.safeParse({ ...request, target: { ...request.target, name: "A".repeat(65) } }).success,
    ).toBe(false);
    expect(
      character.build.params.parse({ ...request, source: { ...request.source, recipeRevision: "a".repeat(40) } }),
    ).toMatchObject({ source: { recipeRevision: "A".repeat(40) } });
    expect(character.build.params.safeParse({ ...request, bodyProfile: "oda.default.v1" }).success).toBe(false);
    expect(character.build.params.safeParse({ ...request, commit: true }).success).toBe(false);
    expect(
      character.build.params.safeParse({ ...request, motion: { ...request.motion, speedCmPerSec: 0 } }).success,
    ).toBe(false);
  });
  test("requires exact reviewed revisions for observations and commit", () => {
    const expectedRevision = {
      sourceRevision: "A".repeat(40),
      geometryHash: "B".repeat(40),
      rigRevision: "C".repeat(40),
      animationRevision: "D".repeat(40),
    };
    const request = {
      mode: "observation",
      buildId: "C01720384F323DA56E74F6B61AF0A57A",
      scenario: "walk_contact_sheet",
      expectedRevision,
    };
    expect(character.inspect.params.parse(request)).toEqual(request);
    expect(
      character.inspect.params.safeParse({
        ...request,
        expectedRevision: { ...expectedRevision, animationRevision: "stale" },
      }).success,
    ).toBe(false);
    expect(character.inspect.params.parse({ mode: "build", buildId: request.buildId })).toEqual({
      mode: "build",
      buildId: request.buildId,
    });
    expect(character.inspect.params.parse({ mode: "runtime", modelName: "Creature", world: "client" })).toEqual({
      mode: "runtime",
      modelName: "Creature",
      world: "client",
    });
    expect(
      character.inspect.params.safeParse({ mode: "runtime", modelName: "Creature", world: "editor" }).success,
    ).toBe(false);
    expect(character.inspect.params.safeParse({ mode: "runtime", buildId: request.buildId }).success).toBe(false);
  });
});
