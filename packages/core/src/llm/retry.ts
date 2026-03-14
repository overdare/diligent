// @summary Wraps stream functions with exponential backoff retry logic
import { EventStream } from "../event-stream";
import type { ProviderEvent, ProviderResult, StreamFunction } from "./types";
import { ProviderError } from "./types";

export interface RetryConfig {
  maxAttempts: number; // default: 5
  baseDelayMs: number; // default: 1000 (1s)
  maxDelayMs: number; // default: 30_000 (30s)
}

/**
 * Wraps a StreamFunction with exponential backoff retry.
 * Only retries on retryable errors. Respects retry-after headers. (D010)
 */
export function withRetry(
  streamFn: StreamFunction,
  config: RetryConfig,
  onRetry?: (attempt: number, delayMs: number, error: ProviderError) => void,
): StreamFunction {
  return (model, context, options) => {
    const signal = options.signal;
    const stream = new EventStream<ProviderEvent, ProviderResult>(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") return { message: event.message };
        throw (event as { type: "error"; error: Error }).error;
      },
    );

    (async () => {
      for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
        if (signal?.aborted) {
          stream.push({
            type: "error",
            error: new ProviderError("Aborted", "unknown", false),
          });
          return;
        }

        // Collect events from the inner stream
        const inner = streamFn(model, context, options);
        let errorEvent: ProviderError | undefined;
        let hasSentDelta = false;

        for await (const event of inner) {
          if (event.type === "error") {
            // Capture the error, don't forward yet
            const err = event.error;
            errorEvent =
              err instanceof ProviderError
                ? err
                : new ProviderError(err instanceof Error ? err.message : String(err), "unknown", false);
            break;
          }

          if (event.type === "done") {
            // Success — forward the done event and return
            stream.push(event);
            return;
          }

          // Forward non-terminal events (text_delta, etc.)
          // Track whether any visible delta has been sent — once streaming starts,
          // retry is unsafe because the consumer already received partial output.
          hasSentDelta = true;
          stream.push(event);
        }

        // Consume the inner stream's rejected result to prevent unhandled rejection
        inner.result().catch(() => {});

        // If no error captured from events, check if stream completed normally
        if (!errorEvent) {
          stream.push({
            type: "error",
            error: new ProviderError("Provider stream ended without producing a terminal event", "unknown", false),
          });
          return;
        }

        // We have an error — decide whether to retry.
        // Never retry after streaming has started: the consumer already received
        // partial deltas and a retry would produce duplicate/corrupted output.
        if (hasSentDelta || !errorEvent.isRetryable || attempt >= config.maxAttempts) {
          stream.push({ type: "error", error: errorEvent });
          return;
        }

        // Calculate delay with exponential backoff
        const exponentialDelay = config.baseDelayMs * 2 ** (attempt - 1);
        const delayMs = Math.min(Math.max(exponentialDelay, errorEvent.retryAfterMs ?? 0), config.maxDelayMs);

        onRetry?.(attempt, delayMs, errorEvent);

        // Wait with abort support
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, delayMs);
          if (signal) {
            const onAbort = () => {
              clearTimeout(timer);
              resolve();
            };
            signal.addEventListener("abort", onAbort, { once: true });
          }
        });
      }
    })().catch((err) => {
      const providerErr =
        err instanceof ProviderError
          ? err
          : new ProviderError(err instanceof Error ? err.message : String(err), "unknown", false);
      stream.push({ type: "error", error: providerErr });
    });

    return stream;
  };
}
