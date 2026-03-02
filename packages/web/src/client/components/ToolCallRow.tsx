// @summary Compact tool call row with one-line summary and click-to-expand detail panel

import { useState } from "react";
import { cn } from "../lib/cn";
import type { RenderItem } from "../lib/thread-store";
import { getToolInfo, summarizeInput } from "../lib/tool-info";

interface ToolCallRowProps {
  item: Extract<RenderItem, { kind: "tool" }>;
}

export function ToolCallRow({ item }: ToolCallRowProps) {
  const [open, setOpen] = useState(false);
  const { icon, displayName } = getToolInfo(item.toolName);
  const summary = item.inputText ? summarizeInput(item.toolName, item.inputText) : "";

  const statusEl = item.isError ? (
    <span className="ml-auto shrink-0 text-xs text-danger">error</span>
  ) : item.status === "streaming" ? (
    <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-accent">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
    </span>
  ) : (
    <span className={cn("ml-auto shrink-0 text-xs text-muted transition-transform", open ? "rotate-180" : "rotate-0")}>
      ▾
    </span>
  );

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[94%] rounded-lg border border-text/10 bg-bg/40">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left"
          disabled={item.status === "streaming"}
        >
          <span className="shrink-0 font-mono text-[13px] text-muted">{icon}</span>
          <span className="text-xs font-semibold text-muted">{displayName}</span>
          {summary ? <span className="min-w-0 flex-1 truncate font-mono text-xs text-text/60">{summary}</span> : null}
          {statusEl}
        </button>

        {open ? (
          <div className="border-t border-text/10 px-3 pb-3 pt-2">
            {item.inputText ? (
              <div className="mb-2">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Input</div>
                <pre className="overflow-x-auto whitespace-pre-wrap rounded border border-text/10 bg-surface/50 p-2 font-mono text-xs text-muted">
                  {item.inputText}
                </pre>
              </div>
            ) : null}
            {item.outputText ? (
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Output</div>
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
