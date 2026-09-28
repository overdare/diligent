// @summary Tests shared-path translation for unified and legacy asset imports.
import { describe, expect, test } from "bun:test";
import { createDevStudioRpc } from "../../src/dev/studio-rpc";
import { StudioRpcError } from "../../src/tools/studiorpc/rpc";

const options = { enabled: true, localFileRoot: "/shared", remoteFileRoot: "C:/shared" };

describe("dev Studio asset imports", () => {
  test("maps unified model imports and legacy image imports while preserving request options", async () => {
    const seen: unknown[] = [];
    const rpc = createDevStudioRpc(options, async (method, params, rpcOptions) => {
      seen.push({ method, params, options: rpcOptions });
      return { success: true };
    });
    const signal = new AbortController().signal;
    for (const [method, extension] of [
      ["asset_manager.import", "fbx"],
      ["asset_manager.image.import", "png"],
    ]) {
      await rpc(
        method,
        { file: `/shared/prop.${extension}`, assetName: "Prop" },
        { signal, sessionId: "agent", timeoutMs: 150_000 },
      );
      expect(seen.at(-1)).toEqual({
        method,
        params: { file: `C:\\shared\\prop.${extension}`, assetName: "Prop" },
        options: { signal, sessionId: "agent", timeoutMs: 150_000 },
      });
    }
  });

  test("rejects unified imports outside the shared roots before calling Studio", async () => {
    let called = false;
    const rpc = createDevStudioRpc(options, async () => {
      called = true;
      return {};
    });
    await expect(rpc("asset_manager.import", { file: "/private/prop.glb" })).rejects.toThrow("outside");
    expect(called).toBe(false);
  });

  test("adds the Studio path to invalid-file errors without retrying", async () => {
    let calls = 0;
    const rpc = createDevStudioRpc(options, async () => {
      calls++;
      throw new StudioRpcError("Invalid file", -32008);
    });
    await expect(rpc("asset_manager.import", { file: "/shared/prop.obj" })).rejects.toThrow("C:\\shared\\prop.obj");
    expect(calls).toBe(1);
  });

  test("leaves imports untouched when dev mapping is disabled", async () => {
    const callRpc = async () => ({});
    expect(createDevStudioRpc({ ...options, enabled: false }, callRpc)).toBe(callRpc);
  });
});
