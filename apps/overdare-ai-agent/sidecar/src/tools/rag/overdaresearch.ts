// @summary Discover asset candidates and packs, with an optional explicit user picker.

import type { ToolContext, ToolResult } from "@diligent/core/tool-contract";
import { type RuntimeToolHost, requestToolApproval, requestToolUserInput } from "@diligent/runtime";
import { z } from "zod";
import {
  buildPackResult,
  enumeratePack,
  isCatalogAsset,
  normalizeAssetCandidate,
  RAG_BASE_URL,
  RAG_TIMEOUT_MS,
} from "./asset-catalog";
import { buildSearchRender, normalizeAssetForRender } from "./render";

interface RagResult {
  text: string;
  originFileUrl?: string;
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

type AnyResult = RagResult | AssetResult;

interface PackInfo {
  keyword: string;
  memberCount: number;
}

interface RagResponse {
  results: AnyResult[];
  totalCount: number;
  // Present when the request set includePacks (assets only); [] when none detected.
  packs?: PackInfo[];
}

function isAssetResult(result: AnyResult): result is AssetResult {
  return "assetId" in result;
}

export const name = "overdaresearch";

export const description = `Searches OVERDARE documentation and assets using RAG.
Use this tool to find relevant OVERDARE API references, guides, and asset metadata.

When to use each source:
  - Default topK by source: docs=4, assets=8; only increase if results are insufficient
  - "docs": API references, conceptual guides, configuration details, service descriptions
  - "assets": Returns candidates with assetId, title, description, imageUrl, classifications, and detected packs.
    Choose suitable assets yourself using descriptions. If appearance matters, inspect imageUrl with
    overdaresearch_deep(action="asset-preview") before judging the image.
    A pack may be more suitable for a themed scene: use overdaresearch_deep(action="asset-pack", packKeyword=...)
    to read its palette, then import only the members you need using the existing import tools.
    Set requestUserInput=true only when you want to offer the user a choice; otherwise continue autonomously.
    If nothing fits, refine the search or use another approach. A pack is a palette, not a prefab.

Query tips:
  - Provide a clear, specific RAG-friendly query describing what you want to find
  - Never include "OVERDARE" in query — all content is already scoped to OVERDARE
  - When querying for docs, do not include keywords like "doc" or "documentation" in the query — the source already targets the documentation store
  - When querying for assets, use short noun-based queries such as item names, themes, categories, or use cases`;

export const parameters = z.object({
  query: z.string().describe("Search query for OVERDARE (English only)"),
  source: z
    .enum(["docs", "assets"])
    .describe("docs = API references and guides. assets = asset catalog search with asset metadata fields."),
  topK: z.number().int().min(1).max(10).describe("Number of results to return"),
  requestUserInput: z
    .boolean()
    .default(false)
    .describe(
      "Assets only. Set true to offer the user an asset or pack picker, including a none option. " +
        "Otherwise read the candidates and choose suitable assets yourself without waiting for user input.",
    ),
});

type Params = z.infer<typeof parameters>;

const PACK_OPTION_PREFIX = "pack:";

interface AssetSelection {
  output: string;
  selectionStatus: "selected" | "none" | "cancelled" | "custom";
  assetId?: string;
  /** Set only when the user picked an offered pack. */
  packKeyword?: string;
}

async function selectAsset(
  host: RuntimeToolHost | undefined,
  query: string,
  rawAssets: Array<Partial<AssetResult>>,
  packs: PackInfo[],
): Promise<AssetSelection> {
  const normalized = rawAssets.map(normalizeAssetForRender);
  const response = await requestToolUserInput(host, {
    questions: [
      {
        id: "asset",
        header: "Asset",
        question: `Pick an asset for "${query}"`,
        display: "asset",
        options: [
          // Themed packs come first so they don't drown at the end of the asset
          // grid. They carry no `asset` payload on purpose: the picker renders
          // payload-less options as full-width text rows instead of thumbnail
          // cards, which visually separates "import the whole set" from the
          // individual assets.
          ...packs.map((p) => ({
            label: `Use pack palette: ${p.keyword} (${p.memberCount} assets)`,
            description: "Themed asset collection",
            value: `${PACK_OPTION_PREFIX}${p.keyword}`,
          })),
          ...normalized.map((a) => ({
            label: a.title,
            description: a.price ? `${a.assetType} · ${a.price}` : a.assetType,
            value: a.assetId,
            asset: {
              thumbnailUrl: a.thumbnailUrl,
              previewUrl: a.previewUrl,
              price: a.price,
              subtitle: a.assetType,
            },
          })),
          { label: "None of these are suitable", description: "Try another search or approach", value: "none" },
        ],
      },
    ],
  });

  const answer = response?.answers.asset;
  const chosen = Array.isArray(answer) ? answer[0] : answer;
  if (!chosen || chosen.trim().length === 0) {
    return { output: "[Cancelled by user]", selectionStatus: "cancelled" };
  }
  if (chosen === "none") {
    return { output: "No suitable asset selected. Try another search or approach.", selectionStatus: "none" };
  }
  const pack = packs.find((p) => `${PACK_OPTION_PREFIX}${p.keyword}` === chosen);
  if (pack) return { output: "", selectionStatus: "selected", packKeyword: pack.keyword };
  const match = normalized.find((a) => a.assetId === chosen);
  if (match)
    return {
      output: `Selected asset: ${match.title} (assetId: ${match.assetId})`,
      selectionStatus: "selected",
      assetId: match.assetId,
    };
  return { output: `User feedback (no asset selected): ${chosen}`, selectionStatus: "custom" };
}

export async function execute(args: Params, ctx: ToolContext, host?: RuntimeToolHost): Promise<ToolResult> {
  ctx.signal.throwIfAborted();
  const approval = await requestToolApproval(host, {
    permission: "execute",
    toolName: name,
    description: `OVERDARE RAG search [${args.source}]: ${args.query}`,
    details: { query: args.query, source: args.source, topK: args.topK },
  });
  if (approval === "reject") {
    return { output: "[Rejected by user]", metadata: { error: true } };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RAG_TIMEOUT_MS);

  try {
    const response = await fetch(`${RAG_BASE_URL}/api/chat/rag`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: args.query,
        version: "3",
        source: args.source,
        topK: args.topK ?? 4,
        threshold: 0.5,
        ...(args.source === "assets" ? { includePacks: true } : {}),
      }),
      signal: AbortSignal.any([ctx.signal, controller.signal]),
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
    clearTimeout(timer); // A user picker can wait longer than the network timeout.
    const results = data?.results ?? [];

    if (args.source === "assets") {
      const rawAssets = results.filter(isCatalogAsset);
      const assetResults = rawAssets.map(normalizeAssetCandidate);
      const packs = data?.packs ?? [];

      if (rawAssets.length === 0 && packs.length === 0) {
        return { output: "No results found.", metadata: { resultCount: 0 } };
      }
      if (args.requestUserInput) {
        const selection = await selectAsset(host, args.query, rawAssets, packs);
        if (selection.packKeyword) {
          const result = buildPackResult(selection.packKeyword, await enumeratePack(selection.packKeyword, ctx.signal));
          return { ...result, metadata: { ...result.metadata, selectionStatus: "selected" } };
        }
        return {
          output: selection.output,
          metadata: {
            resultCount: rawAssets.length,
            selectionStatus: selection.selectionStatus,
            ...(selection.assetId ? { assetId: selection.assetId } : {}),
          },
        };
      }
      return {
        output: JSON.stringify(
          { results: assetResults, totalCount: data?.totalCount ?? assetResults.length, packs },
          null,
          2,
        ),
        render: buildSearchRender({ source: args.source, query: args.query }, rawAssets),
        metadata: { resultCount: assetResults.length, results: assetResults, packs },
      };
    }

    const ragResults = results.filter(
      (result): result is RagResult => !isAssetResult(result) && (result.text ?? "").length > 0,
    );

    return {
      output: ragResults.length ? JSON.stringify(ragResults, null, 2) : "No results found.",
      render: buildSearchRender({ source: args.source, query: args.query }, ragResults),
      metadata: { resultCount: ragResults.length, results: ragResults },
    };
  } catch (err) {
    if (ctx.signal.aborted) throw ctx.signal.reason;
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("OVERDARE RAG search timed out");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
