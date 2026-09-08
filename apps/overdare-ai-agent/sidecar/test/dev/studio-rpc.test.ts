// @summary Verifies opt-in dev-only image path mapping at the Studio RPC boundary.

import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { createDevStudioRpc } from "../../src/dev/studio-rpc";
import { buildRegistries } from "../../src/mcp-server";
import { createStudioBundledToolProviders } from "../../src/tools";
import { type call, StudioRpcError } from "../../src/tools/studiorpc/rpc";

const localFileRoot = "/Volumes/project";
const remoteFileRoot = String.raw`\\studio\project`;
const image = "/Volumes/project/images/icon.png";
const studioImage = String.raw`\\studio\project\images\icon.png`;

function fixture() {
  const calls: Array<{ method: string; params?: Record<string, unknown>; options?: Parameters<typeof call>[2] }> = [];
  const rpc: typeof call = async (method, params, options) => {
    calls.push({ method, params, options });
    return { success: true, asset: { file: params?.file, assetid: "ovdrassetid://123" } };
  };
  return { calls, rpc };
}

test("production ignores dev file roots and keeps the original RPC client", () => {
  const { rpc } = fixture();
  expect(createDevStudioRpc({ enabled: false, localFileRoot: "invalid" }, rpc)).toBe(rpc);
});

test("dev without a mapping keeps same-machine behavior", () => {
  const { rpc } = fixture();
  expect(createDevStudioRpc({ enabled: true }, rpc)).toBe(rpc);
});

test("maps only image-import file paths and preserves the caller's RPC options", async () => {
  const { rpc, calls } = fixture();
  const client = createDevStudioRpc({ enabled: true, localFileRoot, remoteFileRoot }, rpc);
  const options = { signal: new AbortController().signal, timeoutMs: 500 };
  await client("asset_manager.image.import", { file: image }, options);
  await client("other.method", { file: image }, options);
  expect(calls[0]).toEqual({ method: "asset_manager.image.import", params: { file: studioImage }, options });
  expect(calls[1]).toEqual({ method: "other.method", params: { file: image }, options });
});

test.each([
  {
    local: "/Volumes/project/",
    remote: "D:\\World",
    file: "/Volumes/project/icons/My icon.png",
    mapped: "D:\\World\\icons\\My icon.png",
  },
  {
    local: "C:\\Agent\\Project",
    remote: "D:\\Studio\\Project",
    file: "C:\\Agent\\Project\\icons\\a.png",
    mapped: "D:\\Studio\\Project\\icons\\a.png",
  },
])("maps a configured shared root across path styles: $local", async ({ local, remote, file, mapped }) => {
  const { rpc, calls } = fixture();
  const client = createDevStudioRpc({ enabled: true, localFileRoot: local, remoteFileRoot: remote }, rpc);
  await client("asset_manager.image.import", { file });
  expect(calls[0]?.params).toEqual({ file: mapped });
});

test("does not remap an already Studio-side path", async () => {
  const { rpc, calls } = fixture();
  const client = createDevStudioRpc({ enabled: true, localFileRoot, remoteFileRoot }, rpc);
  await client("asset_manager.image.import", { file: studioImage });
  expect(calls[0]?.params).toEqual({ file: studioImage });
});

test.each([
  "/Volumes/project-other/icon.png",
  "/Volumes/project/../secret.png",
  "relative.png",
])("rejects an unmapped local file before calling Studio: %s", async (file) => {
  const { rpc, calls } = fixture();
  const client = createDevStudioRpc({ enabled: true, localFileRoot, remoteFileRoot }, rpc);
  await expect(client("asset_manager.image.import", { file })).rejects.toThrow("shared file roots");
  expect(calls).toEqual([]);
});

test.each([
  { localFileRoot },
  { remoteFileRoot },
  { localFileRoot: "relative", remoteFileRoot },
])("rejects incomplete or relative dev mapping configuration", (roots) => {
  expect(() => createDevStudioRpc({ enabled: true, ...roots }, fixture().rpc)).toThrow("STUDIO_LOCAL_FILE_ROOT");
});

test("an invalid-file response points to Studio-side access without guessing a format error or retrying", async () => {
  let attempts = 0;
  const original = new StudioRpcError("Invalid file", -32008, { detail: "fixture" });
  const client = createDevStudioRpc({ enabled: true, localFileRoot, remoteFileRoot }, async () => {
    attempts += 1;
    throw original;
  });
  const error = await client("asset_manager.image.import", { file: image }).catch((error) => error);
  expect(error).toBeInstanceOf(StudioRpcError);
  expect(error.code).toBe(-32008);
  expect(error.data).toEqual(original.data);
  expect(error.message).toContain(studioImage);
  expect(error.message).toContain("does not prove an image-format problem");
  expect(error.message).toContain("Do not substitute");
  expect(attempts).toBe(1);
});

test("a cancelled image import never reaches Studio", async () => {
  const { rpc, calls } = fixture();
  const client = createDevStudioRpc({ enabled: true, localFileRoot, remoteFileRoot }, rpc);
  const reason = new Error("cancelled");
  expect(
    await client("asset_manager.image.import", { file: image }, { signal: AbortSignal.abort(reason) }).catch(
      (error) => error,
    ),
  ).toBe(reason);
  expect(calls).toEqual([]);
});

test("a failed import is surfaced without saving the level or attempting an alternative", async () => {
  const methods: string[] = [];
  const client = createDevStudioRpc({ enabled: true, localFileRoot, remoteFileRoot }, async (method) => {
    methods.push(method);
    throw new StudioRpcError("Invalid file", -32008, undefined);
  });
  const provider = createStudioBundledToolProviders({ cwd: "/tmp/project", studioRpc: { callRpc: client } }).find(
    (provider) => provider.id === "@overdare/studiorpc-tools",
  )!;
  const tool = (await provider.createTools({ cwd: "/tmp/project" })).find(
    (tool) => tool.name === "studiorpc_asset_manager_image_import",
  )!;
  await expect(
    tool.execute({ file: image }, { toolCallId: "test", signal: new AbortController().signal, abort() {} }),
  ).rejects.toThrow("Keep the import step blocked");
  expect(methods).toEqual(["asset_manager.image.import"]);
});

test.each([
  "web",
  "router",
])("the %s tool assembly imports the mapped file and saves only after success", async (surface) => {
  const { rpc, calls } = fixture();
  const studioRpc = { callRpc: createDevStudioRpc({ enabled: true, localFileRoot, remoteFileRoot }, rpc) };
  const tools =
    surface === "web"
      ? await createStudioBundledToolProviders({ cwd: "/tmp/project", studioRpc })
          .find((provider) => provider.id === "@overdare/studiorpc-tools")!
          .createTools({ cwd: "/tmp/project" })
      : [
          ...(
            await buildRegistries({
              cwd: "/tmp/project",
              bootstrapDir: resolve(import.meta.dir, "../../../bootstrap"),
              studioRpc,
            })
          ).tools.values(),
        ];
  const tool = tools.find((tool) => tool.name === "studiorpc_asset_manager_image_import")!;
  const result = await tool.execute(
    { file: image },
    { toolCallId: "test", signal: new AbortController().signal, abort() {} },
  );
  expect(JSON.parse(result.output).asset.assetid).toBe("ovdrassetid://123");
  expect(calls.map(({ method, params }) => ({ method, params }))).toEqual([
    { method: "asset_manager.image.import", params: { file: studioImage } },
    { method: "level.save.file", params: {} },
  ]);
});
