// @summary Tests bounded remote thumbnail reads and model-visible image mapping.
import { afterEach, expect, test } from "bun:test";
import { execute, parameters } from "../../src/tools/rag/overdaresearch-deep";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const ctx = { toolCallId: "preview", signal: new AbortController().signal, abort: () => {} };
const base = "https://asset-prod.cdn.overdare.com";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPgEpFrAAABJQC97kY5HgAAAABJRU5ErkJggg==",
  "base64",
);
const preview = (urls: string[], signal = ctx.signal) =>
  execute(parameters.parse({ action: "asset-preview", urls }), { ...ctx, signal });

test("preview returns actual image bytes in input order with URL-to-image indices", async () => {
  let fetched = 0;
  globalThis.fetch = (async (_url, init) => {
    expect(init?.redirect).toBe("error");
    fetched++;
    return new Response(png, { headers: { "Content-Type": "image/png" } });
  }) as typeof fetch;
  const result = await preview([`${base}/a.png`, `${base}/b.png`]);
  expect(fetched).toBe(2);
  expect(JSON.parse(result.output).previews).toEqual([
    { url: `${base}/a.png`, imageIndex: 0 },
    { url: `${base}/b.png`, imageIndex: 1 },
  ]);
  expect(result.outputImages?.length).toBe(2);
  for (const image of result.outputImages ?? []) {
    expect(image.source.media_type).toBe("image/png");
    expect(Buffer.from(image.source.data, "base64")).toEqual(png);
  }
});

test("invalid URLs are rejected before fetching", async () => {
  let fetched = false;
  globalThis.fetch = (async () => {
    fetched = true;
    return new Response(png);
  }) as typeof fetch;
  for (const url of [
    "http://asset-prod.cdn.overdare.com/a.png",
    "https://example.com/a.png",
    "file:///tmp/a.png",
    "https://asset-prod.cdn.overdare.com.evil.com/a.png",
    "https://user:pass@asset-prod.cdn.overdare.com/a.png",
    "https://asset-prod.cdn.overdare.com:13377/a.png",
    "invalid",
  ]) {
    const result = await preview([url]);
    expect(JSON.parse(result.output).previews[0].error).toContain("allowed");
    expect(result.outputImages?.length ?? 0).toBe(0);
  }
  expect(fetched).toBe(false);
});

test("partial failures preserve successful images and their mapping", async () => {
  globalThis.fetch = (async (url) =>
    String(url).includes("failed") ? new Response("not found", { status: 404 }) : new Response(png)) as typeof fetch;
  const result = await preview([`${base}/failed.png`, `${base}/ok.png`]);
  const rows = JSON.parse(result.output).previews;
  expect(rows[0]).toMatchObject({ url: `${base}/failed.png`, error: expect.stringContaining("404") });
  expect(rows[0].imageIndex).toBeUndefined();
  expect(rows[1]).toEqual({ url: `${base}/ok.png`, imageIndex: 0 });
  expect(result.outputImages?.length).toBe(1);
});

test("redirects, non-image bytes and empty bodies do not become images", async () => {
  for (const response of [
    new Response(null, { status: 302, headers: { Location: "https://example.com" } }),
    new Response("<html>not an image</html>", { headers: { "Content-Type": "image/png" } }),
    new Response(new Uint8Array()),
  ]) {
    globalThis.fetch = (async () => response) as typeof fetch;
    const result = await preview([`${base}/a.png`]);
    expect(JSON.parse(result.output).previews[0].error).toBeDefined();
    expect(result.outputImages?.length ?? 0).toBe(0);
  }
});

test("chunked responses stop at the source byte limit without Content-Length", async () => {
  let cancelled = false;
  globalThis.fetch = (async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(3 * 1024 * 1024));
          controller.enqueue(new Uint8Array(3 * 1024 * 1024));
        },
        cancel() {
          cancelled = true;
        },
      }),
    )) as typeof fetch;
  const result = await preview([`${base}/large.png`]);
  expect(JSON.parse(result.output).previews[0].error).toContain("limit");
  expect(cancelled).toBe(true);
  expect(result.outputImages?.length ?? 0).toBe(0);
});

test("aggregate download budget limits a group of individually valid images", async () => {
  const padded = Buffer.alloc(3 * 1024 * 1024);
  png.copy(padded);
  globalThis.fetch = (async () => new Response(padded)) as typeof fetch;
  const result = await preview(["a", "b", "c", "d"].map((name) => `${base}/${name}.png`));
  const rows = JSON.parse(result.output).previews;
  expect(rows.some((row: { error?: string }) => row.error?.includes("total"))).toBe(true);
  expect((result.outputImages ?? []).length).toBeLessThan(4);
});

test("at most two preview fetches run concurrently", async () => {
  let active = 0;
  let peak = 0;
  globalThis.fetch = (async () => {
    active++;
    peak = Math.max(peak, active);
    await Bun.sleep(10);
    active--;
    return new Response(png);
  }) as typeof fetch;
  const result = await preview(["a", "b", "c", "d"].map((name) => `${base}/${name}.png`));
  expect(result.outputImages?.length).toBe(4);
  expect(peak).toBe(2);
});

test("preview timeout produces an actionable per-image failure", async () => {
  globalThis.fetch = (async (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal as AbortSignal;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })) as typeof fetch;
  const result = await preview([`${base}/slow.png`]);
  expect(JSON.parse(result.output).previews[0].error).toContain("timed out");
}, 10000);

test("caller cancellation stops previews instead of returning an unused image", async () => {
  let fetched = false;
  globalThis.fetch = (async () => {
    fetched = true;
    return new Response(png);
  }) as typeof fetch;
  const cancelled = new AbortController();
  cancelled.abort(new Error("Preview cancelled"));
  await expect(preview([`${base}/a.png`], cancelled.signal)).rejects.toThrow("Preview cancelled");
  expect(fetched).toBe(false);
  const active = new AbortController();
  globalThis.fetch = (async (_url, init) => {
    active.abort(new Error("Cancelled during preview"));
    (init?.signal as AbortSignal).throwIfAborted();
    return new Response(png);
  }) as typeof fetch;
  await expect(preview([`${base}/a.png`], active.signal)).rejects.toThrow("Cancelled during preview");
});

test("preview schema requires one to four URLs and forbids packKeyword", () => {
  for (const args of [
    { action: "asset-preview" },
    { action: "asset-preview", urls: [] },
    { action: "asset-preview", urls: Array(5).fill(`${base}/a.png`) },
    { action: "asset-preview", urls: [`${base}/a.png`], packKeyword: "pack_metro" },
  ]) {
    expect(parameters.safeParse(args).success).toBe(false);
  }
});

test("corrupt thumbnails with valid magic do not poison successful image results", async () => {
  for (const corrupt of [
    Buffer.from("GIF89a"),
    png.subarray(0, 24),
    Buffer.from([0xff, 0xd8, 0xff, 0x00]),
    Buffer.from("RIFFxxxxWEBP"),
  ]) {
    globalThis.fetch = (async (url) => new Response(String(url).includes("corrupt") ? corrupt : png)) as typeof fetch;
    const result = await preview([`${base}/corrupt.png`, `${base}/valid.png`]);
    const rows = JSON.parse(result.output).previews;
    expect(rows[0].error).toBeDefined();
    expect(rows[0].imageIndex).toBeUndefined();
    expect(rows[1]).toEqual({ url: `${base}/valid.png`, imageIndex: 0 });
    expect(result.outputImages?.length).toBe(1);
  }
});
