// @summary Tests query-scoped pack searches and prevents accidental whole-pack enumeration.
import { afterEach, expect, test } from "bun:test";
import { executeTool, toToolInputSchema } from "@diligent/core/tool-contract";
import { createRagToolProvider } from "../../../src/tools/rag";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const ctx = { toolCallId: "pack-search", signal: new AbortController().signal, abort: () => {} };

async function deepTool() {
  const tools = await createRagToolProvider().createTools({ cwd: "/tmp/project" });
  return tools.find((tool) => tool.name === "overdaresearch_deep")!;
}

test("pack searches reject missing, blank, and invalid queries before fetching", async () => {
  const tool = await deepTool();
  let fetched = false;
  globalThis.fetch = (async () => {
    fetched = true;
    return Response.json({ results: [] });
  }) as typeof fetch;
  for (const query of [undefined, null, "", "   ", 123, ["chair"]]) {
    const result = await executeTool(
      new Map([[tool.name, tool]]),
      {
        type: "tool_call",
        id: "invalid-query",
        name: tool.name,
        input: { action: "asset-pack", packKeyword: "pack_metro", assetFilter: { assetType: "MODEL" }, query },
      },
      ctx,
    );
    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("query");
  }
  expect(fetched).toBe(false);
});

test("pack searches send trimmed query, topK, threshold, and exact pack filters to the API", async () => {
  const tool = await deepTool();
  let body: unknown;
  globalThis.fetch = (async (_url, init) => {
    body = JSON.parse(init?.body as string);
    return Response.json({
      results: [
        {
          assetId: "chair-2",
          title: "Wooden Chair",
          text: "A wooden chair.",
          assetType: "MODEL",
          keywords: ["pack_metro"],
        },
        { assetId: "chair-1", title: "Bench", text: "A platform bench.", assetType: "MODEL", keywords: ["pack_metro"] },
      ],
      totalCount: 2,
    });
  }) as typeof fetch;
  const result = await executeTool(
    new Map([[tool.name, tool]]),
    {
      type: "tool_call",
      id: "ranked-pack",
      name: tool.name,
      input: {
        action: "asset-pack",
        packKeyword: "pack_metro",
        query: "  wooden chair  ",
        topK: 3,
        assetFilter: { assetType: "model", categoryId: "FURNITURE", keywords: ["old-search-keyword"] },
      },
    },
    ctx,
  );
  expect(result.metadata?.error).not.toBe(true);
  expect(body).toEqual({
    version: "3",
    source: "assets",
    query: "wooden chair",
    topK: 3,
    threshold: 0.5,
    assetFilter: { assetType: "MODEL", categoryId: "FURNITURE", keywords: ["pack_metro"] },
  });
  const output = JSON.parse(result.output);
  expect(output).toMatchObject({ pack: "pack_metro", query: "wooden chair", memberCount: 2 });
  expect(output.members.map((member: { assetId: string }) => member.assetId)).toEqual(["chair-2", "chair-1"]);
});

test("pack searches default omitted or null topK to eight results", async () => {
  const tool = await deepTool();
  const bodies: Array<{ topK: number }> = [];
  globalThis.fetch = (async (_url, init) => {
    bodies.push(JSON.parse(init?.body as string));
    return Response.json({ results: [] });
  }) as typeof fetch;
  for (const topK of [undefined, null]) {
    const result = await executeTool(
      new Map([[tool.name, tool]]),
      {
        type: "tool_call",
        id: "default-limit",
        name: tool.name,
        input: {
          action: "asset-pack",
          packKeyword: "pack_metro",
          query: "chair",
          topK,
          assetFilter: { assetType: "MODEL" },
        },
      },
      ctx,
    );
    expect(result.metadata?.error).not.toBe(true);
  }
  expect(bodies.map((body) => body.topK)).toEqual([8, 8]);
});

test("pack searches reject invalid result limits before fetching", async () => {
  const tool = await deepTool();
  let fetched = false;
  globalThis.fetch = (async () => {
    fetched = true;
    return Response.json({ results: [] });
  }) as typeof fetch;
  for (const topK of [0, 11, 1.5, "8"]) {
    const result = await executeTool(
      new Map([[tool.name, tool]]),
      {
        type: "tool_call",
        id: "invalid-limit",
        name: tool.name,
        input: {
          action: "asset-pack",
          packKeyword: "pack_metro",
          query: "chair",
          topK,
          assetFilter: { assetType: "MODEL" },
        },
      },
      ctx,
    );
    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("topK");
  }
  expect(fetched).toBe(false);
});

test("the advertised pack schema includes the query and bounded result limit", async () => {
  const tool = await deepTool();
  expect(toToolInputSchema(tool)).toMatchObject({
    type: "object",
    properties: {
      query: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
      topK: { anyOf: [{ type: "integer", minimum: 1, maximum: 10 }, { type: "null" }] },
    },
  });
});

test("asset discovery rejects blank queries before it can select a whole pack", async () => {
  const tools = await createRagToolProvider().createTools({ cwd: "/tmp/project" });
  const tool = tools.find((candidate) => candidate.name === "overdaresearch")!;
  let fetched = false;
  globalThis.fetch = (async () => {
    fetched = true;
    return Response.json({ results: [] });
  }) as typeof fetch;
  for (const query of ["", "  "]) {
    const result = await executeTool(
      new Map([[tool.name, tool]]),
      {
        type: "tool_call",
        id: "blank-discovery",
        name: tool.name,
        input: { source: "assets", query, topK: 8, requestUserInput: true, assetFilter: { assetType: "MODEL" } },
      },
      ctx,
    );
    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("query");
  }
  expect(fetched).toBe(false);
});
