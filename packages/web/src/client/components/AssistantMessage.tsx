// @summary Assistant message with left decoration bar, agent icon, thinking block, and markdown content

import type { RenderItem } from "../lib/thread-store";
import { MarkdownContent } from "./MarkdownContent";
import { ThinkingBlock } from "./ThinkingBlock";

function formatMs(ms?: number): string | null {
  if (ms === undefined || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(/\.0$/, "")}s`;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

interface AssistantMessageProps {
  item: Extract<RenderItem, { kind: "assistant" }>;
}

export function AssistantMessage({ item }: AssistantMessageProps) {
  const hasThinking = item.thinking.length > 0;
  const hasText = item.text.length > 0;
  const turnDuration = formatMs(item.turnDurationMs);
  const reasoningDuration = formatMs(item.reasoningDurationMs);

  if (!hasThinking && !hasText) return null;

  return (
    <div>
      {hasThinking && (
        <div className="pb-4">
          <ThinkingBlock text={item.thinking} streaming={!item.thinkingDone} />
        </div>
      )}
      {hasText && (
        <div className="pb-8">
          <MarkdownContent text={item.text} />
        </div>
      )}
      {(turnDuration || reasoningDuration) && (
        <div className="pb-6 pt-1 text-xs text-muted">
          {turnDuration ? `Loop: ${turnDuration}` : null}
          {turnDuration && reasoningDuration ? " · " : null}
          {reasoningDuration ? `Thinking: ${reasoningDuration}` : null}
        </div>
      )}
    </div>
  );
}
