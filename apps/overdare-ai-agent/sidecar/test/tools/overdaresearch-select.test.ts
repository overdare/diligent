// @summary Tests autonomous asset discovery and explicit user selection outcomes.

import { afterEach, describe, expect, test } from "bun:test";
import type { UserInputRequest, UserInputResponse } from "@diligent/protocol";
import { createStudioBundledToolProviders } from "../../src/tools";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockRagFetch(results: unknown[]): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ results, totalCount: results.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
}

const ctx = { toolCallId: "t", signal: new AbortController().signal, abort: () => {} };

function asset(id: string, title: string) {
  return {
    text: `${title} model`,
    score: 0.9,
    title,
    keywords: [title],
    assetId: id,
    assetType: "MODEL",
    categoryId: "WEAPON",
    subCategoryId: "WEAPON_MELEE",
    thumbnailUrl: `https://assets.example/${id}.png`,
    price: "100",
  };
}

async function searchTool(host: {
  approve?: () => Promise<"once">;
  ask?: (r: UserInputRequest) => Promise<UserInputResponse>;
}) {
  const providers = createStudioBundledToolProviders({ cwd: "/tmp/project" });
  const provider = providers.find((p) => p.id === "@overdare/rag-tools")!;
  const tools = await provider.createTools({ cwd: "/tmp/project", host });
  return tools.find((t) => t.name === "overdaresearch")!;
}

