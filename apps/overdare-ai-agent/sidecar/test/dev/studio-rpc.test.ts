// @summary Verifies the dev shared-file mapping for asset imports and Studio screenshot paths.
import { expect, test } from "bun:test";
import { createDevStudioRpc } from "../../src/dev/studio-rpc";

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

test("screenshot paths inside the remote root are returned as their mounted local paths", async () => {
  const rpc = createDevStudioRpc(
    { enabled: true, localFileRoot: "/Volumes/downloads", remoteFileRoot: "C:/Users/jjss/Downloads" },
    async () => ({ path: "C:/Users/jjss/Downloads/Party/Screenshots/Agent/shot.png", image: { width: 2, height: 1 } }),
  );
  expect(await rpc("game.screenshot", {})).toEqual({
    path: "/Volumes/downloads/Party/Screenshots/Agent/shot.png",
    image: { width: 2, height: 1 },
  });
});

test("screenshot paths outside the remote root are left as Studio reported them", async () => {
  const result = { path: "D:/Captures/shot.png" };
  const rpc = createDevStudioRpc(
    { enabled: true, localFileRoot: "/Volumes/downloads", remoteFileRoot: "C:/Users/jjss/Downloads" },
    async () => result,
  );
  expect(await rpc("game.screenshot", {})).toEqual({ path: "D:/Captures/shot.png" });
});
