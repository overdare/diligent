// @summary Tests deep catalog reads, origin-file compatibility and cancellation.
import { afterEach, expect, test } from "bun:test";
import { executeTool } from "@diligent/core/tool-contract";
import { createStudioBundledToolProviders } from "../../src/tools";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const ctx = { toolCallId: "deep", signal: new AbortController().signal, abort: () => {} };
async function deepTool() {
  const provider = createStudioBundledToolProviders({ cwd: "/tmp/project" }).find(
    (p) => p.id === "@overdare/rag-tools",
  )!;
  const tools = await provider.createTools({
    cwd: "/tmp/project",
    host: {
      ask: async () => {
        throw new Error("Deep reads must not ask for selection");
      },
    },
  });
  return tools.find((t) => t.name === "overdaresearch_deep")!;
}

test("asset-pack enumerates all members with descriptions and images without ranking or asking", async () => {
  let body: Record<string, unknown> = {};
  const members = Array.from({ length: 25 }, (_, i) => ({
    assetId: String(i + 1),
    title: `Wall ${i}`,
    text: "A tiled wall. Category: ENVIRONMENT Keywords: wall",
    keywords: ["pack_metro"],
    assetType: "MODEL",
    categoryId: "ENVIRONMENT",
    subCategoryId: "WALL",
    imageUrl: `https://asset-prod.cdn.overdare.com/${i}.png`,
  }));
  globalThis.fetch = (async (_url, init) => {
    body = JSON.parse(init?.body as string);
    return Response.json({ results: members, totalCount: members.length });
  }) as typeof fetch;
  const tool = await deepTool();
  const result = await tool.execute(tool.parameters.parse({ action: "asset-pack", packKeyword: "pack_metro" }), ctx);
  expect(body).toEqual({ version: "3", source: "assets", assetFilter: { keywords: ["pack_metro"] } });
  const palette = JSON.parse(result.output);
  expect(palette.pack).toBe("pack_metro");
  expect(palette.memberCount).toBe(25);
  expect(palette.members.map((m: { assetId: string }) => m.assetId)).toEqual(members.map((m) => m.assetId));
  expect(palette.members[0]).toMatchObject({
    description: "A tiled wall.",
    imageUrl: "https://asset-prod.cdn.overdare.com/0.png",
  });
  expect(palette.members[0].text).toBeUndefined(); // Avoid doubling the full palette's prose.
});

test("asset-pack returns an empty palette when the catalog contains no valid members", async () => {
  globalThis.fetch = (async () =>
    Response.json({ results: [{ text: "not an asset" }, { assetId: "" }], totalCount: 2 })) as typeof fetch;
  const tool = await deepTool();
  const result = await tool.execute(tool.parameters.parse({ action: "asset-pack", packKeyword: "pack_empty" }), ctx);
  expect(JSON.parse(result.output)).toEqual({ pack: "pack_empty", memberCount: 0, members: [] });
});

test("asset-pack surfaces HTTP and timeout failures", async () => {
  const tool = await deepTool();
  const args = tool.parameters.parse({ action: "asset-pack", packKeyword: "pack_metro" });
  globalThis.fetch = (async () => new Response("unavailable", { status: 503 })) as typeof fetch;
  await expect(tool.execute(args, ctx)).rejects.toThrow("HTTP 503");
  globalThis.fetch = (async () => {
    throw new DOMException("timeout", "TimeoutError");
  }) as typeof fetch;
  await expect(tool.execute(args, ctx)).rejects.toThrow("timed out");
});

