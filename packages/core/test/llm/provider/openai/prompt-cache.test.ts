// @summary Tests which prompt-cache parameter each OpenAI model generation receives
import { describe, expect, test } from "bun:test";
import { resolveModel } from "../../../../src/llm/models";
import { buildResponsesRequestBody } from "../../../../src/llm/provider/openai/responses";
import type { Message } from "../../../../src/types";

const MESSAGES: Message[] = [{ role: "user", content: "hello", timestamp: 0 }];

async function cacheFields(model: string) {
  const body = await buildResponsesRequestBody({ model, messages: MESSAGES, enablePromptCaching: true });
  return { options: body.prompt_cache_options, retention: body.prompt_cache_retention };
}

describe("OpenAI prompt caching", () => {
  test("sends GPT-6.1 Sol tools and reasoning with the supported 30m cache option", async () => {
    const model = resolveModel({ provider: "openai", modelId: "gpt-6.1-sol" });
    const body = await buildResponsesRequestBody({
      model: model.modelId,
      messages: MESSAGES,
      tools: [
        {
          kind: "function",
          name: "lookup",
          description: "Look up a value",
          inputSchema: { type: "object", properties: {} },
        },
      ],
      useReasoning: model.supportsThinking,
      effort: "max",
      enablePromptCaching: true,
    });

    expect(body.model).toBe("gpt-6.1-sol");
    expect(body.tools).toMatchObject([{ type: "function", name: "lookup" }]);
    expect(body.reasoning).toEqual({ effort: "max", summary: "auto" });
    expect(body.prompt_cache_options).toEqual({ ttl: "30m" });
    expect(body.prompt_cache_retention).toBeUndefined();
  });

  test("uses the 30m cache option for GPT-5.6 and later", async () => {
    for (const model of ["gpt-5.6-terra", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna"]) {
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
