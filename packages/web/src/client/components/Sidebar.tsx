// @summary Sidebar with thread list, new thread button, and relative timestamps

import type { SessionSummary } from "@diligent/protocol";
import type { ProviderAuthStatus } from "../../shared/ws-protocol";
import { formatRelativeTime } from "../lib/format-time";
import { Panel } from "./Panel";
import { StatusDot } from "./StatusDot";

interface SidebarProps {
  cwd: string;
  threadList: SessionSummary[];
  activeThreadId: string | null;
  onNewThread: () => void;
  onOpenThread: (threadId: string) => void;
  providers?: ProviderAuthStatus[];
  onOpenProviders?: () => void;
}

export function Sidebar({ cwd, threadList, activeThreadId, onNewThread, onOpenThread, providers, onOpenProviders }: SidebarProps) {
  const cwdShort = cwd ? cwd.split("/").slice(-2).join("/") : "-";

  return (
    <Panel className="flex min-h-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-text/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold text-accent">diligent</span>
        </div>
        <p className="mt-1 truncate font-mono text-xs- text-muted" title={cwd}>
          {cwdShort}
        </p>
      </div>

      {/* Thread list */}
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        <button
          type="button"
          onClick={onNewThread}
          className="flex w-full items-center gap-2 rounded-md border border-dashed border-text/15 px-3 py-2 text-left text-sm text-muted transition hover:border-accent/40 hover:text-accent"
        >
          <span className="text-base leading-none">+</span>
          <span>New conversation</span>
        </button>

        {threadList.map((thread) => {
          const isActive = activeThreadId === thread.id;
          const title = thread.firstUserMessage || thread.name || "New conversation";
          const time = formatRelativeTime(thread.modified);

          return (
            <button
              key={thread.id}
              type="button"
              onClick={() => onOpenThread(thread.id)}
              className={`group w-full rounded-md border px-3 py-2 text-left transition ${
                isActive
                  ? "border-accent/30 bg-accent/5 text-text"
                  : "border-transparent hover:border-text/15 hover:bg-surface/50"
              }`}
            >
              <div className="truncate text-sm leading-snug text-text">{title}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs- text-muted">
                <span>{time}</span>
                <span className="opacity-40">·</span>
                <span>{thread.messageCount} msg</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Provider status footer */}
      {providers && onOpenProviders ? (
        <button
          type="button"
          onClick={onOpenProviders}
          className="flex items-center gap-2 border-t border-text/10 px-4 py-2.5 text-left transition hover:bg-surface/50"
        >
          <div className="flex items-center gap-1.5">
            {providers.map((p) => (
              <StatusDot key={p.provider} color={p.configured ? "success" : "danger"} size="sm" />
            ))}
          </div>
          <span className="text-xs text-muted">Providers</span>
        </button>
      ) : null}
    </Panel>
  );
}
