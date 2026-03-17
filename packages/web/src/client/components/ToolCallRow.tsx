// @summary Compact tool call row with one-line summary and click-to-expand detail panel

import { useState } from "react";
import { cn } from "../lib/cn";
import type { RenderItem } from "../lib/thread-store";
import { getToolHeaderTitle, summarizeInput, summarizeOutput } from "../lib/tool-info";
import { SectionLabel } from "./SectionLabel";
import { StatusDot } from "./StatusDot";

interface ToolCallRowProps {
  item: Extract<RenderItem, { kind: "tool" }>;
}

export function ToolCallRow({ item }: ToolCallRowProps) {
  const [open, setOpen] = useState(false);
  const renderPayload = item.render;
  const headerTitle = getToolHeaderTitle(item.toolName, renderPayload);
  const isUserInput = item.toolName.toLowerCase() === "request_user_input";
  const outputSummary =
    renderPayload && !isUserInput && item.status === "done" && !item.isError ? summarizeOutput(renderPayload) : "";
  const showOutputSummary = Boolean(outputSummary) && outputSummary !== summarizeInput(renderPayload);

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
      <div className="w-full max-w-tool-row rounded-lg bg-surface-dark">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex max-w-full flex-col gap-0.5 text-left"
          disabled={item.status === "streaming"}
        >
          {/* Header row */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-muted">{headerTitle}</span>
            {chevronEl}
            {statusEl}
          </div>
          {/* Summary rows */}
          {showOutputSummary ? (
            <div className="flex flex-col gap-0.5">
              <span className="max-w-[64ch] truncate font-mono text-xs text-text-tertiary">↳ {outputSummary}</span>
            </div>
          ) : null}
        </button>

        {open ? (
          <div>
            {item.inputText ? (
              <div className="mb-2">
                <SectionLabel>Input</SectionLabel>
                <pre className="overflow-x-auto whitespace-pre-wrap rounded border border-border/10 bg-surface/50 p-2 font-mono text-xs text-muted">
                  {item.inputText}
                </pre>
              </div>
            ) : null}
            {item.outputText ? (
              <div>
                <SectionLabel>Output</SectionLabel>
                <pre className="overflow-x-auto whitespace-pre-wrap rounded border border-border/10 bg-surface/50 p-2 font-mono text-xs text-text">
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
