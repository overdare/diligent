// @summary Tests unified asset import requests, results, and legacy image compatibility.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@diligent/core/tool-contract";
import { createStudioRpcToolProvider } from "../../../../src/tools/studiorpc";
import { params } from "../../../../src/tools/studiorpc/methods/asset-manager.import";
import type { call } from "../../../../src/tools/studiorpc/rpc";
import { StudioRpcError } from "../../../../src/tools/studiorpc/rpc";

const context = {
  toolCallId: "import",
  sessionId: "agent-session",
  signal: new AbortController().signal,
  abort() {},
};

async function withTools<T>(callRpc: typeof call, run: (tools: Tool[]) => Promise<T>) {
  const cwd = mkdtempSync(join(tmpdir(), "studio-asset-import-"));
  try {
    return await run(await createStudioRpcToolProvider({ callRpc }).createTools({ cwd }));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe("asset_manager.import", () => {
  test("accepts supported model, image, and audio files with absolute Studio paths", () => {
    for (const extension of [
      "fbx",
      "obj",
      "glb",
      "gltf",
      "png",
      "jpg",
      "jpeg",
      "tga",
      "bmp",
      "exr",
      "wav",
      "mp3",
      "ogg",
    ]) {
      expect(params.parse({ file: `C:/assets/prop.${extension}` }).file).toBe(`C:/assets/prop.${extension}`);
    }
    expect(params.parse({ file: "/shared/Prop.FBX", assetName: "Prop" })).toEqual({
      file: "/shared/Prop.FBX",
      assetName: "Prop",
    });
    expect(params.parse({ file: "\\\\studio\\assets\\prop.glb" }).file).toBe("\\\\studio\\assets\\prop.glb");
    for (const file of ["", "prop.fbx", "C:prop.fbx", "/assets/prop.zip"]) {
      expect(params.safeParse({ file }).success).toBe(false);
    }
  });

  test("sends the canonical request, preserves session attribution, and returns the asset ID", async () => {
    const seen: Array<{ method: string; params: unknown; sessionId?: string; timeoutMs?: number }> = [];
    await withTools(
      async (method, args, options) => {
        seen.push({ method, params: args, sessionId: options?.sessionId, timeoutMs: options?.timeoutMs });
        return method === "asset_manager.import"
          ? { success: true, asset: { file: args?.file, assetid: "ovdrassetid://3528427" } }
          : { success: true };
      },
      async (tools) => {
        const tool = tools.find((tool) => tool.name === "studiorpc_asset_manager_import")!;
        const args = { file: "C:/assets/prop.fbx", assetName: "Prop" };
        const result = await tool.execute(tool.parameters.parse(args), context);
        expect(seen).toEqual([
          { method: "asset_manager.import", params: args, sessionId: "agent-session", timeoutMs: expect.any(Number) },
          { method: "level.save.file", params: {}, sessionId: "agent-session", timeoutMs: undefined },
        ]);
        expect(seen[0]?.timeoutMs).toBeGreaterThanOrEqual(120_000);
        expect(JSON.parse(result.output)).toMatchObject({ success: true, asset: { assetid: "ovdrassetid://3528427" } });
        expect(result.render?.blocks).toContainEqual(
          expect.objectContaining({
            type: "key_value",
            items: expect.arrayContaining([
              { key: "assetName", value: "Prop" },
              { key: "assetid", value: "ovdrassetid://3528427" },
            ]),
          }),
        );
      },
    );
  });

  test("leaves the default asset name to Studio without advertising another import tool", async () => {
    const seen: Array<{ method: string; params: unknown }> = [];
    await withTools(
      async (method, args) => {
        seen.push({ method, params: args });
        return { success: true };
      },
      async (tools) => {
        const tool = tools.find((tool) => tool.name === "studiorpc_asset_manager_import")!;
        await tool.execute(tool.parameters.parse({ file: "C:/assets/prop.glb" }), context);
        expect(tools.some((tool) => tool.name === "studiorpc_asset_manager_image_import")).toBe(false);
        expect(seen.filter((call) => call.method !== "level.save.file")).toEqual([
          { method: "asset_manager.import", params: { file: "C:/assets/prop.glb" } },
        ]);
      },
    );
  });

  test("does not save after Studio rejects an import", async () => {
    const seen: string[] = [];
    const failure = new StudioRpcError("Invalid file", -32008);
    await withTools(
      async (method) => {
        seen.push(method);
        throw failure;
      },
      async (tools) => {
        const tool = tools.find((tool) => tool.name === "studiorpc_asset_manager_import")!;
        await expect(tool.execute({ file: "C:/assets/prop.obj" }, context)).rejects.toBe(failure);
        expect(seen).toEqual(["asset_manager.import"]);
      },
    );
  });
});
