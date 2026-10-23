// @summary Renders colocated MessageList virtual row descriptors into concrete row UI

import type { ErrorRecovery, ThreadReadResponse } from "@diligent/protocol";
import { memo } from "react";
import type { RenderItem } from "../../lib/thread-store";
import { ApprovalCard } from "../ApprovalCard";
import { AssistantMessage } from "../AssistantMessage";
import { CollabGroup } from "../CollabGroup";
import { CompactingIndicator } from "../CompactingIndicator";
import { ContextMessage } from "../ContextMessage";
import { ErrorMessage } from "../ErrorMessage";
import { AgentLogo } from "../icons";
import { QuestionCard } from "../QuestionCard";
import { StreamingIndicator } from "../StreamingIndicator";
import { StudioChangesNotice } from "../StudioChangesNotice";
import { ToolActivityGroup } from "../ToolActivityGroup";
import { ToolBlock } from "../ToolBlock";
import { UserMessage } from "../UserMessage";
import type { VirtualMessageRow } from "./types";

interface MessageListRowContentProps {
  row: VirtualMessageRow;
  threadCwd?: string;
  onLoadChildThread?: (childThreadId: string) => Promise<ThreadReadResponse>;
  onReportMessage?: (item: Extract<RenderItem, { kind: "user" | "assistant" }>) => void;
  lastCompletedResponseId?: string;
  actionableErrorId?: string;
  onErrorRecovery?: (recovery: ErrorRecovery) => void;
}

/** Rows are rebuilt on every transcript change; a row only renders again when its own items change. */
function sameRowContent(a: VirtualMessageRow, b: VirtualMessageRow): boolean {
  if (a.kind !== b.kind || a.key !== b.key) return false;
  switch (a.kind) {
    case "message": {
      const other = b as typeof a;
      return a.item === other.item && a.suppressThinking === other.suppressThinking;
    }
    case "toolGroup":
    case "collab": {
      const other = b as typeof a;
      return a.items.length === other.items.length && a.items.every((item, index) => item === other.items[index]);
    }
    case "approval":
    case "question":
      return a.prompt === (b as typeof a).prompt;
    default:
      return true;
  }
}

function samePropsForRow(prev: MessageListRowContentProps, next: MessageListRowContentProps): boolean {
  if (!sameRowContent(prev.row, next.row)) return false;
  // Response and error ids only change what the row they name renders.
  if (prev.row.kind === "message") {
    const id = prev.row.item.id;
    if ((prev.lastCompletedResponseId === id) !== (next.lastCompletedResponseId === id)) return false;
    if ((prev.actionableErrorId === id) !== (next.actionableErrorId === id)) return false;
  }
  return (
    prev.threadCwd === next.threadCwd &&
    prev.onLoadChildThread === next.onLoadChildThread &&
    prev.onReportMessage === next.onReportMessage &&
    prev.onErrorRecovery === next.onErrorRecovery
  );
}

export const MessageListRowContent = memo(MessageListRowContentImpl, samePropsForRow);

function MessageListRowContentImpl({
  row,
  threadCwd,
  onLoadChildThread,
  onReportMessage,
  lastCompletedResponseId,
  actionableErrorId,
  onErrorRecovery,
}: MessageListRowContentProps) {
  switch (row.kind) {
    case "collab":
      return <CollabGroup items={row.items} loadChildThread={onLoadChildThread} />;
    case "toolGroup":
      return <ToolActivityGroup items={row.items} />;
    case "message":
      switch (row.item.kind) {
        case "context":
          return row.item.variant === "studio-changes" || row.item.variant === "human-edits" ? (
            <StudioChangesNotice summary={row.item.summary} />
          ) : (
            <ContextMessage summary={row.item.summary} label={row.item.title} />
          );
        case "error":
          return (
            <ErrorMessage
              item={row.item}
              onRecovery={row.item.id === actionableErrorId ? onErrorRecovery : undefined}
            />
          );
        case "tool":
          return <ToolBlock item={row.item} threadCwd={threadCwd} />;
        case "user":
          return <UserMessage item={row.item} onReport={onReportMessage} />;
        case "assistant":
          return (
            <AssistantMessage
              item={row.item}
              suppressThinking={row.suppressThinking ?? false}
              onReport={onReportMessage}
              alwaysShowActions={row.item.id === lastCompletedResponseId}
            />
          );
      }
      break;
    case "streaming":
      return (
        <div className="py-1">
          <div className="flex items-center pt-1">
            <StreamingIndicator />
          </div>
        </div>
      );
    case "responseComplete":
      return (
        <div className="py-1">
          <div className="flex items-center pt-1" role="img" aria-label="Response complete">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center p-1">
              <AgentLogo className="h-6 w-6 text-[#DCE2E8]" aria-hidden="true" />
            </div>
          </div>
        </div>
      );
    case "compacting":
      return (
        <div className="py-1">
          <div className="flex items-center pt-1">
            <CompactingIndicator />
          </div>
        </div>
      );
    case "approval":
      return (
        <div className="py-1">
          <ApprovalCard request={row.prompt.request} onDecide={row.prompt.onDecide} />
        </div>
      );
    case "question":
      return (
        <div className="py-1">
          <QuestionCard
            request={row.prompt.request}
            answers={row.prompt.answers}
            onAnswerChange={row.prompt.onAnswerChange}
            onSubmit={row.prompt.onSubmit}
            onCancel={row.prompt.onCancel}
          />
        </div>
      );
    case "bottom":
      return <div className="h-px" />;
  }
}
