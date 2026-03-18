// @summary Sidebar with thread list, new thread button, and relative timestamps

import type { SessionSummary } from "@diligent/protocol";
import { memo } from "react";
import { APP_PROJECT_MARK } from "../lib/app-config";
import { formatRelativeTime } from "../lib/format-time";
import { Panel } from "./Panel";

interface SidebarProps {
  cwd: string;
  threadList: SessionSummary[];
  activeThreadId: string | null;
  attentionThreadIds?: Set<string>;
  onNewThread: () => void;
  onOpenThread: (threadId: string) => void;
  onDeleteThread?: (threadId: string) => void;
  onOpenTools?: () => void;
  onOpenKnowledge?: () => void;
}

function SidebarImpl({
  cwd,
  threadList,
  activeThreadId,
  attentionThreadIds,
  onNewThread,
  onOpenThread,
  onDeleteThread,
  onOpenTools,
  onOpenKnowledge,
}: SidebarProps) {
  const cwdShort = cwd ? cwd.replace(/\\/g, "/").split("/").slice(-2).join("/") : "-";

  return (
    <Panel className="flex min-h-0 flex-col overflow-hidden border-border/100 bg-surface-default">
      {/* Header */}
      <div className="relative border-b border-border/100 bg-surface-dark px-5 py-4">
        <div className="pr-24">
          <span className="font-mono text-[13px] font-bold uppercase tracking-[0.12em] text-[#FE0041]">
            {APP_PROJECT_MARK}
          </span>
          <p className="mt-1 truncate font-mono text-xs- text-muted/90" title={cwd}>
            {cwdShort}
          </p>
        </div>
        <div className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {onOpenKnowledge ? (
            <button
              type="button"
              onClick={onOpenKnowledge}
              aria-label="Open knowledge"
              title="Knowledge"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-knowledge-backlog/35 bg-knowledge-backlog/12 text-sm text-knowledge-backlog/90 transition hover:border-knowledge-backlog/55 hover:bg-knowledge-backlog/18 hover:text-knowledge-backlog"
            >
              <span className="block leading-none">✦</span>
            </button>
          ) : null}
          {onOpenTools ? (
            <button
              type="button"
              onClick={onOpenTools}
              aria-label="Open config"
              title="Config"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/100 bg-surface-light text-sm text-muted transition hover:border-border-strong/100 hover:bg-surface-strong hover:text-text"
            >
              <span className="block leading-none">⚙</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* Thread list */}
      <div className="flex-1 space-y-2 overflow-y-auto bg-bg-sunken px-3 py-3">
        <button
          type="button"
          onClick={onNewThread}
          className="flex w-full items-center gap-2 rounded-lg border border-border/100 bg-surface-light px-3.5 py-3 text-left text-sm font-medium text-text transition hover:border-selection/50 hover:text-selection"
        >
          <span className="text-lg leading-none">+</span>
          <span>New conversation</span>
        </button>

        {threadList.map((thread) => {
          const isActive = activeThreadId === thread.id;
          const needsAttention = !isActive && (attentionThreadIds?.has(thread.id) ?? false);
          const title = thread.firstUserMessage || thread.name || "New conversation";
          const time = formatRelativeTime(thread.modified);

          return (
            <div key={thread.id} className="group relative">
              <button
                type="button"
                onClick={() => onOpenThread(thread.id)}
                className={`w-full rounded-xl px-3.5 py-3 text-left transition ${
                  isActive
                    ? "bg-surface-light text-text"
                    : needsAttention
                      ? "bg-bg-sunken hover:bg-surface-light"
                      : "bg-bg-sunken hover:bg-surface-light"
                }`}
              >
                <div className="flex items-center gap-2 pr-5">
                  {needsAttention ? (
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-attention" title="Needs attention" />
                  ) : null}
                  <span className="truncate text-sm leading-snug text-text">{title}</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-xs- text-muted/85">
                  <span>{time}</span>
                  <span className="opacity-40">·</span>
                  <span>{thread.messageCount} msg</span>
                </div>
              </button>
              {onDeleteThread ? (
                <button
                  type="button"
                  aria-label="Delete conversation"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteThread(thread.id);
                  }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted opacity-0 transition hover:text-danger group-hover:opacity-100"
                >
                  ×
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

export const Sidebar = memo(SidebarImpl);
