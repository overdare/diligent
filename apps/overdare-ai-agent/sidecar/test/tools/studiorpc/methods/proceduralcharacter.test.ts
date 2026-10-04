// @summary Verifies generic custom character tools are discoverable and cannot accept ODA costume requests.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioRpcTools } from "../../../../src/tools/studiorpc";
import * as character from "../../../../src/tools/studiorpc/methods/proceduralcharacter";
import { methodModules, mutatingMethods, savingMethods } from "../../../../src/tools/studiorpc/tool-registry";

describe("non-ODA character authoring", () => {
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
      character.build.params.parse({ ...request, source: { ...request.source, recipeRevision: "a".repeat(40) } }).source
        .recipeRevision,
    ).toBe("A".repeat(40));
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
