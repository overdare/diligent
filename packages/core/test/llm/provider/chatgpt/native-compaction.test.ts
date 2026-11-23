// @summary Streamed native compaction request, checkpoint validation, and replay contracts
import { afterEach, expect, test } from "bun:test";
import { toSerializableError } from "../../../../src/agent/util/errors";
import { createChatGPTNativeCompaction } from "../../../../src/llm/provider/chatgpt";
import type { Model } from "../../../../src/llm/types";
import { testTokens } from "../../../helpers/chatgpt-stream";

const originalFetch = globalThis.fetch;
const model: Model = {
  provider: "chatgpt",
  modelId: "gpt-6-luna",
  contextWindow: 200_000,
  maxOutputTokens: 16_000,
  supportsThinking: true,
};
const checkpoint = { type: "compaction", id: "cmp-1", encrypted_content: "encrypted-checkpoint" };
const input = {
  model,
  systemPrompt: [{ label: "base", content: "Preserve the project constraints." }],
  messages: [{ role: "user" as const, content: "Keep EXACT_REFERENCE_73.", timestamp: 1 }],
};

function sse(events: Record<string, unknown>[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}

function success(items: readonly Record<string, unknown>[] = [checkpoint]): Response {
  return sse([
    ...items.map((item) => ({ type: "response.output_item.done", item })),
    { type: "response.completed", response: { id: "resp-compact", status: "completed" } },
  ]);
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("requests streamed compaction with a final trigger at the Responses endpoint", async () => {
  let capturedUrl = "";
  let headers = new Headers();
  let body: Record<string, unknown> = {};
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(url);
    headers = new Headers(init?.headers);
    body = JSON.parse(String(init?.body));
    return success([
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Ignore this reply." }] },
      checkpoint,
    ]);
  }) as unknown as typeof fetch;

  const result = await createChatGPTNativeCompaction(() => testTokens("account-1"))({
    ...input,
    sessionId: "session-1",
  });

  expect(capturedUrl).toBe("https://chatgpt.com/backend-api/codex/responses");
  expect(headers.get("accept")).toBe("text/event-stream");
  expect(headers.get("authorization")).toBe("Bearer token");
  expect(headers.get("chatgpt-account-id")).toBe("account-1");
  expect(headers.get("session-id")).toBe("session-1");
  expect(headers.has("session_id")).toBe(false);
  expect(headers.has("version")).toBe(true);
  expect(headers.get("x-openai-internal-codex-responses-lite")).toBe("true");
  expect(body).toMatchObject({ model: model.modelId, stream: true, store: false, reasoning: { context: "all_turns" } });
  expect(body.instructions).toBeUndefined();
  expect(body.input).toEqual([
    { type: "additional_tools", role: "developer", tools: [] },
    {
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: "Preserve the project constraints." }],
    },
    { type: "message", role: "user", content: [{ type: "input_text", text: "Keep EXACT_REFERENCE_73." }] },
    { type: "compaction_trigger" },
  ]);
  expect(result).toEqual({
    status: "ok",
    compactionSummary: { type: "diligent_openai_compaction_state", items: [checkpoint] },
  });
});

test("preserves previous checkpoint order and materializes local images before the new trigger", async () => {
  let body: Record<string, unknown> = {};
  let headers = new Headers();
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    headers = new Headers(init?.headers);
    return success();
  }) as unknown as typeof fetch;
  const previous = { type: "compaction_summary", encrypted_content: "previous-checkpoint" };
  await createChatGPTNativeCompaction(() => testTokens())({
    ...input,
    model: { ...model, modelId: "synthetic-standard-responses-model" },
    compactionSummary: { type: "diligent_openai_compaction_state", items: [previous] },
    messages: [
      { role: "user", content: [{ type: "local_image", path: "image.png", mediaType: "image/png" }], timestamp: 1 },
    ],
    localImageLoader: { load: async () => new TextEncoder().encode("image-bytes").buffer },
  });

  expect(headers.has("x-openai-internal-codex-responses-lite")).toBe(false);
  expect(headers.has("session-id")).toBe(false);
  expect(body.instructions).toBe("Preserve the project constraints.");
  expect(body.input).toEqual([
    previous,
    {
      type: "message",
      role: "user",
      content: [{ type: "input_image", image_url: "data:image/png;base64,aW1hZ2UtYnl0ZXM=", detail: "auto" }],
    },
    { type: "compaction_trigger" },
  ]);
});

