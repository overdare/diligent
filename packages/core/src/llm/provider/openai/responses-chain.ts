// @summary Provider-neutral previous_response_id chaining: baseline digests and strict-prefix input deltas
import { createHash } from "node:crypto";

/**
 * What a server holds after one completed response: the request input it received plus the
 * output items it produced. Stored as digests so long transcripts do not stay resident.
 */
export interface ResponsesChainBaseline {
  responseId: string;
  optionsDigest: string;
  itemDigests: string[];
}

export interface ResponsesChainedInput {
  previousResponseId: string;
  input: unknown[];
}

// Per-request fields that do not change the conversation the previous response id refers to.
const NON_CONTEXT_REQUEST_KEYS: Record<string, true> = {
  input: true,
  previous_response_id: true,
  client_metadata: true,
  type: true,
};

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64");
}

function requestOptionsDigest(request: Record<string, unknown>): string {
  const options: Record<string, unknown> = {};
  for (const key of Object.keys(request).sort()) {
    if (!NON_CONTEXT_REQUEST_KEYS[key]) options[key] = request[key];
  }
  return digest(options);
}

/**
 * Record the chain baseline after a completed response. `responseItems` must be the replay form the
 * caller's own transcript conversion produces for that response, so the next full request can be
 * compared item by item.
 */
export function createResponsesChainBaseline(
  request: Record<string, unknown>,
  responseId: string,
  responseItems: readonly unknown[],
): ResponsesChainBaseline {
  const input = Array.isArray(request.input) ? request.input : [];
  return {
    responseId,
    optionsDigest: requestOptionsDigest(request),
    itemDigests: [...input, ...responseItems].map(digest),
  };
}

/**
 * Plan a chained request: when `request` keeps every non-input option and its input strictly extends
 * the baseline, return only the appended items. Any mutated history, option change, or empty delta
 * returns undefined and the caller must send the full input without previous_response_id.
 */
export function planResponsesChainedInput(
  baseline: ResponsesChainBaseline | undefined,
  request: Record<string, unknown>,
): ResponsesChainedInput | undefined {
  if (!baseline) return undefined;
  const input = Array.isArray(request.input) ? request.input : [];
  if (input.length <= baseline.itemDigests.length) return undefined;
  if (requestOptionsDigest(request) !== baseline.optionsDigest) return undefined;
  for (let index = 0; index < baseline.itemDigests.length; index++) {
    if (digest(input[index]) !== baseline.itemDigests[index]) return undefined;
  }
  return { previousResponseId: baseline.responseId, input: input.slice(baseline.itemDigests.length) };
}
