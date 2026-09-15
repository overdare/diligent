// @summary Tests OVERDARE Studio bundled RAG tool provider assembly.

import { describe, expect, mock, test } from "bun:test";
import { createStudioBundledToolProviders } from "../../src/tools";
import { parameters } from "../../src/tools/rag/overdaresearch";

describe("createRagToolProvider", () => {
  test("creates bundled RAG tools with Zod schemas and plugin supersession", async () => {
    const providers = createStudioBundledToolProviders({ cwd: "/tmp/project" });
    const provider = providers.find((candidate) => candidate.id === "@overdare/rag-tools");

    expect(provider).toBeDefined();
    expect(provider!.supersedesPluginPackages).toContain("@overdare/plugin-rag");

    const tools = await provider!.createTools({ cwd: "/tmp/project" });
    const searchTool = tools.find((candidate) => candidate.name === "overdaresearch");
    const deepTool = tools.find((candidate) => candidate.name === "overdaresearch_deep");

    expect(searchTool).toBeDefined();
    expect(deepTool).toBeDefined();
    expect(searchTool!.supportParallel).toBe(true);
    expect(deepTool!.supportParallel).toBe(true);
    expect(() => searchTool!.parameters.parse({ query: "spawn location", source: "docs", topK: 3 })).not.toThrow();
    expect(() => searchTool!.parameters.parse({ query: "tree", source: "assets", topK: 3 })).not.toThrow();
    for (const source of ["code", "debug"]) {
      expect(() => searchTool!.parameters.parse({ query: "spawn location", source, topK: 3 })).toThrow();
    }
    expect(parameters.shape).not.toHaveProperty("debugCaseFilter");
    expect(() =>
      deepTool!.parameters.parse({
        action: "origin-file",
        urls: ["https://storage.googleapis.com/ovdr-docs-bucket/example.md"],
      }),
    ).not.toThrow();
  });

  test("docs search forwards the request and renders document text while filtering empty results", async () => {
    const originalFetch = globalThis.fetch;
    const document = {
      text: "Respawn API reference",
      originFileUrl: "https://storage.googleapis.com/ovdr-docs-bucket/respawn.md",
    };
    const fetchMock = mock(async () => Response.json({ results: [document, { text: "" }], totalCount: 2 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const provider = createStudioBundledToolProviders({ cwd: "/tmp/project" }).find(
        (candidate) => candidate.id === "@overdare/rag-tools",
      )!;
      const tools = await provider.createTools({ cwd: "/tmp/project" });
      const searchTool = tools.find((candidate) => candidate.name === "overdaresearch")!;
      const result = await searchTool.execute(
        searchTool.parameters.parse({ query: "respawn", source: "docs", topK: 3 }),
        { toolCallId: "test", signal: new AbortController().signal, abort: () => {} },
      );
      const request = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0][1];
      expect(JSON.parse(request.body as string)).toMatchObject({ query: "respawn", source: "docs", topK: 3 });
      expect(JSON.parse(result.output)).toEqual([document]);
      expect(result.render?.outputSummary).toBe("1 document match");
      expect(result.render?.blocks).toContainEqual({ type: "text", title: "Top document match", text: document.text });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("preserves approval rejection behavior without calling RAG service", async () => {
    const fetchMock = mock(globalThis.fetch);
    const providers = createStudioBundledToolProviders({ cwd: "/tmp/project" });
    const provider = providers.find((candidate) => candidate.id === "@overdare/rag-tools")!;
    const tools = await provider.createTools({
      cwd: "/tmp/project",
      host: {
        approve: async () => "reject",
      },
    });
    const searchTool = tools.find((candidate) => candidate.name === "overdaresearch")!;

    const result = await searchTool.execute(
      { query: "spawn location", source: "docs", topK: 3 },
      { toolCallId: "test", signal: new AbortController().signal, abort: () => {} },
    );

    expect(result).toEqual({ output: "[Rejected by user]", metadata: { error: true } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
