// @summary Scrollable message feed with auto-scroll, scroll-to-bottom button, and inline prompts

import type { ApprovalRequest, ThreadStatus, UserInputRequest } from "@diligent/protocol";
import { useEffect, useRef, useState } from "react";
import type { RenderItem } from "../lib/thread-store";
import { ApprovalCard } from "./ApprovalCard";
import { AssistantMessage } from "./AssistantMessage";
import { EmptyState } from "./EmptyState";
import { QuestionCard } from "./QuestionCard";
import { ScrollToBottom } from "./ScrollToBottom";
import { StreamingIndicator } from "./StreamingIndicator";
import { ToolBlock } from "./ToolBlock";
import { UserMessage } from "./UserMessage";

interface MessageListProps {
  items: RenderItem[];
  threadStatus: ThreadStatus;
  onSelectPrompt: (prompt: string) => void;
  approvalPrompt?: { request: ApprovalRequest; onDecide: (decision: "once" | "always" | "reject") => void } | null;
  questionPrompt?: {
    request: UserInputRequest;
    answers: Record<string, string>;
    onAnswerChange: (id: string, value: string) => void;
    onSubmit: () => void;
    onCancel: () => void;
  } | null;
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

  const hasPrompt = approvalPrompt || questionPrompt;

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={containerRef} onScroll={handleScroll} className="h-full overflow-y-auto px-6 py-4">
        {items.length === 0 && !hasPrompt ? (
          <EmptyState onSelectPrompt={onSelectPrompt} />
        ) : (
          <div className="space-y-1">
            {items.map((item, idx) => {
              if (item.kind === "tool") return <ToolBlock key={item.id} item={item} />;
              if (item.kind === "user") return <UserMessage key={item.id} text={item.text} />;
              const nextItem = items[idx + 1];
              const isFollowedByUserInputTool =
                nextItem?.kind === "tool" && nextItem.toolName === "request_user_input";
              const displayItem = isFollowedByUserInputTool ? { ...item, text: "" } : item;
              return <AssistantMessage key={item.id} item={displayItem} />;
            })}

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
