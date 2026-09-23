// @summary Tests that every ChatGPT request path pins the same Codex client version
import { afterEach, describe, expect, test } from "bun:test";
import { resolveModel } from "../../../../src/llm/models";
import { createChatGPTNativeCompaction, createChatGPTStream } from "../../../../src/llm/provider/chatgpt";
import {
  chatGPTSuccessResponse,
  collectEvents,
  restoreChatGPTStreamTestState,
  TEST_CONTEXT,
  testTokens,
} from "../../../helpers/chatgpt-stream";

const CODEX_MINIMUM_CLIENT_VERSION = "0.155.0";
const SUBSCRIPTION_MODEL = resolveModel({ provider: "chatgpt", modelId: "gpt-6-sol" });

function isAtLeast(version: string, minimum: string): boolean {
  const parse = (value: string) => value.split(".").map(Number);
  const [actual, floor] = [parse(version), parse(minimum)];
  for (let index = 0; index < floor.length; index++) {
    const left = actual[index] ?? 0;
    const right = floor[index] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}

async function captureVersionHeader(run: () => Promise<unknown>): Promise<string | undefined> {
  let version: string | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    version = new Headers(init?.headers).get("version") ?? undefined;
    return chatGPTSuccessResponse();
  }) as unknown as typeof fetch;
  await run().catch(() => undefined);
  return version;
}

afterEach(restoreChatGPTStreamTestState);

describe("ChatGPT client version", () => {
  test("streaming and compaction pin the same version", async () => {
    const streamed = await captureVersionHeader(() =>
      collectEvents(createChatGPTStream(() => testTokens())(SUBSCRIPTION_MODEL, TEST_CONTEXT, { effort: "medium" })),
    );
    const compacted = await captureVersionHeader(() =>
      createChatGPTNativeCompaction(() => testTokens())({
        model: SUBSCRIPTION_MODEL,
        systemPrompt: [],
        messages: [{ role: "user", content: "hello", timestamp: 0 }],
      }),
    );

    expect(streamed).toBeDefined();
    expect(compacted).toBe(streamed as string);
  });

  test("GPT-6 Sol and Luna send a version meeting their Codex catalog minimum", async () => {
    for (const modelId of ["gpt-6-sol", "gpt-6-luna"]) {
      const model = resolveModel({ provider: "chatgpt", modelId });
      const streamed = await captureVersionHeader(() =>
        collectEvents(createChatGPTStream(() => testTokens())(model, TEST_CONTEXT, { effort: "medium" })),
      );

      expect(streamed).toBeDefined();
      expect(isAtLeast(streamed as string, CODEX_MINIMUM_CLIENT_VERSION)).toBe(true);
    }
  });
});
