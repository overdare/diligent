// @summary Agent error serialization helpers for event-safe provider and runtime failures

import { ProviderError } from "../../llm/types";
import type { SerializableError } from "../types";

// D086: Convert Error to serializable representation for event consumers.
export function toSerializableError(err: unknown): SerializableError {
  if (err instanceof ProviderError) {
    return {
      message: err.message,
      name: err.name,
      stack: err.stack,
      providerErrorType: err.errorType,
      isRetryable: err.isRetryable,
      retryAfterMs: err.retryAfterMs,
      statusCode: err.statusCode,
    };
  }

  if (err instanceof Error) {
    return { message: err.message, name: err.name, stack: err.stack };
  }

  return { message: String(err), name: "Error" };
}
