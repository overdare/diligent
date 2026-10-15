// @summary Transcript row for a provider or runtime failure, shown where and when it happened

import { type ErrorRecovery, ProviderErrorType } from "@diligent/protocol";
import type { RenderItem } from "../lib/thread-store";
import { formatMessageTimestamp, formatMessageTimestampTooltip } from "../lib/time-format";
import { useMinuteNow } from "../lib/use-minute-now";

interface ErrorMessageProps {
  item: Extract<RenderItem, { kind: "error" }>;
  /** Passed only for the actionable failure; recovery never runs automatically. */
  onRecovery?: (recovery: ErrorRecovery) => void;
}

const RECOVERY_LABELS: Record<ErrorRecovery["kind"], string> = {
  configure_provider: "Reconnect",
  start_new_thread: "New chat",
  retry: "Retry",
};

export function ErrorMessage({ item, onRecovery }: ErrorMessageProps) {
  const now = useMinuteNow();
  // Older servers send raw auth diagnostics without a semantic recovery intent.
  const legacyAuthError = !item.recovery && item.providerErrorType === ProviderErrorType.Auth;
  const recovery: ErrorRecovery | undefined =
    item.recovery ?? (legacyAuthError ? { kind: "configure_provider" } : undefined);
  const title = item.presented
    ? item.message
    : legacyAuthError
      ? "Provider authentication failed"
      : item.name
        ? `${item.name}: ${item.message}`
        : item.message;

  return (
    <div className="py-2">
      <div className="flex min-w-0 items-start justify-between gap-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-sm font-medium leading-relaxed text-text-soft">
            {title}
          </div>
          {legacyAuthError ? (
            <div className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted">
              Reconnect this provider to continue.
            </div>
          ) : null}
          <time
            dateTime={new Date(item.timestamp).toISOString()}
            title={formatMessageTimestampTooltip(item.timestamp)}
            className="mt-1 block text-[10px] leading-3 text-muted"
          >
            {formatMessageTimestamp(item.timestamp, { now })}
          </time>
        </div>
        {recovery && onRecovery ? (
          <button
            type="button"
            onClick={() => onRecovery(recovery)}
            className="shrink-0 rounded-md border border-danger/40 bg-danger/15 px-2.5 py-1 text-xs font-medium text-danger transition hover:bg-danger/25"
          >
            {RECOVERY_LABELS[recovery.kind]}
          </button>
        ) : null}
      </div>
    </div>
  );
}
