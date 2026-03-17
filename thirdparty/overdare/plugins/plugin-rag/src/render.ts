type RenderBlock = Record<string, unknown>;

type ToolRenderPayload = {
  version: 2;
  inputSummary?: string;
  outputSummary?: string;
  blocks: RenderBlock[];
};

interface RagResult {
  text: string;
  originFileUrl?: string;
  script?: string;
}

interface OriginFileResult {
  originFileUrl: string;
  content: string | null;
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function shortUrl(value: string): string {
  const normalized = value.replace(/^https?:\/\//, "");
  return normalized.length > 0 ? normalized : value;
}

function summarizeCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function buildSearchRender(args: { source: string; query: string }, results: RagResult[]): ToolRenderPayload {
  const rows = results.slice(0, 10).map((entry) => [clip(entry.text ?? "", 96), clip(entry.originFileUrl ?? "", 56)]);
  return {
    version: 2,
    inputSummary: clip(`${args.source}: ${args.query}`, 100),
    outputSummary: results.length === 0 ? "No results found." : summarizeCount(results.length, "result"),
    blocks: [
      {
        type: "key_value",
        title: "OVERDARE search",
        items: [
          { key: "source", value: args.source },
          { key: "query", value: args.query },
          { key: "results", value: String(results.length) },
        ],
      },
      ...(results.length === 0
        ? [{ type: "summary" as const, text: "No results found.", tone: "warning" as const }]
        : []),
      ...(rows.length > 0 ? [{ type: "table" as const, title: "Matches", columns: ["Snippet", "Origin"], rows }] : []),
    ],
  };
}

export function buildOriginFileRender(
  action: string,
  requestedUrls: string[],
  files: OriginFileResult[],
): ToolRenderPayload {
  const loaded = files.filter((entry) => typeof entry.content === "string");
  const rows = files
    .slice(0, 10)
    .map((entry) => [
      clip(shortUrl(entry.originFileUrl), 56),
      entry.content ? `${entry.content.split("\n").length} lines` : "missing",
    ]);
  const blocks: ToolRenderPayload["blocks"] = [
    {
      type: "key_value",
      title: "OVERDARE deep search",
      items: [
        { key: "action", value: action },
        { key: "requested", value: String(requestedUrls.length) },
        { key: "loaded", value: String(loaded.length) },
      ],
    },
  ];

  if (rows.length > 0) {
    blocks.push({ type: "table", title: "Fetched files", columns: ["Origin", "Status"], rows });
  }

  const firstLoaded = loaded[0];
  if (firstLoaded?.content) {
    blocks.push({ type: "file", filePath: firstLoaded.originFileUrl, content: firstLoaded.content });
  }

  return {
    version: 2,
    inputSummary: `${action} (${requestedUrls.length} URL${requestedUrls.length === 1 ? "" : "s"})`,
    outputSummary: summarizeCount(loaded.length, "file"),
    blocks,
  };
}
