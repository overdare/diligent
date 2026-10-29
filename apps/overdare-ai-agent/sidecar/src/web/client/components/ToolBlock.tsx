// @summary Tool call block with icon, summary header, and tool-type-specific expandable content

import type { ToolRenderPayload } from "@diligent/protocol";
import { useEffect } from "react";
import { rememberShownOpen, toolDisclosureKey, useRememberedOpen } from "../lib/disclosure-state";
import type { RenderItem } from "../lib/thread-store";
import { normalizeToolName } from "../lib/thread-utils";
import { formatToolDurationLabel } from "../lib/time-format";
import { getToolActivityLabel, getToolInfo, summarizeInput, summarizeOutput } from "../lib/tool-info";
import { ContentText } from "./ContentText";
import { ToolActivityRow } from "./ToolActivityRow";
import { ToolOutputImages } from "./ToolOutputImages";
import { ToolRenderBlocks } from "./ToolRenderBlocks";

interface ToolBlockProps {
  item: Extract<RenderItem, { kind: "tool" }>;
  threadCwd?: string;
  nested?: boolean;
  initialOpen?: boolean;
  showPreviewWhenCollapsed?: boolean;
  inlinePreviewWhenCollapsed?: boolean;
}

/* ── Tool-specific expanded content ───────────────────────────────── */

function normalizeInputText(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text.trim();
  }
}

function payloadIncludesText(render: ToolRenderPayload, text: string): boolean {
  const value = normalizeInputText(text);
  if (!value) return true;

  return render.blocks.some((block) => {
    switch (block.type) {
      case "command":
        return block.command.trim() === value;
      case "file":
        return block.filePath.trim() === value;
      case "text":
      case "summary":
        return normalizeInputText(block.text) === value;
      case "list":
        return block.items.some((item) => item.trim() === value);
      case "key_value":
        return block.items.some((item) => item.value.trim() === value);
      default:
        return false;
    }
  });
}

function ToolContent({ item, render }: { item: Extract<RenderItem, { kind: "tool" }>; render?: ToolRenderPayload }) {
  if (render && render.blocks.length > 0) {
    const inputText = (item.inputText || render.inputSummary || "").trim();
    const shouldShowInput = Boolean(inputText) && !payloadIncludesText(render, inputText);

    if (!shouldShowInput) return <ToolRenderBlocks payload={render} />;

    return (
      <div className="space-y-2">
        <ContentText text={inputText} label="Input" maxLines={4} />
        <ToolRenderBlocks payload={render} />
      </div>
    );
  }

  // Final fallback: plugins, unknown tools, or a start payload without output blocks.
  const inputText = item.inputText || render?.inputSummary;
  return (
    <div className="space-y-2">
      {inputText && <ContentText text={inputText} label="Input" />}
      {item.outputText && <ContentText text={item.outputText} label="Output" isError={item.isError} />}
    </div>
  );
}

/* ── Main ToolBlock ─────────────────────────────────────────────── */

export function ToolBlock({
  item,
  nested = false,
  initialOpen,
  showPreviewWhenCollapsed = false,
  inlinePreviewWhenCollapsed = false,
}: ToolBlockProps) {
  const renderPayload = item.render;
  // Closed unless asked: an expanded image or gallery is tall and gets in the way when scrolling history.
  const [open, setOpen] = useRememberedOpen(toolDisclosureKey(item.id), initialOpen ?? false);
  const toolInfo = getToolInfo(item.toolName);
  const activityTitle = getToolActivityLabel(item.toolName, item.status, item.isError);
  const normalizedToolName = normalizeToolName(item.toolName);
  const isUserInput = normalizedToolName === "request_user_input";
  const inputSummary = summarizeInput(renderPayload);
  const outputSummary = renderPayload && !isUserInput && item.status === "done" ? summarizeOutput(renderPayload) : "";
  const showOutputSummary =
    normalizedToolName !== "web_action" && Boolean(outputSummary) && outputSummary !== inputSummary;
  const isStreaming = item.status === "streaming";
  const isWebTool = normalizedToolName === "web_action";
  const isBusy = isStreaming && !isWebTool;
  const durationLabel = !isBusy && !item.isError ? formatToolDurationLabel(item.durationMs) : null;
  const compactRow = nested && inlinePreviewWhenCollapsed;
  const inlinePreview = inlinePreviewWhenCollapsed
    ? [inputSummary, showOutputSummary ? outputSummary : ""].filter((part) => part.trim().length > 0).join(" · ")
    : "";
  const baseTitle = inlinePreview ? `${activityTitle}: ${inlinePreview}` : activityTitle;
  const rowTitle = item.background ? `Script · ${baseTitle}` : baseTitle;

  // A lone row merges into a group when an adjacent call arrives (live or from an earlier history page);
  // the group starts from what was on screen, so an opened preview neither vanishes nor shrinks the row.
  useEffect(() => {
    if (!nested && open) rememberShownOpen(toolDisclosureKey(item.id), true);
  }, [item.id, nested, open]);

  return (
    // Calls made from a code mode `exec` script hang under that exec row; background calls are labelled instead.
    <div className={item.parentToolCallId && !item.background ? "ml-3 border-l border-border/30 pl-3" : undefined}>
      <div className="min-w-0">
        <ToolActivityRow
          title={rowTitle}
          detail={showPreviewWhenCollapsed && !inlinePreviewWhenCollapsed ? inputSummary : undefined}
          outputSummary={
            showPreviewWhenCollapsed && !inlinePreviewWhenCollapsed
              ? showOutputSummary
                ? outputSummary
                : undefined
              : undefined
          }
          icon={toolInfo.icon}
          category={toolInfo.category}
          isError={item.isError}
          isBusy={isBusy}
          durationLabel={durationLabel}
          expanded={open}
          expandable={!isStreaming}
          showMeta={showPreviewWhenCollapsed}
          compact={compactRow}
          onToggle={() => setOpen(!open)}
        />

        {open && (
          <div className={nested ? "mt-0.5 max-h-72 overflow-y-auto pr-2" : "mt-2"}>
            <ToolOutputImages images={item.outputImages} />
            <ToolContent item={item} render={renderPayload} />
          </div>
        )}
      </div>
    </div>
  );
}
