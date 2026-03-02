// @summary Compact tool call row with one-line summary and click-to-expand detail panel

import { useState } from "react";
import { cn } from "../lib/cn";
import type { RenderItem } from "../lib/thread-store";
import { getToolHeaderTitle, getToolInfo, summarizeInput } from "../lib/tool-info";
import { SectionLabel } from "./SectionLabel";
import { StatusDot } from "./StatusDot";

interface ToolCallRowProps {
  item: Extract<RenderItem, { kind: "tool" }>;
}

export function ToolCallRow({ item }: ToolCallRowProps) {
  const [open, setOpen] = useState(false);
  const { icon } = getToolInfo(item.toolName);
  const headerTitle = getToolHeaderTitle(item.toolName, item.inputText, item.outputText);
  const summary = item.inputText ? summarizeInput(item.toolName, item.inputText) : "";
  const summaryText = item.toolName.toLowerCase() === "request_user_input" ? "" : summary;

  const statusEl = item.isError ? (
    <span className="shrink-0 text-xs text-danger">error</span>
  ) : item.status === "streaming" ? (
    <span className="flex shrink-0 items-center gap-1 text-xs text-accent">
      <StatusDot color="accent" pulse />
    </span>
  ) : null;

  const chevronEl =
    item.status !== "streaming" && !item.isError ? (
      <span
        className={cn(
          "shrink-0 text-sm leading-none text-muted transition-transform",
          open ? "rotate-180" : "rotate-0",
        )}
      >
        ▾
      </span>
    ) : null;

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-tool-row rounded-lg border border-text/10 bg-bg/40">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex max-w-full items-center gap-1.5 px-3 py-2 text-left"
          disabled={item.status === "streaming"}
        >
          <span className="shrink-0 font-mono text-sm text-muted">{icon}</span>
          <span className="text-xs font-semibold text-muted">{headerTitle}</span>
          {chevronEl}
          {summaryText ? (
            <span className="max-w-[56ch] truncate font-mono text-xs text-text/60">{summaryText}</span>
          ) : null}
          {statusEl}
        </button>

        {open ? (
          <div className="border-t border-text/10 px-3 pb-3 pt-2">
            {item.inputText ? (
              <div className="mb-2">
                <SectionLabel>Input</SectionLabel>
                <pre className="overflow-x-auto whitespace-pre-wrap rounded border border-text/10 bg-surface/50 p-2 font-mono text-xs text-muted">
                  {item.inputText}
                </pre>
              </div>
            ) : null}
            {item.outputText ? (
              <div>
                <SectionLabel>Output</SectionLabel>
                <pre className="overflow-x-auto whitespace-pre-wrap rounded border border-text/10 bg-surface/50 p-2 font-mono text-xs text-text">
                  {item.outputText}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
