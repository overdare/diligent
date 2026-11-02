// @summary Tests the required asset type contract across catalog discovery and pack search.
import { afterEach, expect, test } from "bun:test";
import { executeTool, toToolInputSchema } from "@diligent/core/tool-contract";
import { createRagToolProvider } from "../../../src/tools/rag";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const ctx = { toolCallId: "asset-filter", signal: new AbortController().signal, abort: () => {} };

async function getTool(name: string) {
  const tools = await createRagToolProvider().createTools({ cwd: "/tmp/project" });
  return tools.find((tool) => tool.name === name)!;
}

for (const [name, input] of [
  ["overdaresearch", { source: "assets", query: "footstep", topK: 4 }],
  ["overdaresearch_deep", { action: "asset-pack", query: "footsteps", packKeyword: "pack_metro" }],
] as const) {
  test(`${name} rejects missing and invalid asset types before fetching`, async () => {
    const tool = await getTool(name);
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      return Response.json({ results: [] });
    }) as typeof fetch;
    for (const assetFilter of [
      undefined,
      null,
      {},
      { assetType: "" },
      { assetType: "sounds" },
      { assetType: "all" },
      { assetType: 123 },
      { assetType: ["MODEL"] },
    ]) {
      const result = await executeTool(
        new Map([[name, tool]]),
        {
          type: "tool_call",
          id: "invalid-filter",
          name,
          input: { ...input, assetFilter },
        },
        ctx,
      );
      expect(result.metadata?.error).toBe(true);
      expect(result.output).toContain("assetFilter");
    }
    expect(fetched).toBe(false);
  });

  test(`${name} advertises the required nested type and API enum to models`, async () => {
    const tool = await getTool(name);
    expect(toToolInputSchema(tool)).toMatchObject({
      type: "object",
      properties: {
        assetFilter: {
          anyOf: [
            {
              type: "object",
              required: ["assetType"],
              properties: { assetType: { enum: ["MODEL", "AUDIO", "ANIMATION", "ACTION_SEQUENCE"] } },
            },
            { type: "null" },
          ],
        },
      },
    });
  });
}

test("asset discovery normalizes every supported type and forwards all filters to RAG", async () => {
  const tool = await getTool("overdaresearch");
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url, init) => {
    bodies.push(JSON.parse(init?.body as string));
    return Response.json({ results: [], totalCount: 0 });
  }) as typeof fetch;
  for (const [input, expected] of [
    ["model", "MODEL"],
    [" Audio ", "AUDIO"],
    ["animation", "ANIMATION"],
    ["action_sequence", "ACTION_SEQUENCE"],
  ]) {
    const result = await executeTool(
      new Map([[tool.name, tool]]),
      {
        type: "tool_call",
        id: "valid-filter",
        name: tool.name,
        input: {
          source: "assets",
          query: "footstep",
          topK: 4,
          assetFilter: { assetType: input, keywords: ["walk"], categoryId: "FOOTSTEP" },
        },
      },
      ctx,
    );
    expect(result.metadata?.error).not.toBe(true);
    expect(bodies.at(-1)).toMatchObject({
      source: "assets",
      includePacks: true,
      assetFilter: { assetType: expected, keywords: ["walk"], categoryId: "FOOTSTEP" },
    });
  }
});

test("pack search forwards the selected type instead of defaulting to models", async () => {
  const tool = await getTool("overdaresearch_deep");
  let body: unknown;
  globalThis.fetch = (async (_url, init) => {
    body = JSON.parse(init?.body as string);
    return Response.json({ results: [] });
  }) as typeof fetch;
  const result = await executeTool(
    new Map([[tool.name, tool]]),
    {
      type: "tool_call",
      id: "typed-pack",
      name: tool.name,
      input: {
        action: "asset-pack",
        query: "footsteps",
        packKeyword: "pack_audio",
        assetFilter: { assetType: "audio" },
      },
    },
    ctx,
  );
  expect(result.metadata?.error).not.toBe(true);
  expect(body).toEqual({
    version: "3",
    source: "assets",
    query: "footsteps",
    topK: 8,
    threshold: 0.5,
    assetFilter: { assetType: "AUDIO", keywords: ["pack_audio"] },
  });
});

test("docs and non-pack deep reads accept omitted or null asset filters", async () => {
  const search = await getTool("overdaresearch");
  const deep = await getTool("overdaresearch_deep");
  for (const assetFilter of [undefined, null]) {
    expect(search.parameters.safeParse({ source: "docs", query: "respawn", topK: 4, assetFilter }).success).toBe(true);
    expect(
      deep.parameters.safeParse({
        action: "origin-file",
        urls: ["https://storage.googleapis.com/ovdr-docs-bucket/a.md"],
        assetFilter,
      }).success,
    ).toBe(true);
    expect(
      deep.parameters.safeParse({
        action: "asset-preview",
        urls: ["https://asset-prod.cdn.overdare.com/a.png"],
        assetFilter,
      }).success,
    ).toBe(true);
  }
});

test("choosing a pack retains the discovery type and category on the second request", async () => {
  const tools = await createRagToolProvider().createTools({
    cwd: "/tmp/project",
    host: { ask: async () => ({ answers: { asset: "pack:pack_audio" } }) },
  });
  const tool = tools.find((candidate) => candidate.name === "overdaresearch")!;
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url, init) => {
    bodies.push(JSON.parse(init?.body as string));
    return Response.json({ results: [], totalCount: 0, packs: [{ keyword: "pack_audio", memberCount: 1 }] });
  }) as typeof fetch;
  const result = await executeTool(
    new Map([[tool.name, tool]]),
    {
      type: "tool_call",
      id: "choose-pack",
      name: tool.name,
      input: {
        source: "assets",
        query: "footsteps",
        topK: 4,
        requestUserInput: true,
        assetFilter: { assetType: "audio", categoryId: "FOOTSTEP" },
      },
    },
    ctx,
  );
  expect(result.metadata?.error).not.toBe(true);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual({
    version: "3",
    source: "assets",
    query: "footsteps",
    topK: 4,
    threshold: 0.5,
    assetFilter: { assetType: "AUDIO", categoryId: "FOOTSTEP", keywords: ["pack_audio"] },
  });
});
