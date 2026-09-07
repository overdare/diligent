// @summary Tests which prompt-cache parameter each OpenAI model generation receives
import { describe, expect, test } from "bun:test";
import { buildResponsesRequestBody } from "../../../../src/llm/provider/openai/responses";
import type { Message } from "../../../../src/types";

const MESSAGES: Message[] = [{ role: "user", content: "hello", timestamp: 0 }];

async function cacheFields(model: string) {
  const body = await buildResponsesRequestBody({ model, messages: MESSAGES, enablePromptCaching: true });
  return { options: body.prompt_cache_options, retention: body.prompt_cache_retention };
}

describe("OpenAI prompt caching", () => {
  test("uses the 30m cache option for GPT-5.6 and later", async () => {
    for (const model of ["gpt-5.6-sol", "gpt-5.6-luna", "gpt-6-astra"]) {
      expect(await cacheFields(model)).toEqual({ options: { ttl: "30m" }, retention: undefined });
    }
  });

  test("keeps 24h retention for models before GPT-5.6", async () => {
    expect(await cacheFields("gpt-5.5")).toEqual({ options: undefined, retention: "24h" });
  });

  test("omits both when prompt caching is off", async () => {
    const body = await buildResponsesRequestBody({ model: "gpt-6-astra", messages: MESSAGES });
    expect(body.prompt_cache_options).toBeUndefined();
    expect(body.prompt_cache_retention).toBeUndefined();
  });
});
