// @summary Sidebar with thread list, new thread button, and relative timestamps

import type { SessionSummary } from "@diligent/protocol";
import { formatRelativeTime } from "../lib/format-time";
import { Panel } from "./Panel";

interface SidebarProps {
  cwd: string;
  threadList: SessionSummary[];
  activeThreadId: string | null;
  onNewThread: () => void;
  onOpenThread: (threadId: string) => void;
}

export function Sidebar({ cwd, threadList, activeThreadId, onNewThread, onOpenThread }: SidebarProps) {
  return (
    <Panel className="flex min-h-0 flex-col overflow-hidden">
      <div className="border-b border-text/10 px-4 py-3">
        <h1 className="font-mono text-sm font-semibold text-accent">Diligent</h1>
        <p className="mt-1 truncate text-xs text-muted">{cwd || "-"}</p>
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
        <button
          type="button"
          onClick={onNewThread}
          className="w-full rounded-md border border-text/10 bg-bg/60 px-3 py-2 text-left text-sm text-text transition hover:border-accent/40"
        >
          + New conversation
        </button>

        {threadList.map((thread) => {
          const isActive = activeThreadId === thread.id;
          const title = thread.firstUserMessage || thread.name || "New conversation";
          const meta = `${formatRelativeTime(thread.modified)} · ${thread.messageCount} msg`;

          return (
            <button
              key={thread.id}
              type="button"
              onClick={() => onOpenThread(thread.id)}
              className={`w-full rounded-md border px-3 py-2 text-left transition ${
                isActive ? "border-accent/40 bg-accent/10" : "border-text/10 bg-bg/50 hover:border-text/30"
              }`}
            >
              <div className="truncate text-sm text-text">{title}</div>
              <div className="mt-0.5 text-[11px] text-muted">{meta}</div>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
