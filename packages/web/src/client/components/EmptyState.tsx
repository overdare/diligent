// @summary Empty state with a central account connection call-to-action

interface EmptyStateProps {
  hasProvider: boolean;
  oauthPending?: boolean;
  onOpenProviders: () => void;
  onQuickConnectChatGPT?: () => void;
}

export function EmptyState({ hasProvider, oauthPending, onOpenProviders, onQuickConnectChatGPT }: EmptyStateProps) {
  if (hasProvider) {
    return null;
  }

  return (
    <div className="flex h-full flex-col items-center justify-center px-4 py-16">
      <div className="mb-8 rounded-xl border border-border/100 bg-surface-default px-8 py-7 text-center shadow-panel">
        <h2 className="mb-2 text-xl font-semibold text-text">Connect your AI account to start building</h2>
        <p className="text-sm leading-6 text-muted">Most users start with ChatGPT. Sign in once and continue.</p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (onQuickConnectChatGPT) {
                onQuickConnectChatGPT();
                return;
              }
              onOpenProviders();
            }}
            disabled={oauthPending}
            className="rounded-md bg-fill-primary px-2.5 py-1.5 text-xs font-medium text-text transition hover:bg-fill-active"
          >
            {oauthPending ? "Connecting…" : "Connect ChatGPT"}
          </button>
          <button
            type="button"
            onClick={onOpenProviders}
            className="rounded-md border border-border/100 bg-surface-dark px-2.5 py-1.5 text-xs text-muted transition hover:border-accent/40 hover:text-text"
          >
            More options
          </button>
        </div>
      </div>
    </div>
  );
}
