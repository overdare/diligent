// @summary Assistant message with left decoration bar, agent icon, thinking block, and markdown content

import type { RenderItem } from "../lib/thread-store";
import { MarkdownContent } from "./MarkdownContent";
import { ThinkingBlock } from "./ThinkingBlock";

interface AssistantMessageProps {
  item: Extract<RenderItem, { kind: "assistant" }>;
}

export function AssistantMessage({ item }: AssistantMessageProps) {
  const hasThinking = item.thinking.length > 0;
  const hasText = item.text.length > 0;

  if (!hasThinking && !hasText) return null;

  return (
    <div className="py-1">
      <div className="min-w-0 pb-2">
        {hasThinking && <ThinkingBlock text={item.thinking} />}
        {hasText && <MarkdownContent text={item.text} />}
      </div>
    </div>
  );
}
