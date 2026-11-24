// @summary Tests that named SSE error frames read through the OpenAI SDK keep their retry classification
import { afterEach, describe, expect, test } from "bun:test";
import { createOpenAIStream } from "../../../../src/llm/provider/openai";
import type { ProviderEvent } from "../../../../src/llm/types";
import { collectEvents, TEST_CONTEXT, TEST_MODEL } from "../../../helpers/chatgpt-stream";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function respondWithSSE(body: string): void {
  globalThis.fetch = (async () =>
    new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
}

async function streamEvents(): Promise<ProviderEvent[]> {
  const stream = createOpenAIStream("test-key", "https://openai.test/v1");
  return collectEvents(stream(TEST_MODEL, TEST_CONTEXT, {}));
}

function errorOf(events: ProviderEvent[]) {
  return events.find((event): event is Extract<ProviderEvent, { type: "error" }> => event.type === "error")?.error;
}

describe("OpenAI Responses named SSE error frames", () => {
  test("keeps partial text and reports a mid-stream server error as retryable", async () => {
    respondWithSSE(
      `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "partial" })}\n\n` +
        `event: error\ndata: ${JSON.stringify({ type: "error", code: "server_error", message: "The server had an error while processing your request.", param: null })}\n\n`,
    );

    const events = await streamEvents();

    expect(events.filter((event) => event.type === "text_delta")).toEqual([{ type: "text_delta", delta: "partial" }]);
    expect(errorOf(events)).toMatchObject({
      message: "The server had an error while processing your request.",
      errorType: "server_error",
      isRetryable: true,
    });
  });

  test.each([
    ["rate_limit_exceeded", "Rate limit reached", { errorType: "rate_limit", isRetryable: true }],
    [
      "context_length_exceeded",
      "Your input exceeds the context window of this model.",
      { errorType: "context_overflow", isRetryable: false, reason: "context_window_exceeded" },
    ],
  ] as const)("classifies a %s frame by its code", async (code, message, expected) => {
    respondWithSSE(`event: error\ndata: ${JSON.stringify({ type: "error", code, message, param: null })}\n\n`);

    expect(errorOf(await streamEvents())).toMatchObject(expected);
  });
});
