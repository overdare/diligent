// @summary Tests for Anthropic thinking payload assembly across adaptive and budget-based models
import { describe, expect, mock, test } from "bun:test";
import { APIError } from "@anthropic-ai/sdk/core/error.mjs";
import type { Model, StreamContext, StreamOptions, ToolDefinition } from "../../../src/llm/types";

const anthropicCalls: unknown[] = [];

class MockAnthropicStream {
  on() {
    return this;
  }

  async finalMessage() {
    return {
      id: "msg_123",
      role: "assistant",
      model: "claude-sonnet-4-6",
      type: "message",
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "text", text: "ok" }],
    };
  }
}

class MockAnthropicClient {
  static APIError = APIError;

  messages = {
    stream: (params: unknown) => {
      anthropicCalls.push(params);
      return new MockAnthropicStream();
    },
  };
}

mock.module("@anthropic-ai/sdk", () => ({
  default: MockAnthropicClient,
  APIError,
}));

const { createAnthropicStream } = await import("../../../src/llm/provider/anthropic");

const EMPTY_CONTEXT: StreamContext = {
  systemPrompt: [],
  messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
  tools: [] satisfies ToolDefinition[],
};

function baseModel(overrides: Partial<Model>): Model {
  return {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 8_000,
    supportsThinking: true,
    ...overrides,
  };
}

async function collectRequest(model: Model, options: StreamOptions = { effort: "medium" }) {
  anthropicCalls.length = 0;
  const stream = createAnthropicStream("test-key")(model, EMPTY_CONTEXT, options);
  await stream.result();
  expect(anthropicCalls).toHaveLength(1);
  return anthropicCalls[0] as Record<string, unknown>;
}

describe("createAnthropicStream", () => {
  test("uses adaptive thinking without budget_tokens and sends output_config effort", async () => {
    const request = await collectRequest(
      baseModel({
        supportsAdaptiveThinking: true,
        thinkingBudgets: { low: 1_500, medium: 6_000, high: 12_000, max: 24_000 },
      }),
      { effort: "high" },
    );

    expect(request.thinking).toEqual({ type: "adaptive" });
    expect(request.output_config).toEqual({ effort: "high" });
    expect(request.temperature).toBe(1);
  });

  test("uses budget_tokens for non-adaptive thinking models", async () => {
    const request = await collectRequest(
      baseModel({
        id: "claude-haiku-4-5",
        supportsAdaptiveThinking: false,
        thinkingBudgets: { low: 1_024, medium: 3_000, high: 8_000, max: 16_000 },
      }),
      { effort: "medium" },
    );

    expect(request.thinking).toEqual({ type: "enabled", budget_tokens: 3_000 });
    expect(request.output_config).toBeUndefined();
    expect(request.temperature).toBe(1);
  });

  test("uses caller temperature when thinking is disabled", async () => {
    const request = await collectRequest(
      baseModel({
        supportsThinking: false,
      }),
      { effort: "medium", temperature: 0.25 },
    );

    expect(request.thinking).toBeUndefined();
    expect(request.output_config).toBeUndefined();
    expect(request.temperature).toBe(0.25);
  });
});