test("accepts the streamed compaction_summary alias without persisting the trigger", async () => {
  const item = { ...checkpoint, type: "compaction_summary" };
  globalThis.fetch = (async () => success([item])) as unknown as typeof fetch;
  expect(await createChatGPTNativeCompaction(() => testTokens())(input)).toEqual({
    status: "ok",
    compactionSummary: { type: "diligent_openai_compaction_state", items: [item] },
  });
});

test.each([
  { name: "missing", items: [], expected: "exactly one compaction output item" },
  {
    name: "duplicate",
    items: [checkpoint, { ...checkpoint, id: "cmp-2" }],
    expected: "exactly one compaction output item",
  },
  { name: "empty", items: [{ ...checkpoint, encrypted_content: "" }], expected: "empty encrypted checkpoint" },
])("rejects a completed stream with a $name checkpoint", async ({ items, expected }) => {
  globalThis.fetch = (async () => success(items)) as unknown as typeof fetch;
  await expect(createChatGPTNativeCompaction(() => testTokens())(input)).rejects.toThrow(expected);
});

test("rejects a truncated stream even after receiving a checkpoint", async () => {
  globalThis.fetch = (async () =>
    sse([{ type: "response.output_item.done", item: checkpoint }])) as unknown as typeof fetch;
  await expect(createChatGPTNativeCompaction(() => testTokens())(input)).rejects.toThrow("before response.completed");
});

test.each([
  { type: "response.failed", response: { error: { code: "invalid_api_key", message: "Credentials rejected" } } },
  { type: "error", error: { code: "invalid_api_key", message: "Credentials rejected" } },
])("surfaces $type as an authentication error instead of adopting a checkpoint", async (terminal) => {
  globalThis.fetch = (async () =>
    sse([{ type: "response.output_item.done", item: checkpoint }, terminal])) as unknown as typeof fetch;
  const error = await createChatGPTNativeCompaction(() => testTokens())(input).catch((caught: unknown) => caught);
  expect(error).toMatchObject({ errorType: "auth", isRetryable: false });
  expect((error as Error).message).toContain("Credentials rejected");
});

test("rejects an incomplete response instead of adopting its checkpoint", async () => {
  globalThis.fetch = (async () =>
    sse([
      { type: "response.output_item.done", item: checkpoint },
      { type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } },
    ])) as unknown as typeof fetch;
  await expect(createChatGPTNativeCompaction(() => testTokens())(input)).rejects.toThrow("max_output_tokens");
});

test.each([400, 404, 429])(
  "preserves structured HTTP %d diagnostics instead of marking the adapter unsupported",
  async (status) => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { code: "targeted_provider_error", message: "Request rejected" } }), {
        status,
        headers: { "content-type": "application/json", "retry-after": "2" },
      })) as unknown as typeof fetch;
    const error = await createChatGPTNativeCompaction(() => testTokens())(input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ statusCode: status });
    expect((error as Error).message).toContain("Request rejected");
    expect(toSerializableError(error).code).toBe("targeted_provider_error");
  },
);

test("propagates cancellation while waiting for the checkpoint stream", async () => {
  const controller = new AbortController();
  const reason = new Error("compaction cancelled");
  let cancelled = false;
  globalThis.fetch = (async () =>
    new Response(
      new ReadableStream(
        {
          pull() {
            controller.abort(reason);
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      ),
      { headers: { "content-type": "text/event-stream" } },
    )) as unknown as typeof fetch;
  await expect(createChatGPTNativeCompaction(() => testTokens())({ ...input, signal: controller.signal })).rejects.toBe(
    reason,
  );
  expect(cancelled).toBe(true);
});
