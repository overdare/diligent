// @summary Sidebar with thread list, new thread button, and relative timestamps

import type { ProviderAuthStatus, SessionSummary } from "@diligent/protocol";
import { formatRelativeTime } from "../lib/format-time";
import { Panel } from "./Panel";

const PROVIDER_STYLE: Record<string, { label: string; className: string }> = {
  anthropic: { label: "Anthropic", className: "border-orange-400/30 bg-orange-400/10 text-orange-400" },
  openai: { label: "OpenAI", className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-400" },
  gemini: { label: "Gemini", className: "border-blue-400/30 bg-blue-400/10 text-blue-400" },
};

interface SidebarProps {
  cwd: string;
  threadList: SessionSummary[];
  activeThreadId: string | null;
  attentionThreadIds?: Set<string>;
  onNewThread: () => void;
  onOpenThread: (threadId: string) => void;
  onDeleteThread?: (threadId: string) => void;
  providers?: ProviderAuthStatus[];
  onOpenProviders?: (provider?: string) => void;
  onOpenTools?: () => void;
  onOpenKnowledge?: () => void;
}

export function Sidebar({
  cwd,
  threadList,
  activeThreadId,
  attentionThreadIds,
  onNewThread,
  onOpenThread,
  onDeleteThread,
  providers,
  onOpenProviders,
  onOpenTools,
  onOpenKnowledge,
}: SidebarProps) {
  const cwdShort = cwd ? cwd.replace(/\\/g, "/").split("/").slice(-2).join("/") : "-";

  return (
    <Panel className="flex min-h-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="relative border-b border-text/10 px-4 py-3">
        <div className="pr-24">
          <span className="font-mono text-sm font-bold text-accent">diligent</span>
          <p className="mt-1 truncate font-mono text-xs- text-muted" title={cwd}>
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
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#a78bfa]/35 bg-[#8b5cf6]/12 text-sm text-[#c4b5fd] transition hover:border-[#c4b5fd]/55 hover:bg-[#8b5cf6]/18 hover:text-[#ddd6fe]"
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
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-text/15 bg-surface/60 text-sm text-muted transition hover:border-text/25 hover:bg-surface hover:text-text"
            >
              <span className="block leading-none">⚙</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* Thread list */}
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        <button
          type="button"
          onClick={onNewThread}
          className="flex w-full items-center gap-2 rounded-md border border-dashed border-accent/35 bg-accent/8 px-3 py-2.5 text-left text-sm font-medium text-accent transition hover:border-accent/50 hover:bg-accent/12 hover:text-accent"
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
                className={`w-full rounded-md border px-3 py-2 text-left transition ${
                  isActive
                    ? "border-accent/30 bg-accent/5 text-text"
                    : needsAttention
                      ? "border-orange-400/30 bg-orange-400/5 hover:bg-orange-400/10"
                      : "border-transparent hover:border-text/15 hover:bg-surface/50"
                }`}
              >
                <div className="flex items-center gap-2 pr-5">
                  {needsAttention ? (
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full bg-orange-400"
                      title="Needs attention"
                    />
                  ) : null}
                  <span className="truncate text-sm leading-snug text-text">{title}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs- text-muted">
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

      {/* Settings footer */}
      {providers && onOpenProviders ? (
        <div className="space-y-2 border-t border-text/10 px-3 py-2.5">
          {(() => {
            const connected = providers.filter((p) => p.configured);
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
