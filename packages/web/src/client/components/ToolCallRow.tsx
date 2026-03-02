// @summary Tool call renderer showing input, streaming output, and completion/error state

import { cn } from "../lib/cn";
import type { RenderItem } from "../lib/thread-store";

interface ToolCallRowProps {
  item: Extract<RenderItem, { kind: "tool" }>;
}

export function ToolCallRow({ item }: ToolCallRowProps) {
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[94%] rounded-lg border border-text/15 bg-bg/50 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">tool: {item.toolName}</span>
          <span
            className={cn(
              "text-xs font-semibold uppercase",
              item.isError ? "text-danger" : item.status === "done" ? "text-success" : "text-accent",
            )}
          >
            {item.isError ? "error" : item.status}
          </span>
        </div>

        {item.inputText ? (
          <pre className="mb-2 overflow-x-auto whitespace-pre-wrap rounded border border-text/10 bg-surface/50 p-2 font-mono text-xs text-muted">
            {item.inputText}
          </pre>
        ) : null}

        <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-sm leading-6 text-text">
          {item.outputText}
        </pre>
      </div>
    </div>
  );
}
