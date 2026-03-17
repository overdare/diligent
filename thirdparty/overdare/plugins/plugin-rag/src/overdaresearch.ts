import { z } from "zod";
import { loadOverdareConfig } from "./config.ts";
import { buildSearchRender } from "./render.ts";

type ToolRenderPayload = {
  version: 2;
  inputSummary?: string;
  outputSummary?: string;
  blocks: Array<Record<string, unknown>>;
};

const BASE_URL = "https://aiguide.overdare.com";
const TIMEOUT_MS = 5_000;

interface RagResult {
  text: string;
  originFileUrl?: string;
  script?: string;
}

interface AssetResult {
  text: string;
  score: number;
  title: string;
  keywords: string[];
  assetId: string;
  assetType: string;
  categoryId: string;
  subCategoryId: string;
}

interface RagResponse {
  results: Array<RagResult | AssetResult>;
  totalCount: number;
}

function isAssetResult(result: RagResult | AssetResult): result is AssetResult {
  return "assetId" in result;
}

function normalizeAssetResult(result: AssetResult): AssetResult {
  return {
    text: result.text,
    score: result.score,
    title: result.title,
    keywords: result.keywords,
    assetId: result.assetId,
    assetType: result.assetType,
    categoryId: result.categoryId,
    subCategoryId: result.subCategoryId,
  };
}

export const name = "overdaresearch";

export const description = `Searches OVERDARE documentation, code examples, and assets using RAG.
Use this tool to find relevant OVERDARE API references, guides, code examples, Lua scripts, and asset metadata.

When to use each source:
  - Always start with topK=3~5; only increase if results are insufficient — do NOT start with topK=5 or higher
  - "docs": API references, conceptual guides, configuration details, service descriptions
  - "code": Working Lua implementation examples, proven patterns, real script snippets
  - "assets": Asset catalog search returning asset metadata such as title, keywords, assetId, assetType, categoryId, and subCategoryId
  - When writing or modifying code, search BOTH docs and code in parallel (two calls: one for docs, one for code) to get API shape + implementation patterns simultaneously

Query tips:
  - Provide a clear, specific RAG-friendly query describing what you want to find
  - Never include "OVERDARE" in query — all content is already scoped to OVERDARE
  - When querying for docs, do not include keywords like "doc" or "documentation" in the query — the source already targets the documentation store
  - When querying for code, do not include keywords like "Lua", "example", or "script" in the query — the source already targets the Lua code store
  - When querying for assets, use short noun-based queries such as item names, themes, categories, or use cases`;

export const parameters = z.object({
  query: z.string().describe("Search query for OVERDARE (English only)"),
  source: z
    .enum(["docs", "code", "assets"])
    .describe(
      "docs = API references and guides. code = working Lua implementation examples and patterns. assets = asset catalog search with asset metadata fields.",
    ),
  topK: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(3)
    .optional()
    .describe("Number of results to return (1-20, default: 3)"),
});

type Params = z.infer<typeof parameters>;

interface ToolContext {
  toolCallId: string;
  signal: AbortSignal;
  approve: (req: {
    permission: "read" | "write" | "execute";
    toolName: string;
    description: string;
    details?: Record<string, unknown>;
  }) => Promise<"once" | "always" | "reject">;
}

interface ToolResult {
  output: string;
  render?: ToolRenderPayload;
  metadata?: Record<string, unknown>;
}

function resolveAuthToken(): string {
  const token = process.env.OVERDARE_RAG_AUTH_TOKEN || loadOverdareConfig().ragAuthToken;
  if (!token) {
    throw new Error(
      "Missing OVERDARE RAG auth token.\n" +
        "Set OVERDARE_RAG_AUTH_TOKEN env var or ragAuthToken in ~/.diligent/overdare.jsonc",
    );
  }
  return token;
}

export async function execute(args: Params, ctx: ToolContext): Promise<ToolResult> {
  const approval = await ctx.approve({
    permission: "execute",
    toolName: name,
    description: `OVERDARE RAG search [${args.source}]: ${args.query}`,
    details: { query: args.query, source: args.source, topK: args.topK },
  });
  if (approval === "reject") {
    return { output: "[Rejected by user]", metadata: { error: true } };
  }

  const authToken = resolveAuthToken();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE_URL}/api/chat/rag`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        query: args.query,
        version: "3",
        source: args.source,
        topK: args.topK ?? 3,
        threshold: 0.5,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      let errMsg = errText.substring(0, 200);
      try {
        const errJson = JSON.parse(errText) as { error?: string };
        if (errJson?.error) errMsg = errJson.error.substring(0, 200);
      } catch {
        // ignore parse error, use raw text
      }
      throw new Error(`OVERDARE RAG search failed (HTTP ${response.status}): ${errMsg}`);
    }

    const data = (await response.json()) as RagResponse;
    const results = (data?.results ?? []).filter((result) => result.text.length > 0);

    if (args.source === "assets") {
      const assetResults = results.filter(isAssetResult).map(normalizeAssetResult);
      return {
        output: assetResults.length
          ? JSON.stringify({ results: assetResults, totalCount: data?.totalCount ?? assetResults.length }, null, 2)
          : "No results found.",
        render: buildSearchRender({ source: args.source, query: args.query }, assetResults),
        metadata: { resultCount: assetResults.length, results: assetResults },
      };
    }

    const ragResults = results.filter((result): result is RagResult => !isAssetResult(result));

    return {
      output: ragResults.length ? JSON.stringify(ragResults, null, 2) : "No results found.",
      render: buildSearchRender({ source: args.source, query: args.query }, ragResults),
      metadata: { resultCount: ragResults.length, results: ragResults },
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("OVERDARE RAG search timed out");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
