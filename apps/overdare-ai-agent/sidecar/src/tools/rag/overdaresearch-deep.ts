// @summary Read original documents or an entire asset pack after catalog discovery.

import type { ToolContext, ToolResult } from "@diligent/core/tool-contract";
import { type RuntimeToolHost, requestToolApproval } from "@diligent/runtime";
import { z } from "zod";
import { buildPackResult, enumeratePack, RAG_BASE_URL } from "./asset-catalog";
import { inspectAssetPreviews } from "./asset-preview";
import { buildOriginFileRender } from "./render";

const TIMEOUT_MS = 5_000;

const LUA_BUCKET = "https://storage.googleapis.com/lua-script-bucket/";
const DOCS_BUCKET = "https://storage.googleapis.com/ovdr-docs-bucket/";

interface OriginFileResult {
  originFileUrl: string;
  content: string | null;
}

interface OriginFileResponse {
  files: OriginFileResult[];
  totalCount: number;
}

export const name = "overdaresearch_deep";

export const description = `Read deeper information after overdaresearch:
- "origin-file": Read full documents from lua-script-bucket or ovdr-docs-bucket. Supply urls (1-10).
- "asset-pack": Read all members of a detected pack with their descriptions and imageUrl. Supply packKeyword; urls must be null or omitted.
  Use this when a pack is suitable for the scene. Choose only the members you need, then use the existing import tools.
  Pack enumeration never imports assets or asks the user for selection.
- "asset-preview": Inspect actual thumbnails from imageUrl values returned by catalog search or pack enumeration.
  Supply urls (1-4) on HTTPS asset-prod.cdn.overdare.com; packKeyword must be null or omitted.
  Returns image content and zero-based URL-to-image indices. Use only when visual inspection helps choose an asset.
  A URL or displayed gallery alone does not let you see the image. Failed previews leave descriptions available.`;

export const parameters = z
  .object({
    action: z.enum(["origin-file", "asset-pack", "asset-preview"]).describe("Choose the deeper read to perform."),
    urls: z
      .array(z.string())
      .min(1)
      .max(10)
      .nullable()
      .optional()
      .describe(
        "origin-file: 1-10 allowed GCS document URLs. asset-preview: 1-4 catalog thumbnail URLs. Use null or omit for asset-pack.",
      ),
    packKeyword: z
      .string()
      .trim()
      .min(1)
      .nullable()
      .optional()
      .describe(
        "asset-pack: exact keyword from the detected packs, e.g. pack_metro. Use null or omit for origin-file and asset-preview.",
      ),
  })
  .superRefine((args, ctx) => {
    if (args.action === "asset-pack") {
      if (!args.packKeyword || args.urls != null)
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "asset-pack requires packKeyword only" });
    } else if (!args.urls || args.packKeyword != null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${args.action} requires urls only` });
    }
    if (args.action === "asset-preview" && (args.urls?.length ?? 0) > 4) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "asset-preview accepts at most four URLs" });
    }
  });

type Params = z.infer<typeof parameters>;

async function fetcher(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${text.substring(0, 200)}`);
  }
  return response.json();
}

function buildResult(action: string, requestedUrls: string[], files: unknown[], totalCount: number): ToolResult {
  const loaded = (files as { content: unknown }[]).filter((f) => f.content !== null);
  return {
    output: files.length
      ? JSON.stringify(files, null, 2)
      : `No ${action === "origin-file" ? "files returned" : "related metadata found"}.`,
    render: buildOriginFileRender(action, requestedUrls, files as OriginFileResult[]),
    metadata: { action, totalCount, loadedCount: loaded.length, files },
  };
}

async function originFile(urls: string[], signal: AbortSignal): Promise<ToolResult> {
  for (const url of urls) {
    if (!url.startsWith(LUA_BUCKET) && !url.startsWith(DOCS_BUCKET)) {
      throw new Error(`URL not from allowed bucket: ${url}\nAllowed: lua-script-bucket, ovdr-docs-bucket`);
    }
  }

  const params = urls.map((u) => `originFileUrl=${encodeURIComponent(u)}`).join("&");
  const data = (await fetcher(`${RAG_BASE_URL}/api/chat/rag/origin-file?${params}`, signal)) as OriginFileResponse;

  return buildResult("origin-file", urls, data.files ?? [], data.totalCount);
}

export async function execute(args: Params, ctx: ToolContext, host?: RuntimeToolHost): Promise<ToolResult> {
  ctx.signal.throwIfAborted();
  const approval = await requestToolApproval(host, {
    permission: "execute",
    toolName: name,
    description: `OVERDARE deep search [${args.action}]: ${args.packKeyword ?? `${args.urls?.length ?? 0} URL(s)`}`,
    details: { action: args.action, urls: args.urls, packKeyword: args.packKeyword },
  });
  if (approval === "reject") {
    return { output: "[Rejected by user]", metadata: { error: true } };
  }

  if (args.action === "asset-pack") {
    return buildPackResult(args.packKeyword!, await enumeratePack(args.packKeyword!, ctx.signal));
  }
  if (args.action === "asset-preview") return inspectAssetPreviews(args.urls!, ctx.signal);
  try {
    return await originFile(args.urls!, AbortSignal.any([ctx.signal, AbortSignal.timeout(TIMEOUT_MS)]));
  } catch (err) {
    if (ctx.signal.aborted) throw ctx.signal.reason;
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      throw new Error("OVERDARE deep search timed out");
    }
    throw err;
  }
}
