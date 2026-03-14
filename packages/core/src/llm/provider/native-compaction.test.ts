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

  test("ChatGPT adapter posts to codex compact endpoint with account header", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = mock(async (url: string | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
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
    expect(result.status).toBe("ok");
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
