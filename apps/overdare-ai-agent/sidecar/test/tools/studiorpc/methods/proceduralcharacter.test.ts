// @summary Verifies generic custom character tools are discoverable and cannot accept ODA costume requests.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioRpcTools } from "../../../../src/tools/studiorpc";
import * as character from "../../../../src/tools/studiorpc/methods/proceduralcharacter";
import { methodModules, mutatingMethods, savingMethods } from "../../../../src/tools/studiorpc/tool-registry";

describe("non-ODA character authoring", () => {
  test("routes the installed public tool to the non-ODA RPC and saves only after success", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "nonoda-tools-"));
    const calls: string[] = [];
    let fail = false;
    try {
      const tools = await createStudioRpcTools({
        cwd,
        callRpc: async (method) => {
          calls.push(method);
          if (fail && method === character.install.method) throw new Error("Asset ID collision");
          return { success: true };
        },
      });
      const install = tools.find((tool) => tool.name === "studiorpc_proceduralcharacter_install")!;
      expect(install).toBeDefined();
      const context = { toolCallId: "install", signal: new AbortController().signal, abort: () => {} };
      await install.execute({ buildId: "C01720384F323DA56E74F6B61AF0A57A" }, context);
      expect(calls).toEqual([character.install.method, "level.save.file"]);
      fail = true;
      calls.length = 0;
      await expect(install.execute({ buildId: "C01720384F323DA56E74F6B61AF0A57A" }, context)).rejects.toThrow(
        "Asset ID collision",
      );
      expect(calls).toEqual([character.install.method]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
  test("registers authoring, installation and actual Lua runtime inspection together", () => {
    for (const tool of Object.values(character)) {
      if (typeof tool !== "object" || !("method" in tool)) continue;
      expect(methodModules.find((entry) => entry.method === tool.method)).toBe(tool);
    }
    expect(mutatingMethods.has(character.install.method)).toBe(true);
    expect(savingMethods.has(character.install.method)).toBe(true);
    expect(mutatingMethods.has(character.build.method)).toBe(false);
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
    const request = { buildId: "C01720384F323DA56E74F6B61AF0A57A", scenario: "walk_contact_sheet", expectedRevision };
    expect(character.observe.params.parse(request)).toEqual(request);
    expect(
      character.observe.params.safeParse({
        ...request,
        expectedRevision: { ...expectedRevision, animationRevision: "stale" },
      }).success,
    ).toBe(false);
    expect(character.runtime.params.safeParse({ modelName: "Creature", world: "editor" }).success).toBe(false);
  });
});
