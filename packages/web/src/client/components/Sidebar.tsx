// @summary Sidebar with thread list, new thread button, and relative timestamps

import type { SessionSummary } from "@diligent/protocol";
import type { ProviderAuthStatus } from "../../shared/ws-protocol";
import { formatRelativeTime } from "../lib/format-time";
import { Panel } from "./Panel";

const PROVIDER_STYLE: Record<string, { label: string; className: string }> = {
  anthropic: { label: "Anthropic", className: "border-orange-400/30 bg-orange-400/10 text-orange-400" },
  openai:    { label: "OpenAI",    className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-400" },
  gemini:    { label: "Gemini",    className: "border-blue-400/30 bg-blue-400/10 text-blue-400" },
};

interface SidebarProps {
  cwd: string;
  threadList: SessionSummary[];
  activeThreadId: string | null;
  onNewThread: () => void;
  onOpenThread: (threadId: string) => void;
  providers?: ProviderAuthStatus[];
  onOpenProviders?: (provider?: string) => void;
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
        <div className="border-t border-text/10 px-3 py-2.5">
          {(() => {
            const connected = providers.filter((p) => p.configured || p.oauthConnected);
            return (
              <div className="flex flex-wrap items-center gap-1.5">
                {connected.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => onOpenProviders()}
                    className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-danger/40 px-3 py-1.5 text-xs text-danger/80 transition hover:border-danger hover:text-danger"
                  >
                    <span>+</span>
                    <span>Connect a provider</span>
                  </button>
                ) : (
                  <>
                    {connected.map((p) => {
                      const style = PROVIDER_STYLE[p.provider];
                      return (
                        <button
                          key={p.provider}
                          type="button"
                          onClick={() => onOpenProviders(p.provider)}
                          className={`rounded border px-2 py-0.5 text-xs font-medium transition hover:opacity-80 ${style?.className ?? "border-text/20 bg-surface text-muted"}`}
                        >
                          {style?.label ?? p.provider}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => onOpenProviders()}
                      className="rounded border border-dashed border-text/20 px-2 py-0.5 text-xs text-muted transition hover:border-accent/50 hover:text-accent"
                    >
                      + Connect
                    </button>
                  </>
                )}
              </div>
            );
          })()}
        </div>
      ) : null}
    </Panel>
  );
}
