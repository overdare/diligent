// @summary Message stream renderer for user, assistant (markdown), and thinking (collapsible) blocks

import type { RenderItem } from "../lib/thread-store";
import { MarkdownContent } from "./MarkdownContent";

interface StreamBlockProps {
  item: Extract<RenderItem, { kind: "user" | "assistant" }>;
}

export function StreamBlock({ item }: StreamBlockProps) {
  const isUser = item.kind === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm border border-accent/30 bg-accent/20 px-4 py-2.5">
          <p className="text-sm leading-6 text-text">{item.text}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[88%]">
        {item.thinking ? (
          <details className="mb-2 rounded border border-text/10 bg-bg/60">
            <summary className="cursor-pointer select-none px-2 py-1 font-mono text-xs text-muted hover:text-text">
              Thinking
            </summary>
            <pre className="overflow-x-auto whitespace-pre-wrap px-2 pb-2 font-mono text-xs text-muted">
              {item.thinking}
            </pre>
          </details>
        ) : null}
        <MarkdownContent text={item.text} />
      </div>
    </div>
  );
}
