// @summary Tool call block with icon, summary header, and tool-type-specific expandable content

import { useState } from "react";
import { cn } from "../lib/cn";
import type { RenderItem } from "../lib/thread-store";
import {
  deriveRenderPayload,
  formatToolDurationMs,
  getToolHeaderTitle,
  getToolInfo,
  summarizeInput,
  summarizeOutput,
} from "../lib/tool-info";
import { ContentText } from "./ContentText";
import { StatusDot } from "./StatusDot";
import { ToolRenderBlocks } from "./ToolRenderBlocks";

interface ToolBlockProps {
  item: Extract<RenderItem, { kind: "tool" }>;
  threadCwd?: string;
}

/* ── Tool-specific expanded content ───────────────────────────────── */

function ToolContent({
  item,
  render,
}: {
  item: Extract<RenderItem, { kind: "tool" }>;
  render?: import("@diligent/protocol").ToolRenderPayload;
}) {
  if (render) {
    return <ToolRenderBlocks payload={render} />;
  }

  // Final fallback: plugins or unknown tools
  return (
    <div className="space-y-2">
      {item.inputText && <ContentText text={item.inputText} label="Input" compact />}
      {item.outputText && <ContentText text={item.outputText} label="Output" compact isError={item.isError} />}
    </div>
  );
}

/* ── Main ToolBlock ─────────────────────────────────────────────── */

export function ToolBlock({ item, threadCwd }: ToolBlockProps) {
  const [open, setOpen] = useState(false);
  const { icon, category } = getToolInfo(item.toolName);
  const renderPayload =
    item.render ?? deriveRenderPayload(item.toolName, item.inputText, item.outputText, { cwd: threadCwd });
  const headerTitle = getToolHeaderTitle(item.toolName, item.inputText, item.outputText, renderPayload, {
    cwd: threadCwd,
  });
  const isUserInput = item.toolName.toLowerCase() === "request_user_input";
  const inputSummary = !isUserInput && item.inputText ? summarizeInput(item.toolName, item.inputText) : "";
  const outputSummary =
    !isUserInput && item.status === "done" && item.outputText ? summarizeOutput(item.toolName, item.outputText) : "";
  const durationLabel = item.status === "done" ? formatToolDurationMs(item.durationMs) : null;

  const isStreaming = item.status === "streaming";
  const isAction = category === "action";

  const statusEl = isStreaming ? (
    <span className="flex shrink-0 items-center gap-1 text-xs text-accent">
      <StatusDot color="accent" pulse />
      <span>running</span>
    </span>
  ) : item.isError ? (
    <span className="shrink-0 text-xs text-danger">error</span>
  ) : null;

  const chevronEl = !isStreaming ? (
    <span
      className={cn(
        "shrink-0 text-xs leading-none text-muted transition-transform duration-150",
        open ? "rotate-180" : "rotate-0",
      )}
    >
      ▾
    </span>
  ) : null;

  const iconColorClass = isAction
    ? isStreaming
      ? "text-accent"
      : item.isError
        ? "text-danger"
        : "text-text/60"
    : "text-muted";

  return (
    <div className="pb-4">
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => !isStreaming && setOpen((v) => !v)}
          disabled={isStreaming}
          className="flex max-w-full flex-col gap-0.5 rounded-md py-0.5 pr-2 text-left"
        >
          {/* Header row: icon + name + chevron + status */}
          <div className="flex items-center gap-2 leading-none">
            <span
              className={cn(
                "inline-flex h-4 w-4 shrink-0 items-center justify-center font-mono text-sm leading-none",
                iconColorClass,
              )}
            >
              {icon}
            </span>
            <span className="text-sm font-medium leading-none text-muted">{headerTitle}</span>
            {durationLabel ? <span className="text-xs leading-none text-text/35">{durationLabel}</span> : null}
            {chevronEl}
            {statusEl}
          </div>
          {/* Summary rows */}
          {inputSummary || outputSummary ? (
            <div className="ml-6 flex flex-col gap-0.5">
              {inputSummary ? (
                <span className="max-w-[64ch] truncate font-mono text-xs text-text/50">{inputSummary}</span>
              ) : null}
              {outputSummary ? (
                <span className="max-w-[64ch] truncate font-mono text-xs text-accent/70">↳ {outputSummary}</span>
              ) : null}
            </div>
          ) : null}
        </button>

        {open && (
          <div className="pt-2 pb-3">
            <ToolContent item={item} render={renderPayload} />
          </div>
        )}
      </div>
    </div>
  );
}
