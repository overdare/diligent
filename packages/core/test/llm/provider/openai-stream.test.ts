// @summary Tests for OpenAI Responses event handling edge cases like aborts
import { describe, expect, test } from "bun:test";
import type { EventStream } from "../../../src/event-stream";
import { handleResponsesAPIEvents } from "../../../src/llm/provider/openai-sse";
import type { Model, ProviderEvent, ProviderResult } from "../../../src/llm/types";

const TEST_MODEL: Model = {
  id: "gpt-test",
  provider: "openai",
  contextWindow: 128_000,
  maxOutputTokens: 16_384,
};

describe("handleResponsesAPIEvents", () => {
  test("does not emit a successful terminal event after abort", async () => {
    const controller = new AbortController();
    const events: ProviderEvent[] = [];
    const stream = {
      push(event: ProviderEvent) {
        events.push(event);
      },
    } as unknown as EventStream<ProviderEvent, ProviderResult>;

    async function* iter(): AsyncIterable<Record<string, unknown>> {
      yield { type: "response.output_text.delta", delta: "partial" };
      controller.abort();
      yield {
        type: "response.completed",
        response: { status: "cancelled", usage: { input_tokens: 10, output_tokens: 5 } },
      };
    }

    await handleResponsesAPIEvents(iter(), stream, TEST_MODEL, controller.signal);

    expect(events.map((event) => event.type)).toEqual(["text_delta"]);
  });
});
