// @summary Fast mode changes the OpenAI service tier without changing model or reasoning
import { expect, test } from "bun:test";
import { buildResponsesRequestBody, toResponsesLiteRequestBody } from "../../../../src/llm/provider/openai/responses";

test("Fast mode requests priority processing without reducing reasoning, including Responses Lite", async () => {
  const body = await buildResponsesRequestBody({
    model: "gpt-6.1-sol",
    messages: [{ role: "user", content: "hello", timestamp: 0 }],
    useReasoning: true,
    effort: "high",
    fastMode: true,
  });
  expect(body).toMatchObject({ model: "gpt-6.1-sol", service_tier: "priority", reasoning: { effort: "high" } });
  expect(toResponsesLiteRequestBody(body)).toMatchObject({
    model: "gpt-6.1-sol",
    service_tier: "priority",
    reasoning: { effort: "high", context: "all_turns" },
  });
});

test("turning Fast mode off explicitly requests the standard tier instead of the project default", async () => {
  const body = await buildResponsesRequestBody({ model: "gpt-6.1-sol", messages: [], fastMode: false });
  expect(body.service_tier).toBe("default");
  expect(toResponsesLiteRequestBody(body).service_tier).toBe("default");
});
