// @summary Contract tests for the z.ai Coding Plan AI SDK adapter
import { describe, expect, it } from "bun:test";
import { getModelInfoList, resolveModel } from "../../../src/llm/models";
import {
  buildZaiCodingPlanProviderOptions,
  createZaiCodingPlanStream,
  resolveZaiCodingPlanBaseUrl,
  transformZaiCodingPlanRequest,
} from "../../../src/llm/provider/zai-coding-plan";
import { normalizeThinkingEffort } from "../../../src/llm/thinking-effort";
import type { Model } from "../../../src/llm/types";

const model: Model = {
  modelId: "glm-test",
  provider: "zai-coding-plan",
  contextWindow: 100_000,
  maxOutputTokens: 16_000,
  supportsThinking: true,
};

// A loopback response tests Diligent's wire contract, not live model behavior.
describe("GLM-5.3 Coding Plan Chat Completions contract", () => {
  // Coding Plan routes both historical generations to GLM-5.3, not Flash.
  for (const [selector, modelId] of [
    ["glm-5.3", "glm-5.3"],
    ["glm-5.3-flash", "glm-5.3-flash"],
    ["glm-5.2", "glm-5.3"],
    ["glm-5.1", "glm-5.3"],
    ["glm", "glm-5.3"],
    ["glm-5", "glm-5.3"],
    ["glm5.2", "glm-5.3"],
    ["glm5.1", "glm-5.3"],
  ]) {
    it(`serializes ${selector} as ${modelId} with the served model's capabilities`, async () => {
      const card = resolveModel({ provider: "zai-coding-plan", modelId: selector });
      const info = getModelInfoList().find(
        (entry) => entry.provider === card.provider && entry.modelId === card.modelId,
      );
      expect(info).toMatchObject({
        supportedEfforts: ["low", "high", "max"],
        supportsThinking: true,
        supportsVision: modelId === "glm-5.3-flash",
      });

      const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          requests.push({ path: new URL(request.url).pathname, body: await request.json() });
          const chunk = {
            id: "local-contract",
            object: "chat.completion.chunk",
            created: 1,
            model: modelId,
            choices: [{ index: 0, delta: { content: "fixture" }, finish_reason: "stop" }],
          };
          return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
            headers: { "Content-Type": "text/event-stream" },
          });
        },
      });
      try {
        const stream = createZaiCodingPlanStream("local-test-key", `${server.url}api/coding/paas/v4`);
        const efforts = ["low", "medium", "high", "xhigh", "max"] as const;
        for (const requestedEffort of efforts) {
          const effort = normalizeThinkingEffort(card, requestedEffort);
          expect(effort).toBe(requestedEffort === "medium" || requestedEffort === "xhigh" ? "low" : requestedEffort);
          await stream(
            card,
            {
              systemPrompt: [],
              messages: [
                {
                  role: "user",
                  content: card.supportsVision
                    ? [{ type: "image", source: { type: "base64", media_type: "image/png", data: "aW1hZ2U=" } }]
                    : "hello",
                  timestamp: 1,
                },
              ],
              tools: [],
            },
            { effort: requestedEffort },
          ).result();
          const captured = requests.at(-1);
          expect(captured?.path).toBe("/api/coding/paas/v4/chat/completions");
          expect(captured?.body).toMatchObject({
            model: modelId,
            reasoning_effort: effort,
            thinking: { type: "enabled" },
            stream: true,
          });
          if (card.supportsVision) {
            expect(captured?.body.messages).toContainEqual({
              role: "user",
              content: [{ type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } }],
            });
          }
        }
        expect(requests).toHaveLength(efforts.length);
      } finally {
        await server.stop(true);
      }
    });
  }
});

describe("z.ai Coding Plan AI SDK options", () => {
  it("preserves Diligent effort and enables z.ai thinking in the request", () => {
    expect(buildZaiCodingPlanProviderOptions(model, { effort: "max" })).toEqual({
      zaiCodingPlan: { reasoningEffort: "max" },
    });
    expect(transformZaiCodingPlanRequest({ reasoning_effort: "max", stream: true })).toEqual({
      reasoning_effort: "max",
      stream: true,
      thinking: { type: "enabled" },
    });
  });

  it("does not enable thinking when reasoning effort is absent", () => {
    expect(transformZaiCodingPlanRequest({ stream: true })).toEqual({ stream: true });
  });

  it("normalizes the compatible endpoint base URL", () => {
    expect(resolveZaiCodingPlanBaseUrl("https://example.com/v4///")).toBe("https://example.com/v4");
  });
});