test("asset-pack does not fetch after cancellation and forwards cancellation during a read", async () => {
  const tool = await deepTool();
  const args = tool.parameters.parse({ action: "asset-pack", packKeyword: "pack_metro" });
  let fetched = false;
  globalThis.fetch = (async () => {
    fetched = true;
    return Response.json({ results: [] });
  }) as typeof fetch;
  const cancelled = new AbortController();
  cancelled.abort(new Error("Stopped by caller"));
  await expect(tool.execute(args, { ...ctx, signal: cancelled.signal })).rejects.toThrow("Stopped by caller");
  expect(fetched).toBe(false);
  const active = new AbortController();
  globalThis.fetch = (async (_url, init) => {
    active.abort(new Error("Cancelled during fetch"));
    (init?.signal as AbortSignal).throwIfAborted();
    return Response.json({ results: [] });
  }) as typeof fetch;
  await expect(tool.execute(args, { ...ctx, signal: active.signal })).rejects.toThrow("Cancelled during fetch");
});

test("deep reads validate their action-specific inputs", async () => {
  const tool = await deepTool();
  for (const args of [
    { action: "asset-pack" },
    { action: "asset-pack", packKeyword: " " },
    { action: "asset-pack", packKeyword: "pack_metro", urls: ["https://example.com"] },
    { action: "origin-file", urls: [] },
    { action: "origin-file", urls: ["x"], packKeyword: "pack_metro" },
  ])
    expect(tool.parameters.safeParse(args).success).toBe(false);
});

test("origin-file retains its existing request and render contract", async () => {
  const url = "https://storage.googleapis.com/ovdr-docs-bucket/example.md";
  let fetchedUrl = "";
  globalThis.fetch = (async (input) => {
    fetchedUrl = String(input);
    return Response.json({ files: [{ originFileUrl: url, content: "API reference" }], totalCount: 1 });
  }) as typeof fetch;
  const tool = await deepTool();
  const result = await tool.execute(tool.parameters.parse({ action: "origin-file", urls: [url] }), ctx);
  expect(new URL(fetchedUrl).searchParams.get("originFileUrl")).toBe(url);
  expect(JSON.parse(result.output)).toEqual([{ originFileUrl: url, content: "API reference" }]);
  expect(result.render?.blocks).toContainEqual({ type: "file", filePath: url, content: "API reference" });
  await expect(
    tool.execute(tool.parameters.parse({ action: "origin-file", urls: ["https://example.com/file"] }), ctx),
  ).rejects.toThrow("allowed bucket");
});

test("large palettes remain complete JSON through the real tool executor", async () => {
  globalThis.fetch = (async () =>
    Response.json({
      results: Array.from({ length: 160 }, (_, i) => ({
        assetId: String(i),
        title: `Member ${i}`,
        text: "A detailed platform wall. ".repeat(15),
        keywords: ["pack_metro"],
        assetType: "MODEL",
        categoryId: "ENVIRONMENT",
        subCategoryId: "WALL",
        thumbnailUrl: "https://asset-prod.cdn.overdare.com/images/world-asset/raw/live/123/thumbnail/image.png",
      })),
    })) as typeof fetch;
  const tool = await deepTool();
  const result = await executeTool(
    new Map([[tool.name, tool]]),
    {
      type: "tool_call",
      id: "large-pack",
      name: tool.name,
      input: { action: "asset-pack", packKeyword: "pack_metro" },
    },
    ctx,
  );
  expect(result.metadata?.truncated).not.toBe(true);
  const palette = JSON.parse(result.output);
  expect(palette.members.length).toBe(160);
  expect(palette.members[159].assetId).toBe("159");
});

test("deep action schema accepts null for unused fields advertised to strict providers", async () => {
  const tool = await deepTool();
  expect(tool.parameters.safeParse({ action: "asset-pack", packKeyword: "pack_metro", urls: null }).success).toBe(true);
  expect(
    tool.parameters.safeParse({
      action: "asset-preview",
      urls: ["https://asset-prod.cdn.overdare.com/a.png"],
      packKeyword: null,
    }).success,
  ).toBe(true);
  expect(
    tool.parameters.safeParse({
      action: "origin-file",
      urls: ["https://storage.googleapis.com/ovdr-docs-bucket/a.md"],
      packKeyword: null,
    }).success,
  ).toBe(true);
});
