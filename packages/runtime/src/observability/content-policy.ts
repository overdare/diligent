// @summary Fail-closed projection of authorized, observation metadata and explicit current-turn text.
import { ProviderErrorType } from "@diligent/protocol";

export interface ObservationPolicySnapshot {
  granted: boolean;
  generation: number;
  userId?: string;
  contentMode: "none" | "current-turn" | "full";
}

export interface ObservationMetadata {
  generation: number;
  userId: string;
  attributes: Readonly<Record<string, unknown>>;
}

/** Match the gateway limit and keep whole UTF-8 characters after masking. */
export function maskTurnText(text: string, mask: (text: string) => string): string {
  const bytes = Buffer.from(mask(text).trim(), "utf8");
  if (bytes.length <= 8192) return bytes.toString("utf8");
  let end = 8192;
  while ((bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString("utf8");
}

const numericAttributes = new Set([
  "diligent.retry.attempt",
  "llm.token_count.total",
  "llm.token_count.prompt",
  "llm.token_count.completion",
  "llm.token_count.prompt_details.cache_read",
  "llm.token_count.prompt_details.cache_write",
]);

/** Returns only explicitly allowed metadata for the same authorized consent generation. */
export function projectObservation(
  observation: ObservationMetadata,
  policy: ObservationPolicySnapshot,
): Record<string, string | number> | null {
  if (
    !policy.granted ||
    !policy.userId ||
    policy.userId !== observation.userId ||
    policy.generation !== observation.generation
  ) {
    return null;
  }
  const projected: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(observation.attributes)) {
    if (
      key === "error.type" &&
      typeof value === "string" &&
      Object.values(ProviderErrorType).some((type) => type === value)
    ) {
      projected[key] = value;
    } else if (
      key === "http.response.status_code" &&
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 100 &&
      value <= 599
    ) {
      projected[key] = value;
    } else if ((key === "llm.provider" || key === "llm.system") && (value === "openai" || value === "anthropic")) {
      projected[key] = value;
    } else if (numericAttributes.has(key) && typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
      projected[key] = value;
    } else if (key === "diligent.first_text_ms" && typeof value === "number" && Number.isFinite(value) && value >= 0) {
      projected[key] = value;
    } else if (
      (key === "llm.model_name" || key === "tool.name" || key === "diligent.model_call.id") &&
      typeof value === "string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(value)
    ) {
      projected[key] = value;
    }
  }
  return projected;
}
