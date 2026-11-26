// @summary Covers provider auth status listing from the auth store and image upload path/extension selection
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { saveAuthKey, saveOAuthTokens } from "@diligent/runtime";
import { buildProviderList, handleImageUpload } from "@diligent/runtime/app-server/config-handlers";
// @ts-expect-error -- file import yields a path string at runtime
import pngWasm from "@jsquash/png/codec/pkg/squoosh_png_bg.wasm" with { type: "file" };
import encodePng, { init as initPngEncode } from "@jsquash/png/encode";

let tmpDir: string | undefined;

afterEach(async () => {
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  tmpDir = undefined;
});

async function makeTmp(): Promise<string> {
  tmpDir = await mkdtemp(join(tmpdir(), "diligent-config-handlers-"));
  return tmpDir;
}

describe("buildProviderList without a provider manager", () => {
  test("reads configured state and masked keys from the auth store, using OAuth for chatgpt", async () => {
    const root = await makeTmp();
    const authStore = { path: join(root, "auth.jsonc"), mode: "file" as const };
    await saveAuthKey("anthropic", "sk-ant-abcdefghijklmnop", authStore);
    await saveAuthKey("openai", "short", authStore);
    await saveOAuthTokens(
      { access_token: "at", refresh_token: "rt", id_token: "it", expires_at: Date.now() + 60_000 },
      authStore,
    );

    const list = await buildProviderList(undefined, authStore);
    const byName = Object.fromEntries(list.map((entry) => [entry.provider, entry]));
    expect(byName.anthropic).toMatchObject({ configured: true, maskedKey: "sk-ant-...mnop" });
    expect(byName.openai).toMatchObject({ configured: true, maskedKey: "***" });
    expect(byName.chatgpt).toMatchObject({ configured: true, maskedKey: "ChatGPT OAuth", oauthConnected: true });
    expect(byName.gemini.configured).toBe(false);
    expect(byName.gemini.maskedKey).toBeUndefined();
    expect(byName.gemini.oauthConnected).toBeUndefined();
  });

  test("reports chatgpt as unconfigured when no OAuth tokens are stored", async () => {
    const root = await makeTmp();
    const authStore = { path: join(root, "auth.jsonc"), mode: "file" as const };
    await saveAuthKey("anthropic", "sk-ant-abcdefghijklmnop", authStore);

    const list = await buildProviderList(undefined, authStore);
    const chatgpt = list.find((entry) => entry.provider === "chatgpt");
    expect(chatgpt?.configured).toBe(false);
    expect(chatgpt?.maskedKey).toBeUndefined();
    expect(chatgpt?.oauthConnected).toBe(false);
  });
});

describe("handleImageUpload", () => {
  beforeAll(async () => {
    await initPngEncode(await WebAssembly.compile(await Bun.file(pngWasm).arrayBuffer()));
  });

  test("stores draft uploads without a thread under images/drafts and falls back to the media type extension", async () => {
    const root = await makeTmp();
    const result = await handleImageUpload({
      params: { fileName: "no extension", mediaType: "image/jpeg", dataBase64: Buffer.from("jpg").toString("base64") },
      cwd: root,
    });
    expect(basename(dirname(result.path))).toBe("drafts");
    expect(result.path.endsWith("-no-extension.jpg")).toBe(true);
    expect(result.mediaType).toBe("image/jpeg");
    expect(await readFile(result.path, "utf8")).toBe("jpg");
  });

  test("keeps the original file extension when the media type is unchanged", async () => {
    const root = await makeTmp();
    const result = await handleImageUpload({
      params: { fileName: "shot.jpeg", mediaType: "image/jpeg", dataBase64: Buffer.from("jpg").toString("base64") },
      threadId: "thread-7",
      cwd: root,
      toImageUrl: (absPath) => `web:${basename(absPath)}`,
    });
    expect(basename(dirname(result.path))).toBe("thread-7");
    expect(result.path.endsWith("-shot.jpeg")).toBe(true);
    expect(result.webUrl).toBe(`web:${basename(result.path)}`);
  });

  test("uses the converted media type's extension when an oversized PNG becomes WebP", async () => {
    const root = await makeTmp();
    const width = 1200;
    const data = new Uint8ClampedArray(width * width * 4);
    let seed = 0x12345678;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = seed & 0xff;
    }
    const png = await encodePng({ data, width, height: width } as ImageData);
    const result = await handleImageUpload({
      params: { fileName: "noise.png", mediaType: "image/png", dataBase64: Buffer.from(png).toString("base64") },
      threadId: "thread-8",
      cwd: root,
    });
    expect(result.mediaType).toBe("image/webp");
    expect(result.fileName).toBe("noise.png");
    expect(result.path.endsWith("-noise.webp")).toBe(true);
  });
});
