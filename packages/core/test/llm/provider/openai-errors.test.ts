// @summary Tests for OpenAI API error classification and handling
import { describe, expect, it } from "bun:test";
import OpenAI from "openai";
import { classifyOpenAIError } from "../../../src/llm/provider/openai";

const emptyHeaders = new Headers();

describe("classifyOpenAIError", () => {
  it("classifies 429 as non-retryable rate_limit", () => {
    const err = new OpenAI.APIError(429, { message: "Rate limit exceeded" }, "rate limit", emptyHeaders);
    const classified = classifyOpenAIError(err);
    expect(classified.errorType).toBe("rate_limit");
    expect(classified.isRetryable).toBe(false);
  });

  it("classifies 401 as auth", () => {
    const err = new OpenAI.APIError(401, { message: "Invalid API key" }, "unauthorized", emptyHeaders);
    const classified = classifyOpenAIError(err);
    expect(classified.errorType).toBe("auth");
    expect(classified.isRetryable).toBe(false);
  });

  it("classifies context overflow", () => {
    const err = new OpenAI.APIError(
      400,
      { message: "This model's maximum context length is 128000" },
      "bad_request",
      emptyHeaders,
    );
    const classified = classifyOpenAIError(err);
    expect(classified.errorType).toBe("context_overflow");
  });

  it("classifies network errors", () => {
    const err = new Error("fetch failed: ECONNREFUSED");
    const classified = classifyOpenAIError(err);
    expect(classified.errorType).toBe("network");
    expect(classified.isRetryable).toBe(true);
  });

  it("classifies transient OpenAI processing errors as retryable overloaded", () => {
    const err = new Error(
      "An error occurred while processing your request. You can retry your request, or contact us through our help center at help.openai.com if the error persists. Please include the request ID 95226c1b-7063-4299-9d94-8d091ed07716 in your message.",
    );
    const classified = classifyOpenAIError(err);
    expect(classified.errorType).toBe("overloaded");
    expect(classified.isRetryable).toBe(true);
  });

  it("classifies 500 as retryable overloaded", () => {
    const err = new OpenAI.APIError(500, { message: "Internal server error" }, "server_error", emptyHeaders);
    const classified = classifyOpenAIError(err);
    expect(classified.errorType).toBe("overloaded");
    expect(classified.isRetryable).toBe(true);
  });

  it("classifies unknown errors", () => {
    const err = new Error("Something unexpected");
    const classified = classifyOpenAIError(err);
    expect(classified.errorType).toBe("unknown");
    expect(classified.isRetryable).toBe(false);
  });
});
