// @summary Structured assistant rendering that routes provider-native web blocks through shared ToolBlock presentation
import type { ContentBlock, ToolRenderPayload } from "@diligent/protocol";
import type { RenderItem } from "../lib/thread-store";
import { MarkdownContent } from "./MarkdownContent";
import { ToolBlock } from "./ToolBlock";

interface AssistantContentBlocksProps {
  blocks: ContentBlock[];
}

function CitationList({ block }: { block: Extract<ContentBlock, { type: "text" }> }) {
  if (!block.citations || block.citations.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1.5 border-l border-border/30 pl-3 text-xs text-muted/90">
      {block.citations.map((citation, index) => (
        <li key={`${citation.type}-${index}`}>
          {citation.type === "web_search_result_location" ? (
            <>
              <span className="font-medium">Source {index + 1}:</span>{" "}
              <a className="underline underline-offset-2" href={citation.url} target="_blank" rel="noreferrer">
                {citation.title ?? citation.url}
              </a>
              {citation.citedText ? <span>{` — “${citation.citedText}”`}</span> : null}
            </>
          ) : (
            <>
              <span className="font-medium">Document {citation.documentIndex + 1}:</span>
              {citation.documentTitle ? <span>{` ${citation.documentTitle}`}</span> : null}
              {citation.citedText ? <span>{` — “${citation.citedText}”`}</span> : null}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function summarizeProviderInput(block: Extract<ContentBlock, { type: "provider_tool_use" }>): string | undefined {
  const type = typeof block.input.type === "string" ? block.input.type : undefined;
  if (type === "search") {
    const query = typeof block.input.query === "string" ? block.input.query : undefined;
    return query ? `Searching ${query}` : "Searching the web";
  }
  if (type === "open_page") {
    const url = typeof block.input.url === "string" ? block.input.url : undefined;
    return url ? `Opening ${url}` : "Opening page";
  }
  if (type === "find_in_page") {
    const pattern = typeof block.input.pattern === "string" ? block.input.pattern : undefined;
    return pattern ? `Finding “${pattern}” in page` : "Finding in page";
  }
  return typeof block.input.query === "string" ? `Searching ${block.input.query}` : undefined;
}

function makeToolItem(args: {
  key: string;
  status: "streaming" | "done";
  inputSummary?: string;
  outputSummary?: string;
  blocks: ToolRenderPayload["blocks"];
  outputText?: string;
  isError?: boolean;
}): Extract<RenderItem, { kind: "tool" }> {
  return {
    id: args.key,
    kind: "tool",
    toolName: "web_action",
    inputText: args.inputSummary ?? "",
    outputText: args.outputText ?? "",
    isError: args.isError ?? false,
    status: args.status,
    timestamp: 0,
    toolCallId: args.key,
    startedAt: 0,
    render: {
      inputSummary: args.inputSummary,
      outputSummary: args.outputSummary,
      blocks: args.blocks,
    },
  };
}

function ProviderToolUseBlockView({
  block,
  index,
}: {
  block: Extract<ContentBlock, { type: "provider_tool_use" }>;
  index: number;
}) {
  const item = makeToolItem({
    key: `provider-tool-${block.id}-${index}`,
    status: "streaming",
    inputSummary: summarizeProviderInput(block),
    blocks: [],
  });
  return <ToolBlock item={item} />;
}

function WebSearchResultBlockView({
  block,
  index,
}: {
  block: Extract<ContentBlock, { type: "web_search_result" }>;
  index: number;
}) {
  const isError = Boolean(block.error);
  const outputSummary = isError
    ? "Web search failed"
    : `Found ${block.results.length} result${block.results.length === 1 ? "" : "s"}`;
  const outputText = isError
    ? (block.error?.message ?? block.error?.code ?? "")
    : block.results
        .map(
          (result, resultIndex) =>
            `${resultIndex + 1}. ${result.title ?? result.url}\n${result.url}${result.snippet ? `\n${result.snippet}` : ""}`,
        )
        .join("\n\n");
  const blocks: ToolRenderPayload["blocks"] = isError
    ? [{ type: "text", title: "Output", text: outputText, isError: true }]
    : [
        {
          type: "list",
          title: "Results",
          items: block.results.map((result) => {
            const title = result.title ?? result.url;
            const snippet = result.snippet?.trim();
            return snippet ? `${title} — ${result.url}\n${snippet}` : `${title} — ${result.url}`;
          }),
        },
      ];

  const item = makeToolItem({
    key: `search-result-${block.toolUseId}-${index}`,
    status: "done",
    inputSummary: outputSummary,
    outputSummary,
    blocks,
    outputText,
    isError,
  });
  return <ToolBlock item={item} />;
}

function WebFetchResultBlockView({
  block,
  index,
}: {
  block: Extract<ContentBlock, { type: "web_fetch_result" }>;
  index: number;
}) {
  const isError = Boolean(block.error);
  const outputSummary = isError ? "Opening page failed" : `Opened ${block.document?.title ?? block.url}`;
  const outputText = isError ? (block.error?.message ?? block.error?.code ?? "") : (block.document?.text ?? block.url);
  const blocks: ToolRenderPayload["blocks"] = isError
    ? [{ type: "text", title: "Output", text: outputText, isError: true }]
    : [
        {
          type: "key_value",
          title: "Page",
          items: [
            { key: "url", value: block.url },
            ...(block.document?.title ? [{ key: "title", value: block.document.title }] : []),
            ...(block.document?.mimeType ? [{ key: "type", value: block.document.mimeType }] : []),
          ],
        },
        ...(block.document?.text
          ? ([{ type: "text", title: "Output", text: block.document.text }] as ToolRenderPayload["blocks"])
          : []),
      ];

  const item = makeToolItem({
    key: `fetch-result-${block.toolUseId}-${index}`,
    status: "done",
    inputSummary: outputSummary,
    outputSummary,
    blocks,
    outputText,
    isError,
  });
  return <ToolBlock item={item} />;
}

export function AssistantContentBlocks({ blocks }: AssistantContentBlocksProps) {
  const visibleBlocks = blocks.filter((block) => block.type !== "thinking");
  if (visibleBlocks.length === 0) return null;

  return (
    <div className="space-y-3">
      {visibleBlocks.map((block, index) => {
        if (block.type === "text") {
          return (
            <div key={`text-${block.text.slice(0, 32)}-${index}`}>
              <MarkdownContent text={block.text} />
              <CitationList block={block} />
            </div>
          );
        }
        if (block.type === "provider_tool_use") {
          return <ProviderToolUseBlockView key={`provider-tool-${block.id}-${index}`} block={block} index={index} />;
        }
        if (block.type === "web_search_result") {
          return (
            <WebSearchResultBlockView key={`search-result-${block.toolUseId}-${index}`} block={block} index={index} />
          );
        }
        if (block.type === "web_fetch_result") {
          return (
            <WebFetchResultBlockView key={`fetch-result-${block.toolUseId}-${index}`} block={block} index={index} />
          );
        }
        return null;
      })}
    </div>
  );
}
