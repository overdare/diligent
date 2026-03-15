// @summary Tests for provider-native compaction adapters (OpenAI/ChatGPT/Anthropic)
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { Model } from "../types";
import { createAnthropicNativeCompaction } from "./anthropic";
import { createChatGPTNativeCompaction } from "./chatgpt";
import { createOpenAINativeCompaction } from "./openai";

const originalFetch = globalThis.fetch;

const OPENAI_MODEL: Model = {
  id: "gpt-5.4",
  provider: "openai",
  contextWindow: 200_000,
  maxOutputTokens: 16_000,
  supportsThinking: true,
};

const ANTHROPIC_MODEL: Model = {
  id: "claude-sonnet-4-6",
  provider: "anthropic",
  contextWindow: 200_000,
  maxOutputTokens: 16_000,
  supportsThinking: true,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("native compaction adapters", () => {
  test("OpenAI adapter posts to /responses/compact with auth header", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = mock(async (url: string | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: "resp_1", summary: "Compacted summary" }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const compact = createOpenAINativeCompaction("sk-openai", "https://api.openai.com/v1");
    const result = await compact({
      model: OPENAI_MODEL,
      systemPrompt: [{ label: "base", content: "You are helpful." }],
      messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
    });

    expect(capturedUrl).toBe("https://api.openai.com/v1/responses/compact");
    expect(capturedHeaders.Authorization).toBe("Bearer sk-openai");
    expect(capturedBody.model).toBe("gpt-5.4");
    expect(capturedBody.input).toBeArray();
    expect(result.status).toBe("ok");
  });

  test("OpenAI adapter extracts summary from reasoning summary array", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            output: [
              {
                type: "reasoning",
                summary: [{ type: "summary_text", text: "Compacted summary via reasoning" }],
              },
            ],
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;

    const compact = createOpenAINativeCompaction("sk-openai", "https://api.openai.com/v1");
    const result = await compact({
      model: OPENAI_MODEL,
      systemPrompt: [{ label: "base", content: "You are helpful." }],
      messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.summary).toContain("Compacted summary via reasoning");
    }
  });

  test("OpenAI adapter includes error body in unsupported reason", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "Unknown parameter: 'store'.",
              type: "invalid_request_error",
              param: "store",
              code: "unknown_parameter",
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    const compact = createOpenAINativeCompaction("sk-openai", "https://api.openai.com/v1");
    const result = await compact({
      model: OPENAI_MODEL,
      systemPrompt: [{ label: "base", content: "You are helpful." }],
      messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
    });

    expect(result.status).toBe("unsupported");
    if (result.status === "unsupported") {
      expect(result.reason).toContain("status_400");
      expect(result.reason).toContain("unknown_parameter");
      expect(result.reason).toContain("store");
      expect(result.reason).toContain("Unknown parameter: 'store'.");
    }
  });

  test("ChatGPT adapter accepts compact response output array format", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: "Compacted summary via output" }],
              },
            ],
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;

    const adapter = createChatGPTNativeCompaction(() => ({
      access_token: "access-token",
      refresh_token: "refresh-token",
      id_token: "id-token",
      expires_at: Date.now() + 60_000,
      account_id: "acct_1",
    }));

    const result = await adapter({
      model: OPENAI_MODEL,
      systemPrompt: [],
      messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.summary).toContain("Compacted summary via output");
    }
  });

  test("ChatGPT adapter posts to codex compact endpoint with account header", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = mock(async (url: string | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response(JSON.stringify({ summary: "Compacted summary" }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const adapter = createChatGPTNativeCompaction(() => ({
      access_token: "access-token",
      refresh_token: "refresh-token",
      id_token: "id-token",
      expires_at: Date.now() + 60_000,
      account_id: "acct_1",
    }));
    const result = await adapter({
      model: OPENAI_MODEL,
      systemPrompt: [],
      messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
      sessionId: "session-1",
    });

    expect(capturedUrl).toBe("https://chatgpt.com/backend-api/codex/responses/compact");
    expect(capturedHeaders.Authorization).toBe("Bearer access-token");
    expect(capturedHeaders["ChatGPT-Account-ID"]).toBe("acct_1");
    expect(capturedHeaders.session_id).toBe("session-1");
    expect(capturedBody.store).toBeUndefined();
    expect(result.status).toBe("ok");
  });

  test("ChatGPT adapter treats 400 as error (not unsupported)", async () => {
    globalThis.fetch = mock(async () => new Response("bad request", { status: 400 })) as unknown as typeof fetch;

    const adapter = createChatGPTNativeCompaction(() => ({
      access_token: "access-token",
      refresh_token: "refresh-token",
      id_token: "id-token",
      expires_at: Date.now() + 60_000,
      account_id: "acct_1",
    }));

    await expect(
      adapter({
        model: OPENAI_MODEL,
        systemPrompt: [],
        messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
      }),
    ).rejects.toThrow("ChatGPT native compaction failed (400) body=bad request");
  });

  test("ChatGPT adapter surfaces JSON error payload details", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ error: { code: "invalid_request", message: "session_id invalid" } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    const adapter = createChatGPTNativeCompaction(() => ({
      access_token: "access-token",
      refresh_token: "refresh-token",
      id_token: "id-token",
      expires_at: Date.now() + 60_000,
      account_id: "acct_1",
    }));

    await expect(
      adapter({
        model: OPENAI_MODEL,
        systemPrompt: [],
        messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
      }),
    ).rejects.toThrow("invalid_request | session_id invalid");
  });

  test("Anthropic adapter marks 404 as unsupported", async () => {
    globalThis.fetch = mock(async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;

    const adapter = createAnthropicNativeCompaction("sk-ant");
    const result = await adapter({
      model: ANTHROPIC_MODEL,
      systemPrompt: [],
      messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
    });

    expect(result.status).toBe("unsupported");
  });
});
