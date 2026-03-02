// @summary Tool call block with icon, summary header, and tool-type-specific expandable content

import { useState } from "react";
import { cn } from "../lib/cn";
import type { RenderItem } from "../lib/thread-store";
import { getToolHeaderTitle, getToolInfo, summarizeInput } from "../lib/tool-info";
import { ContentBash } from "./ContentBash";
import { ContentText } from "./ContentText";
import { SectionLabel } from "./SectionLabel";
import { StatusDot } from "./StatusDot";

interface ToolBlockProps {
  item: Extract<RenderItem, { kind: "tool" }>;
}

function parseBashCommand(inputText: string): string | undefined {
  try {
    const parsed = JSON.parse(inputText) as Record<string, unknown>;
    return typeof parsed.command === "string" ? parsed.command : undefined;
  } catch {
    return undefined;
  }
}

export function ToolBlock({ item }: ToolBlockProps) {
  const [open, setOpen] = useState(false);
  const { icon, category } = getToolInfo(item.toolName);
  const headerTitle = getToolHeaderTitle(item.toolName, item.inputText, item.outputText);
  const summary = item.inputText ? summarizeInput(item.toolName, item.inputText) : "";
  const summaryText = item.toolName.toLowerCase() === "request_user_input" ? "" : summary;

  const isStreaming = item.status === "streaming";
  const isBash = item.toolName.toLowerCase() === "bash";
  const isAction = category === "action";

  const statusEl = isStreaming ? (
    <span className="flex shrink-0 items-center gap-1 text-xs text-accent">
      <StatusDot color="accent" pulse />
      <span>running</span>
    </span>
  ) : item.isError ? (
    <span className="shrink-0 text-xs text-danger">error</span>
  ) : null;

  const chevronEl =
    !isStreaming && !item.isError ? (
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
    <div className="py-1">
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => !isStreaming && setOpen((v) => !v)}
          disabled={isStreaming}
          className="inline-flex max-w-full items-center gap-2 rounded-md py-0.5 pr-2 text-left leading-none"
        >
          <span
            className={cn(
              "inline-flex h-4 w-4 shrink-0 items-center justify-center font-mono text-sm leading-none",
              iconColorClass,
            )}
          >
            {icon}
          </span>
          <span className="text-sm font-medium leading-none text-muted">{headerTitle}</span>
          {chevronEl}
          {summaryText ? (
            <span className="max-w-[56ch] truncate font-mono text-sm leading-none text-text/60">{summaryText}</span>
          ) : null}
          {statusEl}
        </button>

        {open && (
          <div className="pb-3">
            {isBash ? (
              <ContentBash
                command={parseBashCommand(item.inputText)}
                output={item.outputText || undefined}
                isError={item.isError}
              />
            ) : (
              <div className="space-y-2">
                {item.inputText && (
                  <div>
                    <SectionLabel>Input</SectionLabel>
                    <ContentText text={item.inputText} compact />
                  </div>
                )}
                {item.outputText && (
                  <div>
                    <SectionLabel>Output</SectionLabel>
                    <ContentText text={item.outputText} compact isError={item.isError} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
