// @summary Verifies direct OAuth image requests, explicit options, credential isolation, and returned bytes.
import { afterEach, beforeEach, expect, type Mock, spyOn, test } from "bun:test";
import { createChatGPTImageGeneration } from "../../../../src/llm/provider/chatgpt/image-generation";

let fetchMock: Mock<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>;

beforeEach(() => {
  fetchMock = spyOn(globalThis, "fetch");
  fetchMock.mockRejectedValue(new Error("Unexpected HTTP request in image-generation test."));
});

afterEach(() => fetchMock.mockRestore());

function mockFetch(handler: (url: string, init: RequestInit) => Promise<Response>): void {
  fetchMock.mockImplementation((url, init) => handler(String(url), init ?? {}));
}

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==",
  "base64",
);
const tokens = {
  access_token: "test-token",
  refresh_token: "secret-refresh",
  id_token: "secret-id",
  expires_at: Date.now() + 3600000,
  account_id: "test-account",
};

test("posts explicit model and transparency through OAuth without claiming an unreported model", async () => {
  let captured: { url: string; init: RequestInit } | undefined;
  mockFetch(async (url, init) => {
    captured = { url, init };
    return Response.json({
      data: [{ b64_json: png.toString("base64") }],
      background: "transparent",
      output_format: "png",
    });
  });
  const generate = createChatGPTImageGeneration(() => tokens);
  const result = await generate({ prompt: "A coin", model: "test-image-model", background: "transparent" });
  expect(captured?.url).toBe("https://chatgpt.com/backend-api/codex/images/generations");
  expect(new Headers(captured?.init.headers).get("Authorization")).toBe("Bearer test-token");
  expect(new Headers(captured?.init.headers).get("ChatGPT-Account-ID")).toBe("test-account");
  expect(captured?.init.redirect).toBe("error");
  expect(JSON.parse(String(captured?.init.body))).toMatchObject({
    model: "test-image-model",
    background: "transparent",
    output_format: "png",
    prompt: "A coin",
    n: 1,
  });
  expect(result.bytes).toEqual(png);
  expect(result.requestedModel).toBe("test-image-model");
  expect(result.model).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain("test-token");
});

test("posts references as ordered inline image URLs to the edits endpoint", async () => {
  mockFetch(async (url, init) => {
    expect(url.endsWith("/images/edits")).toBe(true);
    expect(JSON.parse(String(init.body)).images).toEqual([
      { image_url: `data:image/png;base64,${png.toString("base64")}` },
    ]);
    return Response.json({ data: [{ b64_json: png.toString("base64") }], model: "reported-model" });
  });
  const generate = createChatGPTImageGeneration(() => tokens);
  const result = await generate({
    prompt: "Change the glyph",
    model: "requested-model",
    referenceImages: [{ bytes: png, mediaType: "image/png" }],
  });
  expect(result.model).toBe("reported-model");
});

test("redacts credentials from a provider error and never retries implicitly", async () => {
  let calls = 0;
  mockFetch(async () => {
    calls++;
    return Response.json(
      { error: { message: `Rejected ${tokens.access_token} ${tokens.refresh_token} ${tokens.id_token}` } },
      { status: 401 },
    );
  });
  const generate = createChatGPTImageGeneration(() => tokens);
  const error = await generate({ prompt: "Coin", model: "test" }).catch((error) => error);
  expect(error.message).toContain("401");
  expect(error.message).not.toContain(tokens.access_token);
  expect(error.message).not.toContain(tokens.refresh_token);
  expect(error.message).not.toContain(tokens.id_token);
  expect(calls).toBe(1);
});

test("validates production-sized base64 without recursive regular-expression overflow", async () => {
  const bytes = Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024)]);
  mockFetch(async () => Response.json({ data: [{ b64_json: bytes.toString("base64") }] }));
  const generate = createChatGPTImageGeneration(() => tokens);
  expect((await generate({ prompt: "Coin", model: "test" })).bytes).toEqual(bytes);
});

test("deadline cancels the in-flight request without an implicit retry", async () => {
  mockFetch(
    async (_url, init) =>
      new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }),
  );
  const generate = createChatGPTImageGeneration(() => tokens, { timeoutMs: 5 });
  await expect(generate({ prompt: "Coin", model: "test" })).rejects.toThrow("timed out");
});

test.each([
  {},
  { data: [] },
  { data: [{ b64_json: "not-base64" }] },
  { data: [{ b64_json: "dGV4dA==" }] },
])("rejects invalid image responses instead of returning an asset", async (payload) => {
  mockFetch(async () => Response.json(payload));
  const generate = createChatGPTImageGeneration(() => tokens);
  await expect(generate({ prompt: "Coin", model: "test" })).rejects.toThrow();
});

test.each([
  { name: "PNG signature without image data", bytes: png.subarray(0, 8) },
  { name: "PNG dimensions without pixel data", bytes: png.subarray(0, 33) },
  { name: "JPEG signature without image data", bytes: Buffer.from([0xff, 0xd8, 0xff]) },
  { name: "WebP container without image data", bytes: Buffer.from("RIFF\u0004\u0000\u0000\u0000WEBP") },
])("rejects $name instead of returning an unusable generated asset", async ({ bytes }) => {
  mockFetch(async () => Response.json({ data: [{ b64_json: bytes.toString("base64") }] }));
  const generate = createChatGPTImageGeneration(() => tokens);
  await expect(generate({ prompt: "Coin", model: "test" })).rejects.toThrow("invalid image data");
});

test("pre-cancellation prevents authentication and network access", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  const generate = createChatGPTImageGeneration(() => {
    throw new Error("must not read auth");
  });
  await expect(generate({ prompt: "Coin", model: "test" }, { signal: controller.signal })).rejects.toThrow("cancelled");
  expect(fetchMock).not.toHaveBeenCalled();
});
