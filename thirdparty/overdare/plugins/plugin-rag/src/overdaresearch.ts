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

interface RagResponse {
  results: RagResult[];
  totalCount: number;
}

export const name = "overdaresearch";

export const description = `Searches OVERDARE documentation and code examples using RAG.
Use this tool to find relevant OVERDARE API references, guides, code examples, and Lua scripts.

When to use each source:
  - Always start with topK=3~5; only increase if results are insufficient — do NOT start with topK=5 or higher
  - "docs": API references, conceptual guides, configuration details, service descriptions
  - "code": Working Lua implementation examples, proven patterns, real script snippets
  - When writing or modifying code, search BOTH sources in parallel (two calls: one for docs, one for code) to get API shape + implementation patterns simultaneously

Query tips:
  - Provide a clear, specific RAG-friendly query describing what you want to find
  - Never include "OVERDARE" in query — all content is already scoped to OVERDARE
  - When querying for docs, do not include keywords like "doc" or "documentation" in the query — the source already targets the documentation store
  - When querying for code, do not include keywords like "Lua", "example", or "script" in the query — the source already targets the Lua code store`;

export const parameters = z.object({
  query: z.string().describe("Search query for OVERDARE (English only)"),
  source: z
    .enum(["docs", "code"])
    .describe(
      "docs = API references, guides, conceptual documentation. code = working Lua implementation examples and patterns. When generating code, search BOTH sources.",
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
    const results = (data?.results ?? []).filter((r) => r.text.length > 0);

    return {
      output: results.length ? JSON.stringify(results, null, 2) : "No results found.",
      render: buildSearchRender({ source: args.source, query: args.query }, results),
      metadata: { resultCount: results.length, results },
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
