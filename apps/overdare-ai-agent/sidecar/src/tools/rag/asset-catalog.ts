// @summary Shared model-readable catalog metadata and exact pack enumeration.
import type { ToolResult } from "@diligent/core/tool-contract";
import { normalizeAssetForRender } from "./render";

export const RAG_BASE_URL = process.env.DILIGENT_RAG_BASE_URL?.trim() || "https://aiguide.overdare.com";
export const RAG_TIMEOUT_MS = 10_000;
export type CatalogAsset = Parameters<typeof normalizeAssetForRender>[0];

export function isCatalogAsset(value: unknown): value is CatalogAsset & { assetId: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "assetId" in value &&
    typeof value.assetId === "string" &&
    value.assetId.trim().length > 0
  );
}

function visualDescription(text: string): string {
  const prose = text.split(/\s+Category:\s/)[0].trim();
  return prose.length > 400 ? `${prose.slice(0, 400)}…` : prose;
}

export function normalizeAssetCandidate(raw: CatalogAsset) {
  const normalized = normalizeAssetForRender(raw);
  const text = typeof raw.text === "string" ? raw.text : "";
  return {
    text,
    description: visualDescription(text),
    imageUrl: normalized.thumbnailUrl,
    score: raw.score,
    title: normalized.title,
    keywords: normalized.keywords,
    assetId: normalized.assetId,
    assetType: normalized.assetType,
    categoryId: normalized.categoryId,
    subCategoryId: normalized.subCategoryId,
  };
}

export type AssetCandidate = ReturnType<typeof normalizeAssetCandidate>;
export type PackMember = Omit<AssetCandidate, "text" | "score">;

export async function enumeratePack(keyword: string, signal: AbortSignal): Promise<PackMember[]> {
  signal.throwIfAborted();
  try {
    const response = await fetch(`${RAG_BASE_URL}/api/chat/rag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: "3", source: "assets", assetFilter: { keywords: [keyword] } }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(RAG_TIMEOUT_MS)]),
    });
    if (!response.ok) throw new Error(`Pack enumeration failed (HTTP ${response.status})`);
    const data = (await response.json()) as { results?: unknown[] };
    signal.throwIfAborted();
    return (data.results ?? []).filter(isCatalogAsset).map((raw) => {
      // Palettes retain the visual prose once; ranking and duplicate catalog text are unnecessary.
      const { text: _text, score: _score, ...member } = normalizeAssetCandidate(raw);
      return member;
    });
  } catch (err) {
    if (signal.aborted) throw signal.reason;
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      throw new Error("Pack enumeration timed out");
    }
    throw err;
  }
}

export function buildPackResult(keyword: string, members: PackMember[]): ToolResult {
  const output = JSON.stringify({ pack: keyword, memberCount: members.length, members }, null, 2);
  return {
    output,
    // Pack palettes must remain valid JSON and include every member through the executor.
    maxOutputBytes: Buffer.byteLength(output),
    metadata: { resultCount: members.length, packKeyword: keyword },
  };
}
