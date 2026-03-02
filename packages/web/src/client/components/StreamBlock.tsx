// @summary Message stream renderer for user, assistant (markdown), and thinking (collapsible) blocks

import { cn } from "../lib/cn";
import type { RenderItem } from "../lib/thread-store";
import { MarkdownContent } from "./MarkdownContent";

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
          <details className="mb-2 rounded border border-text/10 bg-bg/60">
            <summary className="cursor-pointer select-none px-2 py-1 font-mono text-xs text-muted hover:text-text">
              Thinking
            </summary>
            <pre className="overflow-x-auto whitespace-pre-wrap px-2 pb-2 font-mono text-xs text-muted">
              {item.thinking}
            </pre>
          </details>
        ) : null}

        {isUser ? (
          <p className="text-sm leading-6 text-text">{item.text}</p>
        ) : (
          <MarkdownContent text={item.text} />
        )}
      </div>
    </div>
  );
}
