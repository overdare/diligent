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

test.each([
  "asset_manager.import",
  "asset_manager.image.import",
])("%s maps shared files while preserving names and call options", async (method) => {
  const calls: unknown[] = [];
  const signal = new AbortController().signal;
  const rpc = createDevStudioRpc(
    { enabled: true, localFileRoot: "/shared", remoteFileRoot: "C:/shared" },
    async (...args) => {
      calls.push(args);
      return { success: true };
    },
  );
  await rpc(method, { file: "/shared/model.glb", assetName: "Tree" }, { signal, sessionId: "S", timeoutMs: 300_000 });
  expect(calls).toEqual([
    [method, { file: "C:\\shared\\model.glb", assetName: "Tree" }, { signal, sessionId: "S", timeoutMs: 300_000 }],
  ]);
});

test("unified import rejects files outside the configured mount before calling Studio", async () => {
  let called = false;
  const rpc = createDevStudioRpc({ enabled: true, localFileRoot: "/shared", remoteFileRoot: "C:/shared" }, async () => {
    called = true;
    return {};
  });
  await expect(rpc("asset_manager.import", { file: "/elsewhere/sound.wav" })).rejects.toThrow("outside");
  expect(called).toBe(false);
});

test("texture paths cross the shared mount in both directions without changing asset ids", async () => {
  const calls: unknown[] = [];
  const rpc = createDevStudioRpc(
    { enabled: true, localFileRoot: "/shared", remoteFileRoot: "C:/shared" },
    async (...args) => {
      calls.push(args);
      return {
        guidePath: "C:/shared/texture/guide.png",
        previewPaths: ["C:/shared/texture/front.png"],
        requiredImages: [{ imageKey: "fox" }],
      };
    },
  );
  const input = {
    requestId: "R",
    images: { fox: { filePath: "/shared/fox.png" }, logo: { assetId: "ovdrassetid://123" } },
  };
  await rpc("texture.apply", input);
  expect(calls[0]).toEqual([
    "texture.apply",
    { ...input, images: { fox: { filePath: "C:\\shared\\fox.png" }, logo: input.images.logo } },
    undefined,
  ]);
  expect(input.images.fox.filePath).toBe("/shared/fox.png");
  expect(await rpc("texture.prepare", {})).toEqual({
    guidePath: "/shared/texture/guide.png",
    previewPaths: ["/shared/texture/front.png"],
    requiredImages: [{ imageKey: "fox" }],
  });
});

test("texture apply rejects every unshared image before Studio sees the request", async () => {
  let called = false;
  const rpc = createDevStudioRpc({ enabled: true, localFileRoot: "/shared", remoteFileRoot: "C:/shared" }, async () => {
    called = true;
    return {};
  });
  await expect(rpc("texture.apply", { images: { x: { filePath: "/elsewhere/x.png" } } })).rejects.toThrow("outside");
  expect(called).toBe(false);
});

test("texture apply maps result previews for painting and repeated requests without images", async () => {
  const rpc = createDevStudioRpc(
    { enabled: true, localFileRoot: "/shared", remoteFileRoot: "C:/shared" },
    async () => ({ status: "applied", imagePath: "C:/shared/results/final.png", textureId: "ovdrassetid://123" }),
  );
  expect(await rpc("texture.apply", { requestId: "R" })).toEqual({
    status: "applied",
    imagePath: "/shared/results/final.png",
    textureId: "ovdrassetid://123",
  });
});
