// @summary Scrollable message feed with auto-scroll, scroll-to-bottom button, and inline prompts

import type { ApprovalRequest, ThreadStatus, UserInputRequest } from "@diligent/protocol";
import { useEffect, useRef, useState } from "react";
import type { RenderItem } from "../lib/thread-store";
import { ApprovalCard } from "./ApprovalCard";
import { AssistantMessage } from "./AssistantMessage";
import { CollabGroup } from "./CollabGroup";
import { ContextMessage } from "./ContextMessage";
import { EmptyState } from "./EmptyState";
import { QuestionCard } from "./QuestionCard";
import { ScrollToBottom } from "./ScrollToBottom";
import { StreamingIndicator } from "./StreamingIndicator";
import { ToolBlock } from "./ToolBlock";
import { UserMessage } from "./UserMessage";

function ErrorMessage({ item }: { item: Extract<RenderItem, { kind: "error" }> }) {
  return (
    <div className="py-1">
      <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
        <div className="font-medium">{item.name ? `${item.name}: ${item.message}` : item.message}</div>
        {item.turnId ? <div className="mt-1 text-xs text-red-200/80">Turn: {item.turnId}</div> : null}
      </div>
    </div>
  );
}

interface MessageListProps {
  items: RenderItem[];
  threadStatus: ThreadStatus;
  onSelectPrompt: (prompt: string) => void;
  approvalPrompt?: { request: ApprovalRequest; onDecide: (decision: "once" | "always" | "reject") => void } | null;
  questionPrompt?: {
    request: UserInputRequest;
    answers: Record<string, string | string[]>;
    onAnswerChange: (id: string, value: string | string[]) => void;
    onSubmit: () => void;
    onCancel: () => void;
  } | null;
}

type CollabItem = Extract<RenderItem, { kind: "collab" }>;

/** Group consecutive collab items, render everything else individually. */
function renderGroupedItems(items: RenderItem[]): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  let collabBuf: CollabItem[] = [];

  const flushCollab = () => {
    if (collabBuf.length === 0) return;
    const groupKey = collabBuf.map((c) => c.id).join("+");
    result.push(<CollabGroup key={groupKey} items={[...collabBuf]} />);
    collabBuf = [];
  };

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    if (item.kind === "collab") {
      collabBuf.push(item);
      continue;
    }
    flushCollab();
    if (item.kind === "context") {
      result.push(<ContextMessage key={item.id} summary={item.summary} />);
    } else if (item.kind === "error") {
      result.push(<ErrorMessage key={item.id} item={item} />);
    } else if (item.kind === "tool") {
      result.push(<ToolBlock key={item.id} item={item} />);
    } else if (item.kind === "user") {
      result.push(<UserMessage key={item.id} text={item.text} images={item.images} />);
    } else if (item.kind === "assistant") {
      const assistantItem = item as Extract<RenderItem, { kind: "assistant" }>;
      const nextItem = items[idx + 1];
      const isFollowedByUserInputTool = nextItem?.kind === "tool" && nextItem.toolName === "request_user_input";
      const displayItem = isFollowedByUserInputTool ? { ...assistantItem, text: "" } : assistantItem;
      result.push(<AssistantMessage key={item.id} item={displayItem} />);
    }
  }
  flushCollab();
  return result;
}

export function MessageList({ items, threadStatus, onSelectPrompt, approvalPrompt, questionPrompt }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const isAtBottomRef = useRef(true);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    isAtBottomRef.current = nearBottom;
    setShowScrollBtn(!nearBottom);
  };

  // Auto-scroll when new items arrive (only if already near bottom)
  // biome-ignore lint/correctness/useExhaustiveDependencies: items.length and threadStatus are intentional triggers
  useEffect(() => {
    if (isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [items.length, threadStatus]);

  // Watch for content height changes (e.g. plan updates) and auto-scroll / re-evaluate button visibility
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;
      if (isAtBottomRef.current) {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
        setShowScrollBtn(false);
      } else {
        setShowScrollBtn(!nearBottom);
      }
    });
    // Observe the scrollable container's inner content
    const inner = container.firstElementChild;
    if (inner) observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  const hasPrompt = approvalPrompt || questionPrompt;

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={containerRef} onScroll={handleScroll} className="h-full overflow-y-auto px-6 py-4">
        {items.length === 0 && !hasPrompt ? (
          <EmptyState onSelectPrompt={onSelectPrompt} />
        ) : (
          <div className="space-y-1">
            {renderGroupedItems(items)}

            {threadStatus === "busy" && !approvalPrompt && !questionPrompt ? (
              <div className="py-1">
                <div className="flex items-center pt-1">
                  <StreamingIndicator />
                </div>
              </div>
            ) : null}

            {approvalPrompt ? (
              <div className="py-1">
                <ApprovalCard request={approvalPrompt.request} onDecide={approvalPrompt.onDecide} />
              </div>
            ) : null}

            {questionPrompt ? (
              <div className="py-1">
                <QuestionCard
                  request={questionPrompt.request}
                  answers={questionPrompt.answers}
                  onAnswerChange={questionPrompt.onAnswerChange}
                  onSubmit={questionPrompt.onSubmit}
                  onCancel={questionPrompt.onCancel}
                />
              </div>
            ) : null}

            <div ref={bottomRef} className="h-px" />
          </div>
        )}
      </div>

      {showScrollBtn && <ScrollToBottom onClick={scrollToBottom} />}
    </div>
  );
}
