// @summary Message stream renderer for user, assistant, and system timeline blocks

import { cn } from "../lib/cn";
import type { RenderItem } from "../lib/thread-store";

interface StreamBlockProps {
  item: Extract<RenderItem, { kind: "user" | "assistant" }>;
}

export function StreamBlock({ item }: StreamBlockProps) {
  const isUser = item.kind === "user";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[88%] rounded-lg border px-3 py-2",
          isUser ? "border-accent/40 bg-accent/10" : "border-text/15 bg-surface/60",
        )}
      >
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{item.kind}</div>
        {item.kind === "assistant" && item.thinking ? (
          <pre className="mb-2 overflow-x-auto whitespace-pre-wrap rounded border border-text/10 bg-bg/60 p-2 font-mono text-xs text-muted">
            {item.thinking}
          </pre>
        ) : null}
        <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-sm leading-6 text-text">{item.text}</pre>
      </div>
    </div>
  );
}