describe("overdaresearch asset selection", () => {
  test("default discovery preserves candidates, descriptions, images and packs without asking", async () => {
    let body: Record<string, unknown> = {};
    globalThis.fetch = (async (_url, init) => {
      body = JSON.parse(init?.body as string);
      return Response.json({
        results: [
          { ...asset("111", "Katana A"), text: "A rusty blade. Category: WEAPON Keywords: blade" },
          { ...asset("222", "Katana B"), thumbnailUrl: undefined, imageUrl: "https://assets.example/b.png" },
        ],
        totalCount: 2,
        packs: [{ keyword: "pack_weapons", memberCount: 12 }],
      });
    }) as typeof fetch;
    let asked = false;
    const tool = await searchTool({
      ask: async () => {
        asked = true;
        return { answers: {} };
      },
    });
    const args = tool.parameters.parse({ query: "katana", source: "assets", topK: 8 });
    const result = await tool.execute(args, ctx);
    expect(asked).toBe(false);
    expect(body.includePacks).toBe(true);
    expect(JSON.parse(result.output)).toMatchObject({
      results: [
        { assetId: "111", description: "A rusty blade.", imageUrl: "https://assets.example/111.png" },
        { assetId: "222", imageUrl: "https://assets.example/b.png" },
      ],
      packs: [{ keyword: "pack_weapons", memberCount: 12 }],
    });
    expect(result.metadata?.assetId).toBeUndefined();
    expect(result.render?.blocks.some((b) => b.type === "asset_gallery")).toBe(true);
  });

  test("explicit false keeps a single candidate with missing text or image", async () => {
    mockRagFetch([{ ...asset("333", "Only Katana"), text: "", thumbnailUrl: undefined }]);
    let asked = false;
    const tool = await searchTool({
      ask: async () => {
        asked = true;
        return { answers: {} };
      },
    });
    const result = await tool.execute(
      tool.parameters.parse({
        query: "katana",
        source: "assets",
        topK: 8,
        requestUserInput: false,
      }),
      ctx,
    );
    expect(asked).toBe(false);
    expect(JSON.parse(result.output).results).toMatchObject([{ assetId: "333", description: "" }]);
    expect(JSON.parse(result.output).results[0].imageUrl).toBeUndefined();
    expect(result.metadata?.assetId).toBeUndefined();
  });

  test("default discovery preserves pack-only responses", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        results: [],
        totalCount: 0,
        packs: [
          { keyword: "pack_metro", memberCount: 12 },
          { keyword: "pack_city", memberCount: 20 },
        ],
      })) as typeof fetch;
    let asked = false;
    const tool = await searchTool({
      ask: async () => {
        asked = true;
        return { answers: {} };
      },
    });
    const result = await tool.execute(tool.parameters.parse({ query: "subway", source: "assets", topK: 8 }), ctx);
    expect(asked).toBe(false);
    expect(JSON.parse(result.output)).toEqual({
      results: [],
      totalCount: 0,
      packs: [
        { keyword: "pack_metro", memberCount: 12 },
        { keyword: "pack_city", memberCount: 20 },
      ],
    });
  });

  test("explicit user selection returns only the offered asset ID", async () => {
    mockRagFetch([asset("111", "Katana A"), asset("222", "Katana B")]);
    let seen: UserInputRequest | undefined;
    const tool = await searchTool({
      ask: async (r) => {
        seen = r;
        return { answers: { asset: "222" } };
      },
    });
    const result = await tool.execute(
      tool.parameters.parse({
        query: "katana",
        source: "assets",
        topK: 8,
        requestUserInput: true,
      }),
      ctx,
    );
    expect(seen?.questions[0].display).toBe("asset");
    expect(seen?.questions[0].options.map((o) => o.value)).toEqual(["111", "222", "none"]);
    expect(seen?.questions[0].options[0].asset?.thumbnailUrl).toBe("https://assets.example/111.png");
    expect(result.metadata).toMatchObject({ selectionStatus: "selected", assetId: "222" });
    expect(result.output).toContain("Selected asset: Katana B");
  });

  test("explicit true asks even when only one asset matches", async () => {
    mockRagFetch([asset("333", "Only Katana")]);
    let asked = false;
    const tool = await searchTool({
      ask: async () => {
        asked = true;
        return { answers: { asset: "333" } };
      },
    });
    await tool.execute(
      tool.parameters.parse({ query: "katana", source: "assets", topK: 8, requestUserInput: true }),
      ctx,
    );
    expect(asked).toBe(true);
  });

  test("all asset categories follow the requested selection mode", async () => {
    for (const override of [
      { categoryId: "AUDIO" },
      { assetType: "MODEL", categoryId: "ANIMATION" },
      { assetType: "ANIMATION", categoryId: "GAMEPLAY" },
      { categoryId: "UI_Elements" },
      { assetType: "ACTION_SEQUENCE", categoryId: "EFFECTS" },
    ]) {
      mockRagFetch([
        { ...asset("aaa", "Top"), ...override },
        { ...asset("bbb", "Second"), ...override },
      ]);
      let asked = 0;
      const tool = await searchTool({
        ask: async () => {
          asked++;
          return { answers: { asset: "bbb" } };
        },
      });
      const discovery = await tool.execute(tool.parameters.parse({ query: "effect", source: "assets", topK: 8 }), ctx);
      expect(asked).toBe(0);
      expect(JSON.parse(discovery.output).results.map((a: { assetId: string }) => a.assetId)).toEqual(["aaa", "bbb"]);
      const selection = await tool.execute(
        tool.parameters.parse({
          query: "effect",
          source: "assets",
          topK: 8,
          requestUserInput: true,
        }),
        ctx,
      );
      expect(asked).toBe(1);
      expect(selection.metadata?.assetId).toBe("bbb");
    }
  });

  test("none, cancellation and free text are distinct non-importable outcomes", async () => {
    for (const [answer, status] of [
      ["none", "none"],
      ["", "cancelled"],
      ["try a wooden sword", "custom"],
      ["pack:unoffered", "custom"],
      ["unoffered-id", "custom"],
    ]) {
      mockRagFetch([asset("111", "Katana A")]);
      const tool = await searchTool({ ask: async () => ({ answers: { asset: answer } }) });
      const result = await tool.execute(
        tool.parameters.parse({
          query: "katana",
          source: "assets",
          topK: 8,
          requestUserInput: true,
        }),
        ctx,
      );
      expect(result.metadata?.selectionStatus).toBe(status);
      expect(result.metadata?.assetId).toBeUndefined();
      expect(result.metadata?.packKeyword).toBeUndefined();
      expect(result.output).not.toContain("Selected assetId:");
    }
  });

  test("no assets or packs returns not-found without asking", async () => {
    mockRagFetch([]);
    let asked = false;
    const tool = await searchTool({
      ask: async () => {
        asked = true;
        return { answers: {} };
      },
    });
    const result = await tool.execute(
      tool.parameters.parse({
        query: "katana",
        source: "assets",
        topK: 8,
        requestUserInput: true,
      }),
      ctx,
    );
    expect(asked).toBe(false);
    expect(result.output).toBe("No results found.");
  });
});
