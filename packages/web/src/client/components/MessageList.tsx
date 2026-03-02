// @summary Scrollable message list with empty state, tool rows, stream blocks, streaming indicator, and inline prompts

import type { ApprovalRequest, ThreadStatus, UserInputRequest } from "@diligent/protocol";
import type { RenderItem } from "../lib/thread-store";
import { ApprovalCard } from "./ApprovalCard";
import { EmptyState } from "./EmptyState";
import { QuestionCard } from "./QuestionCard";
import { StreamBlock } from "./StreamBlock";
import { StreamingIndicator } from "./StreamingIndicator";
import { ToolCallRow } from "./ToolCallRow";

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
  const hasPrompt = approvalPrompt || questionPrompt;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      {items.length === 0 && !hasPrompt ? (
        <EmptyState onSelectPrompt={onSelectPrompt} />
      ) : (
        <div className="space-y-3">
          {items.map((item) =>
            item.kind === "tool" ? (
              <ToolCallRow key={item.id + item.timestamp} item={item} />
            ) : (
              <StreamBlock key={item.id + item.timestamp} item={item} />
            ),
          )}
          {threadStatus === "busy" ? <StreamingIndicator /> : null}
          {approvalPrompt ? <ApprovalCard request={approvalPrompt.request} onDecide={approvalPrompt.onDecide} /> : null}
          {questionPrompt ? (
            <QuestionCard
              request={questionPrompt.request}
              answers={questionPrompt.answers}
              onAnswerChange={questionPrompt.onAnswerChange}
              onSubmit={questionPrompt.onSubmit}
              onCancel={questionPrompt.onCancel}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
