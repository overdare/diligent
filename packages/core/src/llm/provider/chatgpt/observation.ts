// @summary Reports one transport exchange at a time, including replay on a reused socket.
import type { EventStream } from "../../../event-stream";
import type { AssistantMessage } from "../../../types";
import {
  type Model,
  type ModelExchangeObservation,
  ProviderError,
  type ProviderEvent,
  type ProviderResult,
  type StreamOptions,
} from "../../types";

function safely<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function observeExchanges(
  model: Model,
  start: NonNullable<StreamOptions["observeExchange"]>,
  stream: EventStream<ProviderEvent, ProviderResult>,
) {
  let active: ModelExchangeObservation | undefined;
  let firstText = false;
  const finish = (message?: AssistantMessage, error?: unknown) => {
    const current = active;
    active = undefined;
    const failure =
      error instanceof ProviderError
        ? { errorType: error.errorType, statusCode: error.statusCode }
        : message
          ? undefined
          : {};
    safely(() => current?.end(message, failure));
  };
  stream.subscribe((event) => {
    if (!active) return;
    if (event.type === "text_delta" && event.delta && !firstText) {
      firstText = true;
      safely(() => active?.firstText());
    }
    if (event.type === "done") finish(event.message);
    if (event.type === "error") finish(undefined, event.error);
  });
  return {
    begin(body: Record<string, unknown>) {
      firstText = false;
      active = safely(() => start(model, { instructions: body.instructions, input: body.input }));
    },
    terminal(event: Record<string, unknown>) {
      if (!active) return;
      const type = event.type;
      if (type !== "response.completed" && type !== "response.incomplete" && type !== "response.failed") return;
      const usage = object(object(event.response)?.usage);
      if (!usage) return;
      const prompt = count(usage.input_tokens),
        completion = count(usage.output_tokens);
      const cached = object(usage.input_tokens_details);
      safely(() =>
        active?.usage({
          prompt,
          completion,
          total:
            count(usage.total_tokens) ??
            (prompt !== undefined && completion !== undefined ? prompt + completion : undefined),
          cacheRead: count(cached?.cached_tokens),
          cacheWrite: count(cached?.cache_write_tokens),
        }),
      );
    },
    fail(error?: unknown) {
      finish(undefined, error);
    },
  };
}
