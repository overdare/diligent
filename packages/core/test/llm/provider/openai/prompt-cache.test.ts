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
  test.each(["gpt-6.2-astra", "gpt-6.2-sol"])("uses supported GPT-6.2 request fields for %s", async (model) => {
    const body = await buildResponsesRequestBody({
      model,
      messages: MESSAGES,
      systemInstructions: "Reusable instructions",
      tools: [
        {
          kind: "function",
          name: "lookup",
          description: "Look up a value",
          inputSchema: { type: "object", properties: {} },
        },
      ],
      useReasoning: true,
      effort: "max",
      fastMode: true,
      temperature: 0.5,
      enablePromptCaching: true,
    });
    expect(body.prompt_cache_options).toEqual({ ttl: "30m" });
    expect(body.prompt_cache_retention).toBeUndefined();
    expect(body.instructions).toBeUndefined();
    expect(body.temperature).toBeUndefined();
    expect(body.input).toEqual([
      { type: "message", role: "developer", content: [{ type: "input_text", text: "Reusable instructions" }] },
      { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
    ]);
    expect(body.tools).toMatchObject([{ type: "function", name: "lookup" }]);
    expect(body.reasoning).toEqual({ effort: "max", summary: "auto" });
    expect(body.service_tier).toBe("priority");
  });

  test("preserves earlier models' instruction and temperature behavior", async () => {
    const body = await buildResponsesRequestBody({
      model: "gpt-5.5",
      messages: MESSAGES,
      systemInstructions: "Legacy instructions",
      temperature: 0.5,
    });
    expect(body.instructions).toBe("Legacy instructions");
    expect(body.temperature).toBe(0.5);
    expect(body.input).toEqual([{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }]);
  });

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
    for (const model of ["gpt-6.1-terra", "gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna"]) {
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
